from pydantic import BaseModel
from typing import Optional, Dict, List
from datetime import datetime


class Candidate(BaseModel):
    id: str
    experiment_id: str
    input: str
    prompt_id: str
    prompt_version: Optional[int] = None
    model: str
    output: str
    cost: float
    latency: float
    score: Optional[float] = None
    input_tokens: Optional[int] = 0
    output_tokens: Optional[int] = 0
    status: Optional[str] = "completed"


class CompareRequest(BaseModel):
    candidate_a: str
    candidate_b: str


class CompareResult(BaseModel):
    id: Optional[str] = None
    candidate_a: str
    candidate_b: str
    replaceable: bool
    score_a: float
    score_b: float
    cost_diff: float
    reason: str
    created_at: Optional[str] = None
    from_cache: Optional[bool] = False


class Experiment(BaseModel):
    id: str
    input: str
    candidates: List[Candidate]


class SyncStatus(BaseModel):
    last_sync: Optional[str] = None
    count: int = 0
    status: str = "idle"
