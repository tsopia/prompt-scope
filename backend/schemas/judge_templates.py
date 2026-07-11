from datetime import datetime

from pydantic import BaseModel, Field


class JudgeTemplateIn(BaseModel):
    project_id: str
    name: str = Field(max_length=120)
    content: str = Field(max_length=8000)


class JudgeTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    content: str | None = Field(default=None, max_length=8000)


class JudgeTemplateOut(BaseModel):
    id: str
    project_id: str
    name: str
    content: str
    created_by: str | None
    created_by_name: str | None
    created_at: datetime
