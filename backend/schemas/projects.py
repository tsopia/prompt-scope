from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProjectCreate(BaseModel):
    name: str = Field(max_length=255)


class ProjectRename(BaseModel):
    name: str = Field(max_length=255)


class ProjectOut2(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    created_at: datetime


class KeyCreateIn(BaseModel):
    name: str | None = Field(default=None, max_length=120)


class KeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    prefix: str
    name: str | None
    created_at: datetime
    revoked_at: datetime | None
    last_used_at: datetime | None


class KeyCreated(BaseModel):
    id: str
    prefix: str
    name: str | None
    key: str
