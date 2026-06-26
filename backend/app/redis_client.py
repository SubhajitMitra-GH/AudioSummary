import redis
from app.config import settings
import logging

logger = logging.getLogger("uvicorn.error")

class RedisClient:
    def __init__(self):
        self.client: redis.Redis | None = None

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

        index_name = "vector_idx"
        try:
            # Check if index already exists
            self.client.ft(index_name).info()
            logger.info(f"Vector index '{index_name}' already exists.")
        except Exception:
            # Index does not exist, create it
            from redis.commands.search.field import TextField, TagField, VectorField
            from redis.commands.search.index_definition import IndexDefinition, IndexType

            schema = (
                TagField("audio_id"),
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
                logger.info(f"Creating vector index '{index_name}' with dimension {dim}...")
                self.client.ft(index_name).create_index(
                    schema,
                    definition=IndexDefinition(
                        prefix=["chunk:"],
                        index_type=IndexType.HASH
                    )
                )
                logger.info(f"Vector index '{index_name}' created successfully.")
            except Exception as e:
                logger.error(f"Failed to create vector index '{index_name}': {e}")
                raise e

# Singleton instance
redis_client = RedisClient()
