from pydantic import BaseModel, Field, field_validator


class SimulateRequest(BaseModel):
    policy: str = Field(min_length=1)
    n_agents: int = Field(default=30, ge=5, le=100)

    @field_validator("policy")
    @classmethod
    def policy_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("policy must not be blank")
        return stripped
