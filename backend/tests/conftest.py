import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["DATABASE_URL"] = "sqlite://"  # in-memory，必须在 import config 之前

from cryptography.fernet import Fernet

# 测试用稳定加密 key：避免自动生成流程在仓库里写出 backend/db/.encryption_key
os.environ.setdefault("PROMPTSCOPE_ENCRYPTION_KEY", Fernet.generate_key().decode())

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base
import models.entities  # noqa: F401  确保建表元数据注册


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, expire_on_commit=False)
    session = TestSession()
    yield session
    session.close()


@pytest.fixture()
def user_client(db_session):
    """A TestClient with a registered + logged-in user (cookie set).
    Exposes the created user id on client.user_id for convenience."""
    from fastapi.testclient import TestClient
    from db import get_db
    from main import app

    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        resp = c.post("/api/auth/register", json={
            "email": "owner@x.com", "password": "pw123456",
            "display_name": "Owner"})
        c.user_id = resp.json()["id"]
        yield c
    app.dependency_overrides.clear()
