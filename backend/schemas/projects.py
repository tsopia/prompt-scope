from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProjectCreate(BaseModel):
    name: str = Field(max_length=255)


class ProjectOut2(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    created_at: datetime


class KeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    prefix: str
    created_at: datetime
    revoked_at: datetime | None


class KeyCreated(BaseModel):
    id: str
    prefix: str
    key: str
