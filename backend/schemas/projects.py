from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProjectCreate(BaseModel):
    name: str = Field(max_length=255)


class ProjectRename(BaseModel):
    name: str = Field(max_length=255)
    # 未出现在请求体中 -> 保持不变；显式传 null -> 清空（见 model_fields_set 用法）
    summary_model: str | None = Field(default=None, max_length=128)


class ProjectOut2(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    summary_model: str | None = None
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
