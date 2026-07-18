from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from db import Base
from db_migrate import ensure_columns


def test_ensure_columns_adds_missing_column():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    # 手工建一个缺 score_b 列的 evaluations 表（模拟旧库）
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE evaluations (id VARCHAR(32) PRIMARY KEY, "
            "project_id VARCHAR(32), subject_trace_id VARCHAR(64), "
            "compare_trace_id VARCHAR(64), judge_model VARCHAR(128), "
            "context_mode VARCHAR(16), score FLOAT, verdict VARCHAR(32), "
            "reasoning TEXT, cost FLOAT, created_at DATETIME)"))
    ensure_columns(bind=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("evaluations")}
    assert "score_b" in cols


def test_ensure_columns_noop_on_current_schema():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    ensure_columns(bind=engine)  # 不应抛错
    cols = {c["name"] for c in inspect(engine).get_columns("evaluations")}
    assert "score_b" in cols


def test_ensure_columns_adds_judge_template_columns_to_evaluations():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    # 手工建一个缺 judge_template_id/prompt_fingerprint 列的 evaluations 表
    # （模拟多评分模板功能上线前的旧库）
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE evaluations (id VARCHAR(32) PRIMARY KEY, "
            "project_id VARCHAR(32), subject_trace_id VARCHAR(64), "
            "compare_trace_id VARCHAR(64), judge_model VARCHAR(128), "
            "context_mode VARCHAR(16), score FLOAT, score_b FLOAT, "
            "verdict VARCHAR(32), reasoning TEXT, cost FLOAT, created_at DATETIME)"))
    ensure_columns(bind=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("evaluations")}
    assert {"judge_template_id", "prompt_fingerprint"} <= cols


def test_ensure_columns_adds_structured_judge_output_columns_to_evaluations():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    # 手工建一个缺 dimensions/evidence/evidence_step/confidence 列的 evaluations 表
    # （模拟结构化 judge 输出功能上线前的旧库）
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE evaluations (id VARCHAR(32) PRIMARY KEY, "
            "project_id VARCHAR(32), subject_trace_id VARCHAR(64), "
            "compare_trace_id VARCHAR(64), judge_model VARCHAR(128), "
            "context_mode VARCHAR(16), score FLOAT, score_b FLOAT, "
            "verdict VARCHAR(32), reasoning TEXT, cost FLOAT, "
            "judge_template_id VARCHAR(32), prompt_fingerprint VARCHAR(32), "
            "created_at DATETIME)"))
    ensure_columns(bind=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("evaluations")}
    assert {"dimensions", "evidence", "evidence_step", "confidence"} <= cols


def test_ensure_columns_adds_trace_summary_column():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    # 手工建一个缺 summary 列的 traces 表（模拟旧库）
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE traces (id VARCHAR(64) PRIMARY KEY, project_id VARCHAR(32), "
            "name VARCHAR(255), origin VARCHAR(16), status VARCHAR(16), "
            "input JSON, output JSON, metadata JSON, started_at DATETIME, "
            "ended_at DATETIME, latency_ms INTEGER, total_input_tokens INTEGER, "
            "total_output_tokens INTEGER, total_cost FLOAT, prompt_version_id VARCHAR(32), "
            "created_at DATETIME, updated_at DATETIME)"))
    ensure_columns(bind=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("traces")}
    assert "summary" in cols


def test_ensure_columns_adds_project_summary_model_column():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    # 手工建一个缺 summary_model 列的 projects 表（模拟旧库）
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE projects (id VARCHAR(32) PRIMARY KEY, name VARCHAR(255), "
            "owner_id VARCHAR(32), created_at DATETIME)"))
    ensure_columns(bind=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("projects")}
    assert "summary_model" in cols


def test_ensure_columns_rejects_not_null_column_without_default():
    import pytest
    from sqlalchemy import Column, Integer, MetaData, Table, create_engine, text
    from sqlalchemy.pool import StaticPool
    from unittest.mock import patch

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    meta = MetaData()
    Table("t1", meta, Column("id", Integer, primary_key=True),
          Column("required_new", Integer, nullable=False))
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE t1 (id INTEGER PRIMARY KEY)"))

    import db_migrate
    with patch.object(db_migrate.Base, "metadata", meta):
        with pytest.raises(RuntimeError, match="NOT NULL"):
            db_migrate.ensure_columns(bind=engine)
