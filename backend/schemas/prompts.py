from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PromptCreate(BaseModel):
    project_id: str
    name: str = Field(max_length=255)
    content: str


class VersionCreate(BaseModel):
    content: str


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    version: int
    content: str
    created_at: datetime


class PromptSummary(BaseModel):
    id: str
    name: str
    version_count: int
    latest_version: int
    created_at: datetime


class PromptDetail(BaseModel):
    id: str
    name: str
    project_id: str
    versions: list[VersionOut]


class VersionTraceOut(BaseModel):
    id: str
    name: str
    origin: str
    total_cost: float | None
    created_at: datetime
