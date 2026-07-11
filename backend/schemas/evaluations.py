from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class EvaluateRequest(BaseModel):
    subject_trace_id: str
    compare_trace_id: str | None = None
    judge_models: list[str] = Field(min_length=1)
    context_mode: Literal["output_only", "with_trace"] = "output_only"
    force: bool = False
    judge_template_id: str | None = None


class EvaluationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    subject_trace_id: str
    compare_trace_id: str | None
    judge_model: str
    context_mode: str
    score: float | None
    score_b: float | None
    verdict: str | None
    reasoning: str | None
    cost: float | None
    judge_template_id: str | None
    judge_template_name: str | None = None
    created_at: datetime


class JudgeRunResult(BaseModel):
    judge_model: str
    status: Literal["ok", "error"]
    evaluation: EvaluationOut | None = None
    error: str | None = None


class EvaluateResponse(BaseModel):
    results: list[JudgeRunResult]


class BatchEvaluateRequest(BaseModel):
    subject_trace_ids: list[str] = Field(min_length=1, max_length=50)
    judge_models: list[str] = Field(min_length=1)
    context_mode: Literal["output_only", "with_trace"] = "output_only"
    force: bool = False
    judge_template_id: str | None = None


class BatchEvaluateItem(BaseModel):
    subject_trace_id: str
    judge_model: str
    status: Literal["ok", "error"]
    evaluation: EvaluationOut | None = None
    error: str | None = None


class BatchEvaluateResponse(BaseModel):
    results: list[BatchEvaluateItem]
