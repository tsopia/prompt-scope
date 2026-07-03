from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.entities import ModelPricing, Observation, Trace
from schemas.ingest import IngestRequest, ObservationIn


def compute_cost(db: Session, model: str | None,
                 input_tokens: int | None, output_tokens: int | None) -> float | None:
    if not model or input_tokens is None or output_tokens is None:
        return None
    pricing = db.query(ModelPricing).filter(ModelPricing.model == model).first()
    if pricing is None:
        return None
    return (input_tokens / 1000 * pricing.input_price_per_1k
            + output_tokens / 1000 * pricing.output_price_per_1k)


def _latency_ms(start, end) -> int | None:
    if start is None or end is None:
        return None
    return int((end - start).total_seconds() * 1000)


def _apply_observation(db: Session, trace_id: str, data: ObservationIn) -> None:
    ob = db.get(Observation, data.id)
    if ob is not None and ob.trace_id != trace_id:
        raise HTTPException(status_code=409,
                            detail="observation id already exists in another trace")
    if ob is None:
        ob = Observation(id=data.id, trace_id=trace_id)
        db.add(ob)
    ob.parent_id = data.parent_id
    ob.type = data.type
    ob.name = data.name
    ob.seq = data.seq
    ob.status = data.status
    ob.error = data.error
    ob.started_at = data.started_at
    ob.ended_at = data.ended_at
    ob.latency_ms = _latency_ms(data.started_at, data.ended_at)
    ob.meta = data.metadata
    ob.model = data.model
    ob.model_params = data.model_params
    ob.messages = data.messages
    ob.tool_definitions = data.tool_definitions
    ob.tool_calls = data.tool_calls
    ob.completion = data.completion
    ob.input_tokens = data.input_tokens
    ob.output_tokens = data.output_tokens
    ob.prompt_version_id = data.prompt_version_id
    ob.tool_input = data.tool_input
    ob.tool_output = data.tool_output
    if data.type == "llm":
        ob.cost = compute_cost(db, data.model, data.input_tokens, data.output_tokens)


def _recompute_aggregates(db: Session, trace: Trace) -> None:
    rows = db.query(Observation).filter(Observation.trace_id == trace.id).all()
    trace.total_input_tokens = sum(o.input_tokens or 0 for o in rows)
    trace.total_output_tokens = sum(o.output_tokens or 0 for o in rows)
    costs = [o.cost for o in rows if o.cost is not None]
    trace.total_cost = sum(costs) if costs else None


def ingest(db: Session, project_id: str, payload: IngestRequest, _retry: bool = True) -> Trace:
    data = payload.trace
    trace = db.get(Trace, data.id)
    if trace is not None and trace.project_id != project_id:
        raise HTTPException(status_code=409,
                            detail="trace id already exists in another project")
    if trace is None:
        trace = Trace(id=data.id, project_id=project_id)
        db.add(trace)
    trace.name = data.name
    trace.origin = data.origin
    trace.status = data.status
    trace.input = data.input
    trace.output = data.output
    trace.meta = data.metadata
    trace.started_at = data.started_at
    trace.ended_at = data.ended_at
    trace.latency_ms = _latency_ms(data.started_at, data.ended_at)
    trace.prompt_version_id = data.prompt_version_id

    for ob_data in payload.observations:
        _apply_observation(db, trace.id, ob_data)

    db.flush()
    _recompute_aggregates(db, trace)
    try:
        db.commit()
    except IntegrityError:
        # Two concurrent requests for the same new trace/observation id can both
        # pass the db.get()-returns-None check above and then race on INSERT;
        # the loser hits a unique-constraint violation. Roll back and retry
        # once so the retry's db.get() sees the winner's row and upserts onto
        # it instead of failing the request outright.
        db.rollback()
        if not _retry:
            raise
        return ingest(db, project_id, payload, _retry=False)
    return trace
