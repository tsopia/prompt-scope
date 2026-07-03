from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Project
from schemas.ingest import IngestRequest
from services.auth import require_api_key
from services.ingest_service import ingest

router = APIRouter(tags=["ingest"])


@router.post("/ingest")
def ingest_endpoint(
    payload: IngestRequest,
    project: Project = Depends(require_api_key),
    db: Session = Depends(get_db),
):
    trace = ingest(db, project.id, payload)
    return {"trace_id": trace.id, "observation_count": len(payload.observations)}
