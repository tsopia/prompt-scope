from datetime import datetime
from pydantic import BaseModel, ConfigDict


class ReplayRequest(BaseModel):
    source_trace_id: str
    target_observation_id: str | None = None
    override_model: str | None = None
    override_model_params: dict | None = None
    override_prompt_text: str | None = None
    override_prompt_version_id: str | None = None


class ReplayRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_trace_id: str
    result_trace_id: str | None
    status: str
    override_model: str | None
    override_model_params: dict | None
    override_prompt_text: str | None
    override_prompt_version_id: str | None
    divergences: list | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None
