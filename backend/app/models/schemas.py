from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


FULL_AGENT_LIMIT = 20


class SimulateRequest(BaseModel):
    policy: str = Field(min_length=1)
    n_agents: int = Field(default=30, ge=5, le=100)
    model_provider: Literal["openai"] = "openai"
    model_name: str = "gpt-5-mini"
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

    @model_validator(mode="after")
    def full_depth_limits_agents(self):
        if self.persona_depth == "full" and self.n_agents > FULL_AGENT_LIMIT:
            raise ValueError(
                f"persona_depth='full' supports at most {FULL_AGENT_LIMIT} agents (got {self.n_agents}). "
                "Use 'standard' for larger runs."
            )
        return self
