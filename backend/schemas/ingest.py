from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class TraceIn(BaseModel):
    id: str = Field(max_length=64)
    name: str = ""
    origin: Literal["live", "replay"] = "live"
    status: Literal["running", "success", "error"] = "success"
    input: Any = None
    output: Any = None
    metadata: dict | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    prompt_version_id: str | None = None


class ObservationIn(BaseModel):
    id: str = Field(max_length=64)
    parent_id: str | None = None
    type: Literal["llm", "tool", "span"]
    name: str = ""
    seq: int = 0
    status: Literal["success", "error"] = "success"
    error: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    metadata: dict | None = None
    # llm
    model: str | None = None
    model_params: dict | None = None
    messages: list | None = None
    tool_definitions: list | None = None
    tool_calls: list | None = None
    completion: Any = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    prompt_version_id: str | None = None
    # tool
    tool_input: Any = None
    tool_output: Any = None

    @model_validator(mode="after")
    def check_type_required_fields(self) -> "ObservationIn":
        if self.type == "llm":
            if self.messages is None:
                raise ValueError("llm observation requires messages")
            if not self.model:
                raise ValueError("llm observation requires model")
        if self.type == "tool":
            if self.tool_input is None:
                raise ValueError("tool observation requires tool_input")
            if self.tool_output is None and self.error is None:
                raise ValueError("tool observation requires tool_output or error")
        return self


class IngestRequest(BaseModel):
    trace: TraceIn
    observations: list[ObservationIn] = []
