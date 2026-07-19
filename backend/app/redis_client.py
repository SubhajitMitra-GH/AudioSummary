import redis
import json
import logging
from typing import List, Dict, Any
from app.config import settings

logger = logging.getLogger("uvicorn.error")

class RedisClient:
    def __init__(self):
        self.client: redis.Redis | None = None
        self.vector_idx_name = "vector_idx"

    def connect(self):
        """Initialize the Redis connection."""
        try:
            logger.info(f"Connecting to Redis at {settings.redis_host}:{settings.redis_port}")
            self.client = redis.Redis(
                host=settings.redis_host,
                port=settings.redis_port,
                db=settings.redis_db,
                password=settings.redis_password,
                decode_responses=True,
                socket_timeout=5.0
            )
            # Verify connectivity
            self.client.ping()
            logger.info("Successfully connected to Redis.")
        except redis.ConnectionError as e:
            logger.error(f"Failed to connect to Redis: {e}")
            self.client = None

    def disconnect(self):
        """Close the Redis connection."""
        if self.client:
            self.client.close()
            logger.info("Redis connection closed.")
            self.client = None

    def ping(self) -> bool:
        """Verify the connection is alive."""
        if not self.client:
            return False
        try:
            return self.client.ping()
        except redis.ConnectionError:
            return False

    def create_vector_index(self, dim: int = 384):
        """Create a vector index in Redis for HNSW vector search if it does not exist."""
        if not self.client:
            logger.error("Cannot create index: Redis client is not connected.")
            return

        try:
            # Check if index already exists and verify its schema is up to date
            info = self.client.ft(self.vector_idx_name).info()
            attributes = info.get("attributes", [])
            has_session_id = False
            for attr in attributes:
                # attr format in redis search info: ['identifier', 'session_id', 'attribute', ...]
                if len(attr) > 1 and (attr[0] == "session_id" or attr[1] == "session_id"):
                    has_session_id = True
                    break
            if not has_session_id:
                logger.info(f"Index '{self.vector_idx_name}' is using an outdated schema. Dropping and recreating index...")
                self.client.ft(self.vector_idx_name).dropindex(delete_documents=False)
                raise Exception("Outdated schema structure detected.")
                
            logger.info(f"Vector index '{self.vector_idx_name}' already exists with correct schema.")
        except Exception:
            # Index does not exist or was dropped due to schema mismatch, create it
            from redis.commands.search.field import TextField, TagField, VectorField
            from redis.commands.search.index_definition import IndexDefinition, IndexType

            schema = (
                TagField("session_id"),
                TagField("user_id"),
                TextField("content"),
                VectorField(
                    "embedding",
                    "HNSW",
                    {
                        "TYPE": "FLOAT32",
                        "DIM": dim,
                        "DISTANCE_METRIC": "COSINE",
                        "M": 16,
                        "EF_CONSTRUCTION": 200
                    }
                )
            )

            try:
                logger.info(f"Creating vector index '{self.vector_idx_name}' with dimension {dim}...")
                self.client.ft(self.vector_idx_name).create_index(
                    schema,
                    definition=IndexDefinition(
                        prefix=["chunk:"],
                        index_type=IndexType.HASH
                    )
                )
                logger.info(f"Vector index '{self.vector_idx_name}' created successfully.")
            except Exception as e:
                logger.error(f"Failed to create vector index '{self.vector_idx_name}': {e}")
                raise e

    # --- SESSION CACHE METHODS ---

    def save_session(self, session_id: str, user_id: str, title: str, created_at: str, synced: bool = False):
        if not self.client:
            return
        key = f"session:{session_id}"
        mapping = {
            "id": session_id,
            "user_id": user_id,
            "session_title": title,
            "created_at": created_at,
            "synced": str(synced)
        }
        self.client.hset(key, mapping=mapping)
        # Add to user's set of sessions
        self.client.sadd(f"user_sessions:{user_id}", session_id)
        logger.info(f"Cached session {session_id} in Redis (synced={synced}).")

    def get_user_sessions(self, user_id: str) -> List[Dict[str, Any]]:
        if not self.client:
            return []
        session_ids = self.client.smembers(f"user_sessions:{user_id}")
        sessions = []
        for sid in session_ids:
            s_data = self.client.hgetall(f"session:{sid}")
            if s_data:
                # Convert string boolean
                s_data["synced"] = s_data.get("synced") == "True"
                sessions.append(s_data)
        # Sort chronologically descending
        sessions.sort(key=lambda s: s.get("created_at", ""), reverse=True)
        return sessions

    def delete_session(self, session_id: str):
        if not self.client:
            return
        # Get user_id first to clean sets
        s_data = self.client.hgetall(f"session:{session_id}")
        if s_data:
            user_id = s_data.get("user_id")
            if user_id:
                self.client.srem(f"user_sessions:{user_id}", session_id)
        
        # Delete session hash
        self.client.delete(f"session:{session_id}")

        # Delete all messages associated with the session
        msg_ids = self.client.zrange(f"session_messages:{session_id}", 0, -1)
        for mid in msg_ids:
            self.client.delete(f"message:{mid}")
        self.client.delete(f"session_messages:{session_id}")

        # Delete all document chunks associated with the session
        chunk_keys = self.client.keys(f"chunk:{session_id}:*")
        if chunk_keys:
            self.client.delete(*chunk_keys)

        logger.info(f"Deleted session {session_id} and all related messages/chunks from local Redis.")

    # --- MESSAGE CACHE METHODS ---

    def save_message(self, message_id: str, session_id: str, sender: str, text: str, created_at: str, score_timestamp: float, synced: bool = False):
        if not self.client:
            return
        key = f"message:{message_id}"
        mapping = {
            "id": message_id,
            "session_id": session_id,
            "sender": sender,
            "message_text": text,
            "created_at": created_at,
            "synced": str(synced)
        }
        self.client.hset(key, mapping=mapping)
        # Add message ID to chronological sorted set for this session
        self.client.zadd(f"session_messages:{session_id}", {message_id: score_timestamp})
        logger.info(f"Cached message {message_id} in Redis (synced={synced}).")

    def get_session_messages(self, session_id: str) -> List[Dict[str, Any]]:
        if not self.client:
            return []
        msg_ids = self.client.zrange(f"session_messages:{session_id}", 0, -1)
        messages = []
        for mid in msg_ids:
            m_data = self.client.hgetall(f"message:{mid}")
            if m_data:
                m_data["synced"] = m_data.get("synced") == "True"
                messages.append(m_data)
        return messages

    # --- VECTOR CHUNKS CACHE METHODS ---

    def save_chunk(self, session_id: str, idx: int, content: str, embedding: List[float], user_id: str, synced: bool = False):
        if not self.client:
            return
        # We save chunks prefix as chunk:{session_id}:{idx} so our HNSW index can automatically match them
        key = f"chunk:{session_id}:{idx}"
        import numpy as np
        emb_bytes = np.array(embedding, dtype=np.float32).tobytes()
        
        mapping = {
            "session_id": session_id,
            "chunk_index": idx,
            "content": content,
            "embedding": emb_bytes,
            "user_id": user_id,
            "synced": str(synced)
        }
        self.client.hset(key, mapping=mapping)
        logger.info(f"Cached chunk {idx} for session {session_id} in Redis (synced={synced}).")

    # --- OFFLINE SYNC WORKER FETCHERS ---

    def get_unsynced_sessions(self) -> List[Dict[str, Any]]:
        if not self.client:
            return []
        keys = self.client.keys("session:*")
        unsynced = []
        for k in keys:
            data = self.client.hgetall(k)
            if data and data.get("synced") == "False":
                unsynced.append(data)
        return unsynced

    def get_unsynced_messages(self) -> List[Dict[str, Any]]:
        if not self.client:
            return []
        keys = self.client.keys("message:*")
        unsynced = []
        for k in keys:
            data = self.client.hgetall(k)
            if data and data.get("synced") == "False":
                unsynced.append(data)
        return unsynced

    def get_unsynced_chunks(self) -> List[Dict[str, Any]]:
        if not self.client:
            return []
        keys = self.client.keys("chunk:*")
        if not keys:
            return []
            
        unsynced = []
        import numpy as np
        
        # Open a single raw client connection with decode_responses=False to safely read binary fields
        raw_client = redis.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            db=settings.redis_db,
            password=settings.redis_password,
            decode_responses=False
        )
        
        try:
            for k in keys:
                raw_data = raw_client.hgetall(k)
                if raw_data and raw_data.get(b"synced") == b"False":
                    # Decode strings manually
                    session_id = raw_data[b"session_id"].decode("utf-8")
                    chunk_index = int(raw_data[b"chunk_index"].decode("utf-8"))
                    content = raw_data[b"content"].decode("utf-8")
                    user_id = raw_data[b"user_id"].decode("utf-8")
                    synced = raw_data[b"synced"].decode("utf-8")
                    
                    # Convert raw bytes back to list of floats
                    raw_emb = raw_data.get(b"embedding")
                    if raw_emb:
                        emb_list = np.frombuffer(raw_emb, dtype=np.float32).tolist()
                    else:
                        emb_list = []
                        
                    unsynced.append({
                        "session_id": session_id,
                        "chunk_index": chunk_index,
                        "content": content,
                        "embedding": emb_list,
                        "user_id": user_id,
                        "synced": synced == "True",
                        "redis_key": k
                    })
        finally:
            raw_client.close()
            
        return unsynced

    def mark_session_synced(self, session_id: str):
        if self.client:
            self.client.hset(f"session:{session_id}", "synced", "True")

    def mark_message_synced(self, message_id: str):
        if self.client:
            self.client.hset(f"message:{message_id}", "synced", "True")

    def mark_chunk_synced(self, redis_key: str):
        if self.client:
            self.client.hset(redis_key, "synced", "True")

redis_client = RedisClient()
