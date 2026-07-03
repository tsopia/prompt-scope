import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import Base, engine
import models.entities  # noqa: F401  确保建表元数据注册
from routers import ingest as ingest_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("db", exist_ok=True)
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="PromptScope", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest_router.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
