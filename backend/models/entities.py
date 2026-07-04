import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


def gen_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    owner_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    api_keys: Mapped[list["ApiKey"]] = relationship(back_populates="project")


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    prefix: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped["Project"] = relationship(back_populates="api_keys")


class Trace(Base):
    __tablename__ = "traces"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # 客户端生成
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    origin: Mapped[str] = mapped_column(String(16), default="live")  # live | replay
    status: Mapped[str] = mapped_column(String(16), default="success")  # running | success | error
    input: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    output: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    meta: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    prompt_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("prompt_versions.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    observations: Mapped[list["Observation"]] = relationship(
        back_populates="trace", order_by="Observation.seq",
        cascade="all, delete-orphan")


class Observation(Base):
    __tablename__ = "observations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # 客户端生成
    trace_id: Mapped[str] = mapped_column(ForeignKey("traces.id"), index=True)
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("observations.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(8))  # llm | tool | span
    name: Mapped[str] = mapped_column(String(255), default="")
    seq: Mapped[int] = mapped_column(Integer, default=0)  # trace 内稳定排序
    status: Mapped[str] = mapped_column(String(16), default="success")  # success | error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    meta: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)

    # llm 专属
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    model_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    messages: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tool_definitions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tool_calls: Mapped[list | None] = mapped_column(JSON, nullable=True)
    completion: Mapped[dict | list | str | None] = mapped_column(JSON, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    prompt_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("prompt_versions.id"), nullable=True)

    # tool 专属
    tool_input: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    tool_output: Mapped[dict | list | str | None] = mapped_column(JSON, nullable=True)

    trace: Mapped["Trace"] = relationship(back_populates="observations")


class Prompt(Base):
    __tablename__ = "prompts"
    __table_args__ = (UniqueConstraint("project_id", "name"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    versions: Mapped[list["PromptVersion"]] = relationship(
        back_populates="prompt", order_by="PromptVersion.version")


class PromptVersion(Base):
    __tablename__ = "prompt_versions"
    __table_args__ = (UniqueConstraint("prompt_id", "version"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    prompt_id: Mapped[str] = mapped_column(ForeignKey("prompts.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    variables: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    prompt: Mapped["Prompt"] = relationship(back_populates="versions")


class ReplayRun(Base):
    __tablename__ = "replay_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    source_trace_id: Mapped[str] = mapped_column(ForeignKey("traces.id"), index=True)
    result_trace_id: Mapped[str | None] = mapped_column(ForeignKey("traces.id"), nullable=True)
    target_observation_id: Mapped[str | None] = mapped_column(
        ForeignKey("observations.id"), nullable=True)  # 多阶段单点回放用
    override_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    override_model_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    override_prompt_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("prompt_versions.id"), nullable=True)
    override_prompt_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    # pending | running | success | failed
    divergences: Mapped[list | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    subject_trace_id: Mapped[str] = mapped_column(ForeignKey("traces.id"), index=True)
    compare_trace_id: Mapped[str | None] = mapped_column(ForeignKey("traces.id"), nullable=True)
    judge_model: Mapped[str] = mapped_column(String(128))
    context_mode: Mapped[str] = mapped_column(String(16), default="output_only")
    # output_only | with_trace
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_b: Mapped[float | None] = mapped_column(Float, nullable=True)
    verdict: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ModelProvider(Base):
    __tablename__ = "model_providers"
    __table_args__ = (UniqueConstraint("project_id", "name"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    base_url: Mapped[str] = mapped_column(String(512))
    api_key: Mapped[str] = mapped_column(String(512))  # 内部平台，明文存储
    provider_type: Mapped[str] = mapped_column(String(16), default="openai")
    # openai | anthropic
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ModelPricing(Base):
    __tablename__ = "model_pricings"
    __table_args__ = (UniqueConstraint("project_id", "model"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id"), nullable=True, index=True)
    model: Mapped[str] = mapped_column(String(128), index=True)
    input_price_per_1k: Mapped[float] = mapped_column(Float)
    output_price_per_1k: Mapped[float] = mapped_column(Float)
    provider_id: Mapped[str | None] = mapped_column(
        ForeignKey("model_providers.id"), nullable=True)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("auth_source", "external_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255), default="")
    password_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    auth_source: Mapped[str] = mapped_column(String(16), default="local")  # local | oidc | ldap
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(16), default="member")  # owner | member
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
