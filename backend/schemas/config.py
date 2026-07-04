from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ProviderIn(BaseModel):
    project_id: str
    name: str = Field(max_length=128)
    base_url: str = Field(max_length=512)
    api_key: str | None = Field(default=None, max_length=512)
    provider_type: Literal["openai", "anthropic"] = "openai"


class ProviderOut(BaseModel):
    id: str
    project_id: str | None
    name: str
    base_url: str
    provider_type: str
    api_key_set: bool
    created_at: datetime


class PricingIn(BaseModel):
    project_id: str
    model: str = Field(max_length=128)
    input_price_per_1k: float = Field(ge=0)
    output_price_per_1k: float = Field(ge=0)
    provider_id: str | None = None


class PricingOut(BaseModel):
    id: str
    project_id: str | None
    model: str
    input_price_per_1k: float
    output_price_per_1k: float
    provider_id: str | None


class JudgeModelOut(BaseModel):
    model: str
    provider_name: str
