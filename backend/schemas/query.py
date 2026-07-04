from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str


class TraceSummary(BaseModel):
    id: str
    name: str
    origin: str
    status: str
    model_summary: str
    observation_count: int
    total_input_tokens: int
    total_output_tokens: int
    total_cost: float | None
    latency_ms: int | None
    started_at: datetime | None
    created_at: datetime


class TraceListOut(BaseModel):
    items: list[TraceSummary]
    total: int


class ObservationNode(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    id: str
    parent_id: str | None
    type: str
    name: str
    seq: int
    status: str
    error: str | None
    started_at: datetime | None
    ended_at: datetime | None
    latency_ms: int | None
    model: str | None
    model_params: dict | None
    messages: list | None
    tool_definitions: list | None
    tool_calls: list | None
    completion: Any
    input_tokens: int | None
    output_tokens: int | None
    cost: float | None
    tool_input: Any
    tool_output: Any
    metadata: dict | None = Field(default=None, validation_alias="meta")
    children: list["ObservationNode"] = []


class TraceDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    name: str
    origin: str
    status: str
    input: Any
    output: Any
    started_at: datetime | None
    ended_at: datetime | None
    latency_ms: int | None
    total_input_tokens: int
    total_output_tokens: int
    total_cost: float | None
    created_at: datetime
    metadata: dict | None = None
    observations: list[ObservationNode]
