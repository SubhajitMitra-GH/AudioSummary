import os
import re
import logging
from typing import List
import numpy as np
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
from app.redis_client import redis_client
from app.config import settings

logger = logging.getLogger("uvicorn.error")

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

    def ingest_audio_transcript(self, audio_id: str, transcript: str, chunk_size: int = 1000, chunk_overlap: int = 150) -> int:
        """Pipeline function to chunk, embed, and store transcript in Redis.
        
        Returns:
            Number of successfully stored chunks.
        """
        chunks = self.chunk_text(transcript, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
        if not chunks:
            logger.warning("No text chunks generated for ingestion.")
            return 0

        embeddings = self.generate_embeddings(chunks)
        
        # Ensure the vector index exists in Redis
        redis_client.create_vector_index(dim=self.vector_dim)

        if not redis_client.client:
            logger.error("Redis client is not connected.")
            raise RuntimeError("Redis client is not connected.")

        logger.info(f"Storing {len(chunks)} chunks in Redis...")
        
        import uuid
        file_id = uuid.uuid4()
        
        stored_count = 0
        for idx, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            key = f"chunk:{audio_id}:{file_id}:{idx}"
            
            # Convert float list to float32 binary format for Redis VSS
            emb_bytes = np.array(embedding, dtype=np.float32).tobytes()
            
            fields = {
                "audio_id": audio_id,
                "chunk_index": idx,
                "content": chunk,
                "embedding": emb_bytes
            }
            
            redis_client.client.hset(key, mapping=fields)
            stored_count += 1

        logger.info(f"Successfully stored {stored_count} chunks in Redis.")
        return stored_count

    def retrieve_context(self, question: str, audio_id: str | None = None, k: int = 6) -> List[dict]:
        """Retrieve top k relevant context chunks from Redis vector store."""
        self.load_model()
        if not self.embedding_model:
            logger.error("Embedding model not loaded.")
            return []

        logger.info(f"Embedding query: '{question}'")
        question_emb = self.embedding_model.encode([question])[0]
        query_vector = np.array(question_emb, dtype=np.float32).tobytes()

        # Build query string: if audio_id is supplied, pre-filter by it
        if audio_id:
            escaped_audio_id = re.sub(r"([\-.,<>{}\[\]\"'/\\!@#\$%^&*()+=~|?:;])", r"\\\1", audio_id)
            query_string = f"(@audio_id:{{{escaped_audio_id}}})=>[KNN {k} @embedding $query_vec AS vector_score]"
        else:
            query_string = f"*=>[KNN {k} @embedding $query_vec AS vector_score]"

        from redis.commands.search.query import Query

        q = Query(query_string)\
            .sort_by("vector_score")\
            .return_fields("content", "chunk_index", "audio_id", "vector_score")\
            .dialect(2)

        if not redis_client.client:
            logger.error("Redis client is not connected.")
            return []

        try:
            logger.info(f"Querying Redis Vector DB with string: {query_string}")
            results = redis_client.client.ft("vector_idx").search(q, query_params={"query_vec": query_vector})
            retrieved_chunks = []
            for doc in results.docs:
                retrieved_chunks.append({
                    "content": doc.content,
                    "chunk_index": int(doc.chunk_index) if hasattr(doc, "chunk_index") else 0,
                    "audio_id": doc.audio_id if hasattr(doc, "audio_id") else "",
                    "score": float(doc.vector_score) if hasattr(doc, "vector_score") else 0.0
                })
            logger.info(f"Retrieved {len(retrieved_chunks)} relevant chunks from Redis.")
            return retrieved_chunks
        except Exception as e:
            logger.error(f"Error during vector retrieval from Redis: {e}")
            return []

    def answer_question(self, question: str, audio_id: str | None = None) -> dict:
        """Retrieve relevant context chunks and generate a response using local Ollama."""
        # 1. Retrieve context chunks
        chunks = self.retrieve_context(question, audio_id=audio_id, k=6)
        
        # 2. Extract contents and build context text
        context_text = "\n\n".join([f"[Chunk {c['chunk_index']}]: {c['content']}" for c in chunks])
        
        # 3. Create prompt
        prompt = f"""You are an expert assistant summarizing and answering questions about an audio recording.
Answer the user's question using the provided transcription context below. Support your answer with facts directly from the context.

Speaker Resolution Guidelines:
- Resolve name variations and references logically (e.g., resolving full names, abbreviations, or pronouns like associating 'Mark' with 'Mark Bombe' / 'Mr. Bombe').
- In speech blocks, attribute statements to the speaker who introduced the block (like Mr. Bombe) even if there are short side comments or interruptions in the transcript.

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
