import os
import re
import logging
import requests
import base64
import hashlib
from typing import List
import numpy as np
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
from cryptography.fernet import Fernet
from app.config import settings
from app.redis_client import redis_client

logger = logging.getLogger("uvicorn.error")

def get_fernet_cipher() -> Fernet:
    """Derive a valid 32-byte key from backend_encryption_key configuration setting."""
    key_source = settings.backend_encryption_key
    digest = hashlib.sha256(key_source.encode()).digest()
    fernet_key = base64.urlsafe_b64encode(digest)
    return Fernet(fernet_key)

def encrypt_data(text: str) -> str:
    """Symmetrically encrypt text using AES-128 key derived from config."""
    if not text:
        return ""
    cipher = get_fernet_cipher()
    return cipher.encrypt(text.encode()).decode()

def decrypt_data(ciphertext: str) -> str:
    """Symmetrically decrypt AES ciphertext using config key."""
    if not ciphertext:
        return ""
    try:
        cipher = get_fernet_cipher()
        return cipher.decrypt(ciphertext.encode()).decode()
    except Exception as e:
        logger.error(f"Failed to decrypt document chunk content: {e}")
        return "[Decryption Error]"

class RAGPipeline:
    def __init__(self):
        self.embedding_model: SentenceTransformer | None = None
        self.model_name = "all-MiniLM-L6-v2"
        self.vector_dim = 384

    def load_model(self):
        """Lazy load the sentence transformer model."""
        if self.embedding_model is None:
            logger.info(f"Loading embedding model '{self.model_name}'...")
            # Run on CPU for local Apple Silicon optimization
            self.embedding_model = SentenceTransformer(self.model_name, device="cpu")
            logger.info("Embedding model loaded successfully.")

    def chunk_text(self, text: str, chunk_size: int = 500, chunk_overlap: int = 50) -> List[str]:
        """Split text into smaller overlapping chunks using RecursiveCharacterTextSplitter."""
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len
        )
        chunks = splitter.split_text(text)
        logger.info(f"Split transcript into {len(chunks)} chunks.")
        return chunks

    def generate_embeddings(self, chunks: List[str]) -> List[List[float]]:
        """Generate vector embeddings for a list of text chunks."""
        self.load_model()
        if not self.embedding_model:
            raise RuntimeError("Embedding model failed to load.")
        
        logger.info(f"Generating embeddings for {len(chunks)} chunks...")
        embeddings = self.embedding_model.encode(chunks)
        # Convert numpy array to list of floats
        return [emb.tolist() for emb in embeddings]

    def ingest_audio_transcript(self, audio_id: str, transcript: str, token: str, user_id: str, chunk_size: int = 1000, chunk_overlap: int = 150) -> int:
        """Pipeline function to chunk, embed, and store transcript locally in Redis and cloud Supabase.
        
        Returns:
            Number of successfully stored chunks.
        """
        chunks = self.chunk_text(transcript, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
        if not chunks:
            logger.warning("No text chunks generated for ingestion.")
            return 0

        embeddings = self.generate_embeddings(chunks)
        
        # Ensure the vector index exists in local Redis
        redis_client.create_vector_index(dim=self.vector_dim)

        # 1. Save all chunks locally in Redis first
        encrypted_chunks = []
        for idx, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            enc_chunk = encrypt_data(chunk)
            encrypted_chunks.append((enc_chunk, embedding))
            # Cache locally in Redis
            redis_client.save_chunk(
                session_id=audio_id,
                idx=idx,
                content=enc_chunk,
                embedding=embedding,
                user_id=user_id,
                synced=False
            )

        # 2. Try uploading to online Supabase in parallel
        url = f"{settings.supabase_url}/rest/v1/document_chunks"
        headers = {
            "apikey": settings.supabase_anon_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        
        payload = [
            {
                "session_id": audio_id,
                "chunk_index": idx,
                "content": enc_chunk,
                "embedding": embedding,
                "user_id": user_id
            }
            for idx, (enc_chunk, embedding) in enumerate(encrypted_chunks)
        ]
        
        try:
            logger.info(f"Attempting to sync {len(payload)} chunks to online Supabase...")
            res = requests.post(url, json=payload, headers=headers, timeout=10)
            if res.status_code in (200, 201):
                logger.info("Successfully synced vectors to Supabase. Updating local sync flags...")
                # Mark as synced locally
                for idx in range(len(chunks)):
                    redis_client.mark_chunk_synced(f"chunk:{audio_id}:{idx}")
            else:
                logger.warning(f"Failed to sync to Supabase: {res.status_code} {res.text}. Chunks remain queued offline.")
        except Exception as e:
            logger.warning(f"Could not reach Supabase for vector sync: {e}. Chunks remain queued offline.")

        return len(chunks)

    def retrieve_context(self, question: str, token: str, audio_id: str | None = None, k: int = 6) -> List[dict]:
        """Retrieve top k relevant context chunks locally from Redis vector store (100% offline)."""
        self.load_model()
        if not self.embedding_model:
            logger.error("Embedding model not loaded.")
            return []

        if not redis_client.client:
            logger.error("Redis client is not connected. Local search aborted.")
            return []

        # Lazy Restore: If local Redis has 0 chunks for this audio_id, fetch from Supabase to restore state
        if audio_id:
            local_keys = redis_client.client.keys(f"chunk:{audio_id}:*")
            if not local_keys:
                logger.info(f"No local chunks found in Redis for session {audio_id}. Restoring from Supabase cloud...")
                url = f"{settings.supabase_url}/rest/v1/document_chunks"
                headers = {
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {token}"
                }
                params = {
                    "session_id": f"eq.{audio_id}",
                    "select": "*"
                }
                try:
                    res = requests.get(url, headers=headers, params=params, timeout=10)
                    if res.status_code == 200:
                        cloud_chunks = res.json()
                        if cloud_chunks:
                            logger.info(f"Found {len(cloud_chunks)} chunks in Supabase. Caching locally in Redis...")
                            for cc in cloud_chunks:
                                redis_client.save_chunk(
                                    session_id=cc["session_id"],
                                    idx=int(cc["chunk_index"]),
                                    content=cc["content"],
                                    embedding=cc["embedding"],
                                    user_id=cc["user_id"],
                                    synced=True
                                )
                            logger.info(f"Successfully restored {len(cloud_chunks)} chunks to Redis VSS.")
                        else:
                            logger.info("No chunks found in Supabase for this session.")
                    else:
                        logger.warning(f"Could not check Supabase chunks: status {res.status_code}")
                except Exception as e:
                    logger.warning(f"Error restoring chunks from Supabase: {e}")

        logger.info(f"Embedding query: '{question}'")
        question_emb = self.embedding_model.encode([question])[0]
        query_vector = np.array(question_emb, dtype=np.float32).tobytes()

        # Build local Redis search query
        if audio_id:
            escaped_audio_id = re.sub(r"([\-.,<>{}\[\]\"'/\\!@#\$%^&*()+=~|?:;])", r"\\\1", audio_id)
            query_string = f"(@session_id:{{{escaped_audio_id}}})=>[KNN {k} @embedding $query_vec AS vector_score]"
        else:
            query_string = f"*=>[KNN {k} @embedding $query_vec AS vector_score]"

        from redis.commands.search.query import Query
        q = Query(query_string)\
            .sort_by("vector_score")\
            .return_fields("content", "chunk_index", "session_id", "vector_score")\
            .dialect(2)

        try:
            logger.info(f"Querying local Redis Vector DB index: {query_string}")
            results = redis_client.client.ft(redis_client.vector_idx_name).search(q, query_params={"query_vec": query_vector})
            retrieved_chunks = []
            for doc in results.docs:
                retrieved_chunks.append({
                    "content": decrypt_data(doc.content),
                    "chunk_index": int(doc.chunk_index) if hasattr(doc, "chunk_index") else 0,
                    "audio_id": doc.session_id if hasattr(doc, "session_id") else "",
                    "score": float(doc.vector_score) if hasattr(doc, "vector_score") else 0.0
                })
            logger.info(f"Retrieved {len(retrieved_chunks)} relevant chunks from local Redis.")
            return retrieved_chunks
        except Exception as e:
            logger.error(f"Error during vector retrieval from local Redis: {e}")
            return []

    def answer_question(self, question: str, token: str, audio_id: str | None = None) -> dict:
        """Retrieve relevant context chunks and generate a response using local Ollama."""
        # 1. Retrieve context chunks
        chunks = self.retrieve_context(question, token=token, audio_id=audio_id, k=6)
        
        # 2. Extract contents and build context text
        context_text = "\n\n".join([f"[Chunk {c['chunk_index']}]: {c['content']}" for c in chunks])
        
        # 3. Create prompt
        prompt = f"""You are an expert assistant summarizing and answering questions about an audio recording.
Answer the user's question using the provided transcription context below. Support your answer with facts directly from the context.

Speaker Resolution Guidelines:
- Resolve name variations, pronouns, and references logically across conversation turns (e.g., if a speaker answers a question, attribute that statement or action to them).
- In speech blocks, attribute statements to the speaker who introduced the block even if there are short side comments or interruptions in the transcript.

Presentation Guidelines:
- Present the answer in a clean, natural, and user-friendly format.
- DO NOT mention raw database metadata, chunk numbers, or indices (such as 'Chunk 1', 'Chunk 2', or '[Chunk 0]') in your final answer to the user.

If the answer cannot be found or reasonably inferred from the context, state that the context does not contain the answer. Do not use any external knowledge.

Context:
---
{context_text}
---

Question: {question}

Answer:"""

        # 4. Invoke local Ollama model
        try:
            logger.info("Initializing Ollama Llama 3 model connection...")
            from langchain_community.llms import Ollama
            llm = Ollama(model=settings.llm_model)
            
            logger.info("Generating response from local Ollama...")
            response = llm.invoke(prompt)
            logger.info("Ollama response generated successfully.")
            
            return {
                "answer": response.strip(),
                "context": chunks
            }
        except Exception as e:
            logger.error(f"Error generating answer via Ollama: {e}")
            raise e

rag_pipeline = RAGPipeline()
