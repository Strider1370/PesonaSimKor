from typing import Literal

from pydantic import BaseModel, Field, field_validator


class SimulateRequest(BaseModel):
    policy: str = Field(min_length=1)
    n_agents: int = Field(default=30, ge=5, le=100)
    model_provider: Literal["ollama", "openai"] = "ollama"
    model_name: str = "qwen3.5:9b"
    thinking: bool = False
    persona_depth: Literal["minimal", "standard", "full"] = "standard"

    @field_validator("policy")
    @classmethod
    def policy_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("policy must not be blank")
        return stripped

    @field_validator("model_name")
    @classmethod
    def model_name_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("model_name must not be blank")
        return stripped
