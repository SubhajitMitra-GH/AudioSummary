import re
import json
import logging
import base64
import hashlib
from functools import lru_cache
from typing import List

import numpy as np
import requests
from cryptography.fernet import Fernet
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer

from app.config import settings
from app.llm_models import get_active_model
from app.redis_client import redis_client
from app.supabase_rest import rest_url, user_headers

logger = logging.getLogger("uvicorn.error")


@lru_cache(maxsize=1)
def get_fernet_cipher() -> Fernet:
    """Derive a valid 32-byte key from backend_encryption_key configuration setting.

    Note: this key is shared by every user of an installation, so it protects against someone
    who only has the database, not against someone who has the app.
    """
    digest = hashlib.sha256(settings.backend_encryption_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_data(text: str) -> str:
    """Symmetrically encrypt text with Fernet (AES-128-CBC + HMAC) using the configured key."""
    if not text:
        return ""
    return get_fernet_cipher().encrypt(text.encode()).decode()


def decrypt_data(ciphertext: str) -> str:
    """Decrypt Fernet ciphertext produced by encrypt_data."""
    if not ciphertext:
        return ""
    try:
        return get_fernet_cipher().decrypt(ciphertext.encode()).decode()
    except Exception as e:
        logger.error(f"Failed to decrypt document chunk content: {e}")
        return "[Decryption Error]"


def parse_embedding(value) -> List[float]:
    """Supabase returns pgvector columns as a string like "[0.1,0.2]" and json columns as a list."""
    if isinstance(value, str):
        value = json.loads(value)
    return [float(v) for v in value]


def escape_tag(value: str) -> str:
    """Escape a value for use inside a RediSearch TAG filter."""
    return re.sub(r"([\-.,<>{}\[\]\"'/\\!@#\$%^&*()+=~|?:;\s])", r"\\\1", value)


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

    def restore_chunks_from_cloud(self, audio_id: str, token: str) -> int:
        """If Redis has no chunks for this session, download them from Supabase. Returns how many were restored."""
        if redis_client.session_chunk_keys(audio_id):
            return 0
        logger.info(f"No local chunks for session {audio_id}. Restoring from Supabase...")
        try:
            res = requests.get(
                rest_url("document_chunks"),
                headers=user_headers(token),
                params={"session_id": f"eq.{audio_id}", "select": "*"},
                timeout=10,
            )
        except requests.RequestException as e:
            logger.warning(f"Error restoring chunks from Supabase: {e}")
            return 0
        if res.status_code != 200:
            logger.warning(f"Could not check Supabase chunks: status {res.status_code}")
            return 0

        restored = 0
        for cc in res.json():
            try:
                redis_client.save_chunk(
                    session_id=cc["session_id"],
                    idx=int(cc["chunk_index"]),
                    content=cc["content"],
                    embedding=parse_embedding(cc["embedding"]),
                    user_id=str(cc["user_id"]),
                    synced=True
                )
                restored += 1
            except (KeyError, TypeError, ValueError) as e:
                logger.warning(f"Skipping malformed cloud chunk: {e}")
        logger.info(f"Restored {restored} chunks for session {audio_id} from Supabase.")
        return restored

    def ingest_audio_transcript(self, audio_id: str, transcript: str, token: str, user_id: str, chunk_size: int = 1000, chunk_overlap: int = 150) -> int:
        """Chunk, embed, and store a transcript locally in Redis and in Supabase.

        A session can hold several sources: new chunks are numbered after the existing ones
        so earlier sources are never overwritten.

        Returns:
            Number of stored chunks.
        """
        chunks = self.chunk_text(transcript, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
        if not chunks:
            logger.warning("No text chunks generated for ingestion.")
            return 0

        embeddings = self.generate_embeddings(chunks)

        # Ensure the vector index exists in local Redis
        redis_client.create_vector_index(dim=self.vector_dim)

        # Make sure earlier sources are present locally before numbering the new chunks.
        self.restore_chunks_from_cloud(audio_id, token)
        offset = len(redis_client.session_chunk_keys(audio_id))

        # 1. Save all chunks locally in Redis first
        rows = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            idx = offset + i
            enc_chunk = encrypt_data(chunk)
            redis_client.save_chunk(
                session_id=audio_id,
                idx=idx,
                content=enc_chunk,
                embedding=embedding,
                user_id=user_id,
                synced=False
            )
            rows.append({
                "session_id": audio_id,
                "chunk_index": idx,
                "content": enc_chunk,
                "embedding": embedding,
                "user_id": user_id
            })

        # 2. Try uploading to Supabase; unsynced chunks are retried by /sync
        try:
            logger.info(f"Attempting to sync {len(rows)} chunks to Supabase...")
            res = requests.post(
                rest_url("document_chunks"),
                json=rows,
                headers=user_headers(token, json_body=True, prefer="return=minimal"),
                timeout=10,
            )
            if res.status_code in (200, 201):
                logger.info("Successfully synced vectors to Supabase.")
                for row in rows:
                    redis_client.mark_chunk_synced(f"chunk:{audio_id}:{row['chunk_index']}")
            else:
                logger.warning(f"Failed to sync chunks to Supabase: status {res.status_code}. Chunks remain queued offline.")
        except requests.RequestException as e:
            logger.warning(f"Could not reach Supabase for vector sync: {e}. Chunks remain queued offline.")

        return len(chunks)

    def retrieve_context(self, question: str, token: str, user_id: str, audio_id: str, k: int = 6) -> List[dict]:
        """Retrieve the top k chunks of this user's session from the local Redis vector store."""
        self.load_model()
        if not self.embedding_model:
            logger.error("Embedding model not loaded.")
            return []

        if not redis_client.client:
            logger.error("Redis client is not connected. Local search aborted.")
            return []

        # Lazy restore: if this device has no chunks for the session yet, fetch them from Supabase.
        self.restore_chunks_from_cloud(audio_id, token)
        redis_client.create_vector_index(dim=self.vector_dim)

        question_emb = self.embedding_model.encode([question])[0]
        query_vector = np.array(question_emb, dtype=np.float32).tobytes()

        # Always scope the search to the signed-in user AND the session.
        query_string = (
            f"(@user_id:{{{escape_tag(user_id)}}} @session_id:{{{escape_tag(audio_id)}}})"
            f"=>[KNN {k} @embedding $query_vec AS vector_score]"
        )

        from redis.commands.search.query import Query
        q = Query(query_string)\
            .sort_by("vector_score")\
            .return_fields("content", "chunk_index", "session_id", "vector_score")\
            .dialect(2)

        try:
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

    def answer_question(self, question: str, token: str, user_id: str, audio_id: str) -> dict:
        """Retrieve relevant context chunks and generate a response using local Ollama."""
        # 1. Retrieve context chunks
        chunks = self.retrieve_context(question, token=token, user_id=user_id, audio_id=audio_id, k=6)

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
        from langchain_community.llms import Ollama
        model = get_active_model()
        logger.info(f"Generating response with local Ollama model '{model}'...")
        llm = Ollama(model=model)
        response = llm.invoke(prompt)
        logger.info("Ollama response generated successfully.")

        return {
            "answer": response.strip(),
            "context": chunks
        }


rag_pipeline = RAGPipeline()
