import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import Base, engine
import models.entities  # noqa: F401  确保建表元数据注册
from routers import ingest as ingest_router
from routers import query as query_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("db", exist_ok=True)
    Base.metadata.create_all(bind=engine)
    from db_migrate import ensure_columns
    ensure_columns()
    yield


app = FastAPI(title="PromptScope", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # comma-separated list of allowed frontend origins, defaults to local dev
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest_router.router, prefix="/api")
app.include_router(query_router.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
