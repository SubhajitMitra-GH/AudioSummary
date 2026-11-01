"""The local Ollama models users can choose from, and which one is active on this computer.

The choice is stored in local Redis (per machine), because models are downloaded per machine.
LLM_MODEL in backend/.env is the default until the user picks something else.
"""
from dataclasses import asdict, dataclass

import redis

from app.config import settings
from app.redis_client import redis_client

ACTIVE_MODEL_KEY = "settings:llm_model"


@dataclass(frozen=True)
class ModelOption:
    id: str            # Ollama model name
    label: str
    description: str
    size_gb: float     # approximate download size
    recommended: bool = False


MODEL_CATALOG: list[ModelOption] = [
    ModelOption(
        id="llama3.2:1b",
        label="Fast",
        description="Smallest and quickest. Good for short factual questions; summaries are simpler.",
        size_gb=1.3,
    ),
    ModelOption(
        id="llama3.2:3b",
        label="Balanced",
        description="Recommended for most Macs. Good answers and summaries at half the size of Mistral.",
        size_gb=2.0,
        recommended=True,
    ),
    ModelOption(
        id="mistral",
        label="Best quality",
        description="Larger 7B model. Most detailed answers, but slower and needs 8 GB+ of free memory.",
        size_gb=4.1,
    ),
]


def available_models() -> list[ModelOption]:
    """The catalog, plus a custom LLM_MODEL from .env if it isn't one of the catalog models."""
    models = list(MODEL_CATALOG)
    if settings.llm_model not in {m.id for m in models}:
        models.append(ModelOption(
            id=settings.llm_model,
            label="Custom",
            description="Set with LLM_MODEL in backend/.env.",
            size_gb=0,
        ))
    return models


def is_known_model(model_id: str) -> bool:
    return any(m.id == model_id for m in available_models())


def get_active_model() -> str:
    try:
        chosen = redis_client.client.get(ACTIVE_MODEL_KEY) if redis_client.client else None
    except redis.RedisError:
        chosen = None
    if chosen and is_known_model(chosen):
        return chosen
    return settings.llm_model


def set_active_model(model_id: str) -> None:
    if not is_known_model(model_id):
        raise ValueError(f"Unknown model: {model_id}")
    redis_client.client.set(ACTIVE_MODEL_KEY, model_id)


def is_installed(model_id: str, installed_names: list[str]) -> bool:
    """Ollama lists "mistral" as "mistral:latest" (or another tag); "llama3.2:3b" is listed as-is.
    "mistral" must not match "mistral-nemo"."""
    return any(name == model_id or name.startswith(f"{model_id}:") for name in installed_names)


def describe(option: ModelOption, active: str, installed_names: list[str] | None) -> dict:
    return {
        **asdict(option),
        "installed": installed_names is not None and is_installed(option.id, installed_names),
        "active": option.id == active,
    }
