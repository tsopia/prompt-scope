# User & Workspace System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user account system and workspace-membership model to PromptScope so it can be open-sourced (self-serve local accounts) and later dropped into a company that uses SSO (LDAP/OIDC) with minimal change.

**Architecture:** A `Project` *is* a workspace (one-level model — no separate Organization). Users log in via a pluggable `AuthProvider` seam (only `LocalPasswordProvider` ships now; OIDC/LDAP are future providers requiring zero schema change). A successful login mints an opaque server-side session token stored as a sha256 hash (mirroring the existing `ApiKey` pattern) and delivered as an `HttpOnly` cookie. Every query/config/replay/eval/prompt endpoint is gated on the session and scoped to the caller's project memberships. Ingestion stays API-key based and unchanged.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (sync engine, unchanged), `bcrypt` for password hashing, opaque cookie sessions (no JWT, no new signing secret), Next.js 14 App Router + React 18, `next-themes`, vitest + Playwright.

## Global Constraints

- **Sync engine only.** Do NOT introduce `AsyncSession` or async SQLAlchemy — the whole backend is sync (`db.py` `SessionLocal`). Do NOT adopt `fastapi-users` (it is async-first and in maintenance mode).
- **Migration guard rule.** `db_migrate.ensure_columns` only adds *nullable-or-defaulted* columns to existing tables; it raises on a NOT NULL column with no default. Every new column added to an existing table (`projects.owner_id`) MUST be nullable. New tables (`users`, `sessions`, `project_members`) are created by `Base.metadata.create_all` and are unconstrained by this rule.
- **SSO-readiness is a design requirement.** `User.auth_source` (`local|oidc|ldap`) and `User.external_id` MUST exist from day one, and login MUST route through the `AuthProvider` protocol, so adding OIDC/LDAP later is a new provider class + one router branch, not a schema change.
- **No secret leakage.** Session tokens and passwords are never returned by any endpoint (store sha256 of session token, bcrypt hash of password). Follow the existing `ApiKey` precedent: raw token shown to the client once via `Set-Cookie`, only the hash persisted.
- **Ingestion unchanged.** `POST /api/ingest` stays Bearer-API-key authenticated (`services/auth.require_api_key`). Do not add session auth to it.
- **git commits: no AI attribution of any kind.**
- **TDD.** Backend tests run with `cd backend && source .venv/bin/activate && python -m pytest tests/ -v`. Frontend: `cd frontend && npx vitest run` and `npm run e2e`.
- **Scope boundary:** Per-workspace isolation of `ModelProvider`/`ModelPricing` (they stay global, login-gated) is explicitly OUT of scope for this plan — see "Follow-up" at the end.

---

## File Structure

**Backend — new files:**
- `backend/services/passwords.py` — bcrypt hash/verify
- `backend/services/sessions.py` — session token mint/resolve/delete
- `backend/services/auth_providers.py` — `AuthProvider` protocol, `UserIdentity`, `LocalPasswordProvider`, `get_or_create_user`
- `backend/services/authz.py` — `get_current_user` dependency + membership assertions
- `backend/schemas/auth.py` — auth request/response models
- `backend/schemas/members.py` — member request/response models
- `backend/routers/auth.py` — register/login/logout/me
- `backend/routers/members.py` — workspace membership CRUD (mounted, or folded into projects router — see Task 8)
- `backend/scripts/create_user.py` — CLI bootstrap user
- `backend/scripts/backfill_owner.py` — assign ownerless legacy projects to a user
- `backend/tests/test_passwords.py`, `test_sessions.py`, `test_auth_providers.py`, `test_auth_api.py`, `test_authz.py`, `test_members_api.py`

**Backend — modified files:**
- `backend/models/entities.py` — add `User`, `Session`, `ProjectMember`; add `Project.owner_id`
- `backend/config.py` — auth env vars
- `backend/requirements.txt` — add `bcrypt`
- `backend/main.py` — mount auth + members routers
- `backend/routers/projects.py` — owner on create, membership on key ops
- `backend/routers/query.py` — session gate + membership scoping
- `backend/routers/config.py`, `routers/replay.py`, `routers/evaluations.py`, `routers/prompts.py` — session gate + scoping
- `backend/tests/conftest.py` — `user_client` fixture; existing per-router tests updated to authenticate

**Frontend — new files:**
- `frontend/contexts/AuthContext.tsx` — `useAuth`, `AuthProvider`
- `frontend/components/layout/AuthGate.tsx` — redirect-to-login guard
- `frontend/app/login/page.tsx` — login (+ register when enabled)
- `frontend/contexts/__tests__/AuthContext.test.tsx`, `frontend/app/login/__tests__/login.test.tsx`

**Frontend — modified files:**
- `frontend/lib/api.ts` — `credentials:"include"`; auth + members functions + types
- `frontend/app/layout.tsx` — wrap in `<AuthProvider>` + `<AuthGate>`
- `frontend/components/layout/AppSidebar.tsx` — real account section (user + logout)
- `frontend/app/settings/page.tsx` — "成员" (members) tab
- `frontend/e2e/journey.spec.ts` — log in at the start of the journey

---

# PHASE A — Backend auth foundation

### Task 1: User / Session / ProjectMember models + Project.owner_id

**Files:**
- Modify: `backend/models/entities.py`
- Modify: `backend/config.py`
- Modify: `backend/requirements.txt`
- Test: `backend/tests/test_models.py` (append)

**Interfaces:**
- Produces: `User(id, email, display_name, password_hash, auth_source, external_id, is_active, created_at)`, `Session(id, token_hash, user_id, created_at, expires_at)`, `ProjectMember(id, project_id, user_id, role, created_at)`, `Project.owner_id: str | None`. Roles are the string literals `"owner"` / `"member"`. `auth_source` literals: `"local"` / `"oidc"` / `"ldap"`.

- [ ] **Step 1: Add `bcrypt` to requirements**

Add this line to `backend/requirements.txt`:

```
bcrypt>=4.1.0
```

Then install: `cd backend && source .venv/bin/activate && pip install bcrypt>=4.1.0`

- [ ] **Step 2: Add auth config to `config.py`**

Append to `backend/config.py`:

```python
AUTH_ALLOW_REGISTRATION = os.getenv("AUTH_ALLOW_REGISTRATION", "true").lower() == "true"
SECURE_COOKIES = os.getenv("SECURE_COOKIES", "false").lower() == "true"
SESSION_TTL_DAYS = int(os.getenv("SESSION_TTL_DAYS", "30"))
SESSION_COOKIE_NAME = "ps_session"
```

- [ ] **Step 3: Write the failing model test**

Append to `backend/tests/test_models.py`:

```python
def test_user_session_member_models(db_session):
    from datetime import timedelta
    from models.entities import (
        User, Session as UserSession, ProjectMember, Project, utcnow)

    u = User(email="a@x.com", display_name="A", password_hash="h",
             auth_source="local")
    db_session.add(u)
    db_session.flush()
    assert u.id and u.is_active is True and u.external_id is None

    p = Project(name="grp", owner_id=u.id)
    db_session.add(p)
    db_session.flush()
    assert p.owner_id == u.id

    m = ProjectMember(project_id=p.id, user_id=u.id, role="owner")
    s = UserSession(token_hash="th", user_id=u.id,
                    expires_at=utcnow() + timedelta(days=30))
    db_session.add_all([m, s])
    db_session.commit()
    assert m.role == "owner" and s.user_id == u.id
```

- [ ] **Step 4: Run it, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_models.py::test_user_session_member_models -v`
Expected: FAIL with `ImportError: cannot import name 'User'`

- [ ] **Step 5: Add the models**

Append to `backend/models/entities.py`:

```python
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
```

Add `owner_id` to the existing `Project` class (nullable — migration-guard safe), right after the `name` column:

```python
    owner_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True)
```

`bool` columns map fine without an explicit type import (SQLAlchemy infers `Boolean` from the `Mapped[bool]` annotation). `UniqueConstraint` is already imported at the top of the file.

- [ ] **Step 6: Run it, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_models.py -v`
Expected: PASS (all model tests, including the new one)

- [ ] **Step 7: Verify migration guard accepts the new nullable column**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_migrate.py -v`
Expected: PASS (no NOT-NULL-without-default error for `projects.owner_id`)

- [ ] **Step 8: Commit**

```bash
cd backend && git add models/entities.py config.py requirements.txt tests/test_models.py
git commit -m "feat(auth): add User/Session/ProjectMember models and Project.owner_id"
```

---

### Task 2: Password + session services

**Files:**
- Create: `backend/services/passwords.py`
- Create: `backend/services/sessions.py`
- Test: `backend/tests/test_passwords.py`, `backend/tests/test_sessions.py`

**Interfaces:**
- Consumes: `services.auth.hash_key` (sha256, already exists), `models.entities.User`, `Session`, `utcnow`.
- Produces:
  - `passwords.hash_password(raw: str) -> str`, `passwords.verify_password(raw: str, hashed: str) -> bool`
  - `sessions.create_session(db: Session, user_id: str) -> str` (returns the raw cookie token, persists the hash)
  - `sessions.resolve_session(db: Session, raw: str | None) -> User | None` (None if missing/expired/inactive)
  - `sessions.delete_session(db: Session, raw: str) -> None`

- [ ] **Step 1: Write the failing password test**

Create `backend/tests/test_passwords.py`:

```python
from services.passwords import hash_password, verify_password


def test_hash_and_verify_password():
    h = hash_password("s3cret-pw")
    assert h != "s3cret-pw"
    assert verify_password("s3cret-pw", h) is True
    assert verify_password("wrong", h) is False
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_passwords.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'services.passwords'`

- [ ] **Step 3: Implement `passwords.py`**

Create `backend/services/passwords.py`:

```python
import bcrypt


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(raw.encode(), bcrypt.gensalt()).decode()


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(raw.encode(), hashed.encode())
    except (ValueError, TypeError):
        return False
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_passwords.py -v`
Expected: PASS

- [ ] **Step 5: Write the failing session test**

Create `backend/tests/test_sessions.py`:

```python
from datetime import timedelta

from models.entities import User, Session as UserSession, utcnow
from services.sessions import create_session, resolve_session, delete_session


def _user(db):
    u = User(email="s@x.com", display_name="S", auth_source="local")
    db.add(u)
    db.commit()
    return u


def test_create_and_resolve_session(db_session):
    u = _user(db_session)
    raw = create_session(db_session, u.id)
    assert isinstance(raw, str) and len(raw) > 20
    assert resolve_session(db_session, raw).id == u.id
    assert resolve_session(db_session, "nope") is None
    assert resolve_session(db_session, None) is None


def test_expired_session_rejected(db_session):
    u = _user(db_session)
    raw = create_session(db_session, u.id)
    row = db_session.query(UserSession).one()
    row.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()
    assert resolve_session(db_session, raw) is None


def test_delete_session(db_session):
    u = _user(db_session)
    raw = create_session(db_session, u.id)
    delete_session(db_session, raw)
    assert resolve_session(db_session, raw) is None
```

- [ ] **Step 6: Run it, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_sessions.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'services.sessions'`

- [ ] **Step 7: Implement `sessions.py`**

Create `backend/services/sessions.py`:

```python
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session as DbSession

from config import SESSION_TTL_DAYS
from models.entities import Session as UserSession, User, utcnow
from services.auth import hash_key


def create_session(db: DbSession, user_id: str) -> str:
    raw = "pss-" + secrets.token_urlsafe(32)
    row = UserSession(
        token_hash=hash_key(raw),
        user_id=user_id,
        expires_at=utcnow() + timedelta(days=SESSION_TTL_DAYS),
    )
    db.add(row)
    db.commit()
    return raw


def resolve_session(db: DbSession, raw: str | None) -> User | None:
    if not raw:
        return None
    row = db.query(UserSession).filter(
        UserSession.token_hash == hash_key(raw)).first()
    if row is None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        return None
    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        return None
    return user


def delete_session(db: DbSession, raw: str) -> None:
    row = db.query(UserSession).filter(
        UserSession.token_hash == hash_key(raw)).first()
    if row is not None:
        db.delete(row)
        db.commit()
```

> Note the `tzinfo` guard: SQLite returns naive datetimes even for `DateTime(timezone=True)` columns, so we coerce to UTC before comparison. This mirrors how the rest of the codebase treats stored timestamps.

- [ ] **Step 8: Run it, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_sessions.py -v`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd backend && git add services/passwords.py services/sessions.py tests/test_passwords.py tests/test_sessions.py
git commit -m "feat(auth): add password hashing and opaque session token services"
```

---

### Task 3: AuthProvider seam + LocalPasswordProvider

**Files:**
- Create: `backend/services/auth_providers.py`
- Test: `backend/tests/test_auth_providers.py`

**Interfaces:**
- Consumes: `passwords.verify_password`, `models.entities.User`.
- Produces:
  - `UserIdentity` dataclass: `email: str`, `display_name: str`, `auth_source: str`, `external_id: str | None`
  - `AuthProvider` `Protocol` with `authenticate(db, credentials: dict) -> UserIdentity | None`
  - `LocalPasswordProvider` (implements it; expects `credentials = {"email", "password"}`)
  - `get_or_create_user(db, identity: UserIdentity) -> User` — looks up existing; JIT-creates ONLY when `identity.auth_source != "local"` (local users are created by registration, never on login)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_auth_providers.py`:

```python
from models.entities import User
from services.passwords import hash_password
from services.auth_providers import (
    UserIdentity, LocalPasswordProvider, get_or_create_user)


def test_local_provider_authenticates_valid_credentials(db_session):
    db_session.add(User(email="a@x.com", display_name="A", auth_source="local",
                        password_hash=hash_password("pw123456")))
    db_session.commit()
    ident = LocalPasswordProvider().authenticate(
        db_session, {"email": "a@x.com", "password": "pw123456"})
    assert ident is not None and ident.email == "a@x.com"
    assert ident.auth_source == "local"


def test_local_provider_rejects_bad_password(db_session):
    db_session.add(User(email="a@x.com", display_name="A", auth_source="local",
                        password_hash=hash_password("pw123456")))
    db_session.commit()
    assert LocalPasswordProvider().authenticate(
        db_session, {"email": "a@x.com", "password": "wrong"}) is None
    assert LocalPasswordProvider().authenticate(
        db_session, {"email": "ghost@x.com", "password": "pw123456"}) is None


def test_get_or_create_local_never_creates(db_session):
    ident = UserIdentity(email="new@x.com", display_name="N",
                         auth_source="local", external_id=None)
    assert get_or_create_user(db_session, ident) is None


def test_get_or_create_sso_jit_provisions(db_session):
    ident = UserIdentity(email="sso@x.com", display_name="SSO",
                         auth_source="oidc", external_id="sub-123")
    u1 = get_or_create_user(db_session, ident)
    assert u1 is not None and u1.password_hash is None
    u2 = get_or_create_user(db_session, ident)
    assert u2.id == u1.id  # idempotent on (auth_source, external_id)
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_auth_providers.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'services.auth_providers'`

- [ ] **Step 3: Implement `auth_providers.py`**

Create `backend/services/auth_providers.py`:

```python
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.orm import Session

from models.entities import User
from services.passwords import verify_password


@dataclass
class UserIdentity:
    email: str
    display_name: str
    auth_source: str
    external_id: str | None


class AuthProvider(Protocol):
    def authenticate(self, db: Session, credentials: dict) -> UserIdentity | None:
        ...


class LocalPasswordProvider:
    """Verifies email+password against local users. Future SSO providers
    (OIDCProvider, LDAPProvider) implement the same authenticate() signature
    and return a UserIdentity; get_or_create_user() JIT-provisions them."""

    def authenticate(self, db: Session, credentials: dict) -> UserIdentity | None:
        email = (credentials.get("email") or "").strip().lower()
        password = credentials.get("password") or ""
        user = db.query(User).filter(
            User.email == email, User.auth_source == "local").first()
        if user is None or not user.password_hash or not user.is_active:
            return None
        if not verify_password(password, user.password_hash):
            return None
        return UserIdentity(email=user.email, display_name=user.display_name,
                            auth_source="local", external_id=None)


def get_or_create_user(db: Session, identity: UserIdentity) -> User | None:
    """Resolve a UserIdentity to a persisted User.

    - local: look up by (email, auth_source); NEVER create here (registration
      owns local user creation). Returns None if not found.
    - sso (oidc/ldap): look up by (auth_source, external_id); JIT-create if
      absent. Returns the User.
    """
    if identity.auth_source == "local":
        return db.query(User).filter(
            User.email == identity.email,
            User.auth_source == "local").first()

    user = db.query(User).filter(
        User.auth_source == identity.auth_source,
        User.external_id == identity.external_id).first()
    if user is None:
        user = User(email=identity.email, display_name=identity.display_name,
                    auth_source=identity.auth_source,
                    external_id=identity.external_id, password_hash=None)
        db.add(user)
        db.commit()
    return user
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_auth_providers.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd backend && git add services/auth_providers.py tests/test_auth_providers.py
git commit -m "feat(auth): add pluggable AuthProvider seam and LocalPasswordProvider"
```

---

### Task 4: `get_current_user` dependency + membership assertions

**Files:**
- Create: `backend/services/authz.py`
- Test: `backend/tests/test_authz.py`

**Interfaces:**
- Consumes: `sessions.resolve_session`, `models.entities.User/Project/ProjectMember/Trace`, `config.SESSION_COOKIE_NAME`, `db.get_db`.
- Produces (used by every gated router in Phase B):
  - `get_current_user(session_cookie, db) -> User` — FastAPI dependency; 401 if no valid session
  - `member_project_ids(db, user) -> list[str]`
  - `assert_member(db, user, project_id) -> ProjectMember` — 404 if project missing, 403 if not a member
  - `assert_owner(db, user, project_id) -> ProjectMember` — 403 unless role == "owner"
  - `assert_trace_access(db, user, trace_id) -> Trace` — 404 if trace missing, 403 if caller not a member of the trace's project

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_authz.py`:

```python
import pytest
from fastapi import HTTPException

from models.entities import User, Project, ProjectMember, Trace
from services.authz import (
    member_project_ids, assert_member, assert_owner, assert_trace_access)


def _seed(db):
    owner = User(email="o@x.com", display_name="O", auth_source="local")
    other = User(email="e@x.com", display_name="E", auth_source="local")
    db.add_all([owner, other])
    db.flush()
    p = Project(name="grp", owner_id=owner.id)
    db.add(p)
    db.flush()
    db.add(ProjectMember(project_id=p.id, user_id=owner.id, role="owner"))
    db.commit()
    return owner, other, p


def test_member_project_ids(db_session):
    owner, other, p = _seed(db_session)
    assert member_project_ids(db_session, owner) == [p.id]
    assert member_project_ids(db_session, other) == []


def test_assert_member_and_owner(db_session):
    owner, other, p = _seed(db_session)
    assert assert_member(db_session, owner, p.id).role == "owner"
    with pytest.raises(HTTPException) as e1:
        assert_member(db_session, other, p.id)
    assert e1.value.status_code == 403
    with pytest.raises(HTTPException) as e2:
        assert_member(db_session, owner, "missing")
    assert e2.value.status_code == 404
    assert assert_owner(db_session, owner, p.id).role == "owner"


def test_assert_trace_access(db_session):
    owner, other, p = _seed(db_session)
    db_session.add(Trace(id="t1", project_id=p.id, name="t"))
    db_session.commit()
    assert assert_trace_access(db_session, owner, "t1").id == "t1"
    with pytest.raises(HTTPException) as e1:
        assert_trace_access(db_session, other, "t1")
    assert e1.value.status_code == 403
    with pytest.raises(HTTPException) as e2:
        assert_trace_access(db_session, owner, "missing")
    assert e2.value.status_code == 404
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_authz.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'services.authz'`

- [ ] **Step 3: Implement `authz.py`**

Create `backend/services/authz.py`:

```python
from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from config import SESSION_COOKIE_NAME
from db import get_db
from models.entities import Project, ProjectMember, Trace, User
from services.sessions import resolve_session


def get_current_user(
    ps_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> User:
    user = resolve_session(db, ps_session)
    if user is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return user


def member_project_ids(db: Session, user: User) -> list[str]:
    rows = db.query(ProjectMember.project_id).filter(
        ProjectMember.user_id == user.id).all()
    return [r[0] for r in rows]


def assert_member(db: Session, user: User, project_id: str) -> ProjectMember:
    if db.get(Project, project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    m = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user.id).first()
    if m is None:
        raise HTTPException(status_code=403, detail="not a workspace member")
    return m


def assert_owner(db: Session, user: User, project_id: str) -> ProjectMember:
    m = assert_member(db, user, project_id)
    if m.role != "owner":
        raise HTTPException(status_code=403, detail="owner role required")
    return m


def assert_trace_access(db: Session, user: User, trace_id: str) -> Trace:
    t = db.get(Trace, trace_id)
    if t is None:
        raise HTTPException(status_code=404, detail="trace not found")
    assert_member(db, user, t.project_id)
    return t
```

> `SESSION_COOKIE_NAME` is `"ps_session"`; the `alias` makes FastAPI read the `ps_session` cookie into the `ps_session` param.

- [ ] **Step 4: Run it, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_authz.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd backend && git add services/authz.py tests/test_authz.py
git commit -m "feat(auth): add session dependency and workspace membership assertions"
```

---

### Task 5: Auth router (register / login / logout / me)

**Files:**
- Create: `backend/schemas/auth.py`
- Create: `backend/routers/auth.py`
- Modify: `backend/main.py`
- Modify: `backend/tests/conftest.py` (add `user_client` fixture)
- Test: `backend/tests/test_auth_api.py`

**Interfaces:**
- Consumes: `passwords.hash_password`, `auth_providers.LocalPasswordProvider`, `sessions.create_session/delete_session`, `authz.get_current_user`, `config.{AUTH_ALLOW_REGISTRATION, SECURE_COOKIES, SESSION_TTL_DAYS, SESSION_COOKIE_NAME}`.
- Produces endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/config`. Response model `UserOut{ id, email, display_name, auth_source }`. `user_client` conftest fixture (a `TestClient` with a registered+logged-in user whose cookie is set).

- [ ] **Step 1: Write schemas**

Create `backend/schemas/auth.py`:

```python
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=255)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    display_name: str
    auth_source: str


class AuthConfigOut(BaseModel):
    allow_registration: bool
```

> `EmailStr` requires `email-validator`. Add `email-validator>=2.0.0` to `backend/requirements.txt` and `pip install` it in this task.

- [ ] **Step 2: Write the failing API test**

Create `backend/tests/test_auth_api.py`:

```python
import pytest
from fastapi.testclient import TestClient

from db import get_db


@pytest.fixture()
def client(db_session):
    from main import app
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_register_sets_cookie_and_me_works(client):
    r = client.post("/api/auth/register", json={
        "email": "a@x.com", "password": "pw123456", "display_name": "A"})
    assert r.status_code == 200
    assert r.json()["email"] == "a@x.com"
    assert client.cookies.get("ps_session")

    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["email"] == "a@x.com"


def test_duplicate_email_409(client):
    body = {"email": "a@x.com", "password": "pw123456", "display_name": "A"}
    assert client.post("/api/auth/register", json=body).status_code == 200
    assert client.post("/api/auth/register", json=body).status_code == 409


def test_login_wrong_password_401(client):
    client.post("/api/auth/register", json={
        "email": "a@x.com", "password": "pw123456", "display_name": "A"})
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={
        "email": "a@x.com", "password": "nope"}).status_code == 401
    ok = client.post("/api/auth/login", json={
        "email": "a@x.com", "password": "pw123456"})
    assert ok.status_code == 200


def test_me_without_session_401(client):
    assert client.get("/api/auth/me").status_code == 401


def test_logout_clears_session(client):
    client.post("/api/auth/register", json={
        "email": "a@x.com", "password": "pw123456", "display_name": "A"})
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_auth_api.py -v`
Expected: FAIL (404 on `/api/auth/register` — router not mounted yet)

- [ ] **Step 4: Implement the auth router**

Create `backend/routers/auth.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from config import (AUTH_ALLOW_REGISTRATION, SECURE_COOKIES,
                    SESSION_COOKIE_NAME, SESSION_TTL_DAYS)
from db import get_db
from models.entities import User
from schemas.auth import AuthConfigOut, LoginIn, RegisterIn, UserOut
from services.auth_providers import LocalPasswordProvider
from services.authz import get_current_user
from services.passwords import hash_password
from services.sessions import create_session, delete_session

router = APIRouter(prefix="/auth", tags=["auth"])

_MAX_AGE = SESSION_TTL_DAYS * 24 * 3600


def _set_cookie(resp: Response, raw: str) -> None:
    resp.set_cookie(
        SESSION_COOKIE_NAME, raw, max_age=_MAX_AGE, httponly=True,
        samesite="lax", secure=SECURE_COOKIES, path="/")


@router.get("/config", response_model=AuthConfigOut)
def auth_config():
    return AuthConfigOut(allow_registration=AUTH_ALLOW_REGISTRATION)


@router.post("/register", response_model=UserOut)
def register(payload: RegisterIn, response: Response,
             db: Session = Depends(get_db)):
    if not AUTH_ALLOW_REGISTRATION:
        raise HTTPException(status_code=403, detail="registration disabled")
    email = payload.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="email already registered")
    user = User(email=email, display_name=payload.display_name or email,
                auth_source="local", password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    _set_cookie(response, create_session(db, user.id))
    return user


@router.post("/login", response_model=UserOut)
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)):
    identity = LocalPasswordProvider().authenticate(
        db, {"email": payload.email, "password": payload.password})
    if identity is None:
        raise HTTPException(status_code=401, detail="invalid email or password")
    user = db.query(User).filter(
        User.email == identity.email, User.auth_source == "local").first()
    _set_cookie(response, create_session(db, user.id))
    return user


@router.post("/logout")
def logout(response: Response,
           ps_session: str | None = __import__("fastapi").Cookie(
               default=None, alias=SESSION_COOKIE_NAME),
           db: Session = Depends(get_db)):
    if ps_session:
        delete_session(db, ps_session)
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"logged_out": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
```

> Replace the inline `__import__("fastapi").Cookie(...)` with a proper `from fastapi import Cookie` at the top of the file and use `Cookie(default=None, alias=SESSION_COOKIE_NAME)` — the inline form is shown only to make the dependency explicit; write it cleanly:
> ```python
> from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
> ...
> @router.post("/logout")
> def logout(response: Response,
>            ps_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
>            db: Session = Depends(get_db)):
> ```

- [ ] **Step 5: Mount the router in `main.py`**

In `backend/main.py`, add the import alongside the others (after line 15):

```python
from routers import auth as auth_router
```

And mount it (after line 44):

```python
app.include_router(auth_router.router, prefix="/api")
```

- [ ] **Step 6: Run it, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_auth_api.py -v`
Expected: PASS (all 5)

- [ ] **Step 7: Add the `user_client` fixture to conftest**

Append to `backend/tests/conftest.py`:

```python
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
```

- [ ] **Step 8: Commit**

```bash
cd backend && git add routers/auth.py schemas/auth.py main.py requirements.txt tests/test_auth_api.py tests/conftest.py
git commit -m "feat(auth): add register/login/logout/me endpoints and cookie sessions"
```

---

# PHASE B — Wire authorization into existing routers

> **Reviewer note for Phase B:** Adding auth to a router breaks that router's existing tests (they call endpoints anonymously). Each task below updates its router's tests in the same commit. Run the FULL suite at the end of each task, not just the new tests.

### Task 6: Projects router — ownership on create, membership on key ops

**Files:**
- Modify: `backend/routers/projects.py`
- Modify: `backend/tests/test_projects_api.py`

**Interfaces:**
- Consumes: `authz.get_current_user`, `authz.assert_owner`, `models.entities.ProjectMember`.
- Produces: `create_project` now records `owner_id` + an owner `ProjectMember`; key list/create/revoke require the caller be an owner of the project (revoke resolves the key's project first).

- [ ] **Step 1: Update tests to expect auth (write the new expectations first)**

Replace `backend/tests/test_projects_api.py` `client`/`project` fixtures and tests so they authenticate. The `client` fixture becomes the `user_client` fixture from conftest, and `project` is created *through the API* so the caller is its owner:

```python
import pytest


@pytest.fixture()
def client(user_client):
    return user_client


@pytest.fixture()
def project(client):
    return client.post("/api/projects", json={"name": "demo"}).json()


def test_create_project_and_duplicate_409(client):
    resp = client.post("/api/projects", json={"name": "acme"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "acme"
    assert "id" in body and "created_at" in body
    assert client.post("/api/projects", json={"name": "acme"}).status_code == 409


def test_anonymous_cannot_create_project(db_session):
    from fastapi.testclient import TestClient
    from db import get_db
    from main import app
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        assert c.post("/api/projects", json={"name": "x"}).status_code == 401
    app.dependency_overrides.clear()


def test_create_key_returns_plaintext_once_and_list_hides_it(client, project):
    pid = project["id"]
    resp = client.post(f"/api/projects/{pid}/keys")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"id", "prefix", "key"}
    plaintext_key = body["key"]
    assert plaintext_key.startswith("ps-")
    assert body["prefix"] == plaintext_key[:7]

    resp2 = client.post(f"/api/projects/{pid}/keys")
    plaintext_key2 = resp2.json()["key"]

    list_resp = client.get(f"/api/projects/{pid}/keys")
    assert list_resp.status_code == 200
    assert plaintext_key not in list_resp.text
    assert plaintext_key2 not in list_resp.text
    keys = list_resp.json()
    assert [k["id"] for k in keys] == [resp2.json()["id"], body["id"]]


def test_revoke_key_is_idempotent(client, project):
    pid = project["id"]
    key_id = client.post(f"/api/projects/{pid}/keys").json()["id"]
    assert client.delete(f"/api/keys/{key_id}").json() == {"revoked": True}
    revoked_at_1 = client.get(f"/api/projects/{pid}/keys").json()[0]["revoked_at"]
    assert revoked_at_1 is not None
    assert client.delete(f"/api/keys/{key_id}").json() == {"revoked": True}
    revoked_at_2 = client.get(f"/api/projects/{pid}/keys").json()[0]["revoked_at"]
    assert revoked_at_2 == revoked_at_1


def test_non_owner_cannot_touch_keys(client, project):
    # second user is not a member → 403 (404 if project resolution hides it)
    client.post("/api/auth/logout")
    client.post("/api/auth/register", json={
        "email": "intruder@x.com", "password": "pw123456", "display_name": "I"})
    assert client.post(f"/api/projects/{project['id']}/keys").status_code == 403
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_projects_api.py -v`
Expected: FAIL (create_project returns 200 anonymously today; owner scoping not enforced)

- [ ] **Step 3: Rewrite `routers/projects.py`**

Replace `backend/routers/projects.py` with:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ApiKey, Project, ProjectMember, User, utcnow
from schemas.projects import KeyCreated, KeyOut, ProjectCreate, ProjectOut2
from services.auth import generate_api_key
from services.authz import assert_owner, get_current_user

router = APIRouter(tags=["projects"])


@router.post("/projects", response_model=ProjectOut2)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    if db.query(Project).filter(Project.name == payload.name).first():
        raise HTTPException(status_code=409, detail="project name already exists")
    p = Project(name=payload.name, owner_id=user.id)
    db.add(p)
    db.flush()
    db.add(ProjectMember(project_id=p.id, user_id=user.id, role="owner"))
    db.commit()
    return ProjectOut2.model_validate(p)


@router.get("/projects/{project_id}/keys", response_model=list[KeyOut])
def list_keys(project_id: str, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    assert_owner(db, user, project_id)
    keys = (db.query(ApiKey).filter(ApiKey.project_id == project_id)
            .order_by(ApiKey.created_at.desc()).all())
    return [KeyOut.model_validate(k) for k in keys]


@router.post("/projects/{project_id}/keys", response_model=KeyCreated)
def create_key(project_id: str, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    assert_owner(db, user, project_id)
    raw, key_hash, prefix = generate_api_key()
    k = ApiKey(project_id=project_id, key_hash=key_hash, prefix=prefix)
    db.add(k)
    db.commit()
    return KeyCreated(id=k.id, prefix=k.prefix, key=raw)


@router.delete("/keys/{key_id}")
def revoke_key(key_id: str, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    k = db.get(ApiKey, key_id)
    if k is None:
        raise HTTPException(status_code=404, detail="key not found")
    assert_owner(db, user, k.project_id)
    if k.revoked_at is None:
        k.revoked_at = utcnow()
        db.commit()
    return {"revoked": True}
```

> Note: `create_project` and `list_projects` collide on `POST /api/projects` vs `GET /api/projects` (different methods, fine). `list_projects` lives in `query.py` and is handled in Task 7.

- [ ] **Step 4: Run it, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_projects_api.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd backend && git add routers/projects.py tests/test_projects_api.py
git commit -m "feat(auth): scope project creation to owner and key ops to workspace owners"
```

---

### Task 7: Query router — session gate + membership scoping

**Files:**
- Modify: `backend/routers/query.py`
- Modify: `backend/tests/test_query.py`, `backend/tests/test_e2e_ingest_query.py`

**Interfaces:**
- Consumes: `authz.{get_current_user, member_project_ids, assert_member, assert_trace_access}`.
- Produces: `GET /api/projects` returns only the caller's member projects; `GET /api/traces` requires membership of the requested `project_id` (or, when omitted, restricts to member projects); `GET /api/traces/{id}` enforces `assert_trace_access`.

- [ ] **Step 1: Update `test_query.py` to authenticate + add cross-tenant isolation test**

Read `backend/tests/test_query.py` first to see its current fixtures, then update every request to go through `user_client`, and add membership rows for the seeded project. Add this isolation test:

```python
def test_traces_hidden_from_non_member(user_client, db_session):
    from models.entities import Project, Trace, ProjectMember
    # a project the logged-in user is NOT a member of
    other = Project(name="other-grp")
    db_session.add(other)
    db_session.flush()
    db_session.add(Trace(id="secret", project_id=other.id, name="secret"))
    db_session.commit()
    assert user_client.get("/api/traces/secret").status_code == 403
    r = user_client.get(f"/api/traces?project_id={other.id}")
    assert r.status_code == 403
```

For the existing "happy path" tests, seed the project *and* a `ProjectMember(project_id, user_id=user_client.user_id, role="owner")` row so the logged-in user can see it.

- [ ] **Step 2: Run it, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_query.py -v`
Expected: FAIL (endpoints return data anonymously today)

- [ ] **Step 3: Rewrite `routers/query.py`**

Replace `backend/routers/query.py` with (the `build_tree` helper is unchanged):

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from db import get_db
from models.entities import Observation, Project, Trace, User
from schemas.query import (ObservationNode, ProjectOut, TraceDetail,
                           TraceListOut, TraceSummary)
from services.authz import (assert_member, assert_trace_access,
                            get_current_user, member_project_ids)

router = APIRouter(tags=["query"])


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    ids = member_project_ids(db, user)
    if not ids:
        return []
    return (db.query(Project).filter(Project.id.in_(ids))
            .order_by(Project.created_at).all())


@router.get("/traces", response_model=TraceListOut)
def list_traces(
    project_id: str | None = None,
    origin: str | None = None,
    search: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if project_id:
        assert_member(db, user, project_id)
        allowed = [project_id]
    else:
        allowed = member_project_ids(db, user)
    q = db.query(Trace).filter(Trace.project_id.in_(allowed)) if allowed \
        else db.query(Trace).filter(False)
    if origin:
        q = q.filter(Trace.origin == origin)
    if search:
        q = q.filter(Trace.name.ilike(f"%{search}%"))
    total = q.count()
    rows = (q.options(selectinload(Trace.observations))
            .order_by(Trace.created_at.desc()).offset(offset).limit(limit).all())
    items = []
    for t in rows:
        obs = t.observations
        models = sorted({o.model for o in obs if o.type == "llm" and o.model})
        items.append(TraceSummary(
            id=t.id, name=t.name, origin=t.origin, status=t.status,
            model_summary=", ".join(models), observation_count=len(obs),
            total_input_tokens=t.total_input_tokens,
            total_output_tokens=t.total_output_tokens,
            total_cost=t.total_cost, latency_ms=t.latency_ms,
            started_at=t.started_at, created_at=t.created_at,
        ))
    return TraceListOut(items=items, total=total)


def build_tree(observations: list[Observation]) -> list[ObservationNode]:
    nodes = {o.id: ObservationNode.model_validate(o) for o in observations}
    roots: list[ObservationNode] = []
    for o in sorted(observations, key=lambda x: x.seq):
        node = nodes[o.id]
        if o.parent_id and o.parent_id in nodes:
            nodes[o.parent_id].children.append(node)
        else:
            roots.append(node)
    return roots


@router.get("/traces/{trace_id}", response_model=TraceDetail)
def get_trace(trace_id: str, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    t = assert_trace_access(db, user, trace_id)
    return TraceDetail.model_validate({
        **{c: getattr(t, c) for c in (
            "id", "project_id", "name", "origin", "status", "input", "output",
            "started_at", "ended_at", "latency_ms", "total_input_tokens",
            "total_output_tokens", "total_cost", "created_at")},
        "metadata": t.meta,
        "observations": build_tree(list(t.observations)),
    })
```

- [ ] **Step 4: Fix `test_e2e_ingest_query.py`**

This test ingests via API key then queries. Ingestion is unchanged, but the query half now needs a session + membership. Read it, then: after ingesting, register a user through the client, create a `ProjectMember` linking that user to the ingested trace's project, and assert the query succeeds. (Ingestion creates the project via API key; the test must add the membership row directly against `db_session`.)

- [ ] **Step 5: Run the full suite**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/ -v`
Expected: `test_query.py`, `test_e2e_ingest_query.py`, `test_projects_api.py`, `test_auth_api.py` PASS. Other routers (`test_config_api`, `test_replay_api`, `test_batch`, `test_prompts_api`, `test_judge`) may still FAIL — they are gated in Task 8.

- [ ] **Step 6: Commit**

```bash
cd backend && git add routers/query.py tests/test_query.py tests/test_e2e_ingest_query.py
git commit -m "feat(auth): scope trace/project queries to workspace membership"
```

---

### Task 8: Config / replay / evaluations / prompts routers + members endpoints

**Files:**
- Modify: `backend/routers/config.py`, `backend/routers/replay.py`, `backend/routers/evaluations.py`, `backend/routers/prompts.py`
- Create: `backend/routers/members.py`, `backend/schemas/members.py`
- Modify: `backend/main.py` (mount members router)
- Modify: `backend/tests/test_config_api.py`, `test_replay_api.py`, `test_batch.py`, `test_prompts_api.py`
- Test: `backend/tests/test_members_api.py`

**Interfaces:**
- Consumes: `authz.{get_current_user, assert_member, assert_owner}`.
- Produces:
  - Every resource-scoped endpoint requires a session. Endpoints that carry a `project_id` (prompts list/create, replay create, evaluation create/list, trace-scoped ops) additionally `assert_member` on that project (and resolve `trace_id`/`prompt_id` → project first where the id is in the path).
  - `config.py` provider/pricing endpoints: gated by `get_current_user` only (they remain global — see Follow-up). `GET /api/judge-models` likewise login-gated.
  - Members endpoints: `GET /api/projects/{id}/members` (member), `POST /api/projects/{id}/members {email}` (owner; 404 if that email isn't a registered user, 409 if already a member), `DELETE /api/projects/{id}/members/{user_id}` (owner; 400 if removing the last owner).

- [ ] **Step 1: Write members schemas**

Create `backend/schemas/members.py`:

```python
from datetime import datetime

from pydantic import BaseModel, EmailStr


class MemberOut(BaseModel):
    user_id: str
    email: str
    display_name: str
    role: str
    created_at: datetime


class MemberAddIn(BaseModel):
    email: EmailStr
```

- [ ] **Step 2: Write the failing members test**

Create `backend/tests/test_members_api.py`:

```python
import pytest


@pytest.fixture()
def client(user_client):
    return user_client


@pytest.fixture()
def project(client):
    return client.post("/api/projects", json={"name": "grp"}).json()


def _register_second(client):
    client.post("/api/auth/register", json={
        "email": "member2@x.com", "password": "pw123456", "display_name": "M2"})
    # registering logs the second user in; log back in as owner afterward
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={
        "email": "owner@x.com", "password": "pw123456"})


def test_owner_lists_self_as_member(client, project):
    r = client.get(f"/api/projects/{project['id']}/members")
    assert r.status_code == 200
    members = r.json()
    assert len(members) == 1 and members[0]["role"] == "owner"
    assert members[0]["email"] == "owner@x.com"


def test_add_existing_user_as_member(client, project):
    _register_second(client)
    r = client.post(f"/api/projects/{project['id']}/members",
                    json={"email": "member2@x.com"})
    assert r.status_code == 200
    roles = {m["email"]: m["role"]
             for m in client.get(f"/api/projects/{project['id']}/members").json()}
    assert roles == {"owner@x.com": "owner", "member2@x.com": "member"}


def test_add_unregistered_email_404(client, project):
    assert client.post(f"/api/projects/{project['id']}/members",
                       json={"email": "ghost@x.com"}).status_code == 404


def test_add_duplicate_member_409(client, project):
    _register_second(client)
    client.post(f"/api/projects/{project['id']}/members",
                json={"email": "member2@x.com"})
    assert client.post(f"/api/projects/{project['id']}/members",
                       json={"email": "member2@x.com"}).status_code == 409


def test_cannot_remove_last_owner(client, project):
    owner_id = client.get("/api/auth/me").json()["id"]
    r = client.delete(f"/api/projects/{project['id']}/members/{owner_id}")
    assert r.status_code == 400
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_members_api.py -v`
Expected: FAIL (404 — members router not mounted)

- [ ] **Step 4: Implement members router**

Create `backend/routers/members.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ProjectMember, User
from schemas.members import MemberAddIn, MemberOut
from services.authz import assert_member, assert_owner, get_current_user

router = APIRouter(tags=["members"])


@router.get("/projects/{project_id}/members", response_model=list[MemberOut])
def list_members(project_id: str, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    assert_member(db, user, project_id)
    rows = (db.query(ProjectMember, User)
            .join(User, ProjectMember.user_id == User.id)
            .filter(ProjectMember.project_id == project_id)
            .order_by(ProjectMember.created_at).all())
    return [MemberOut(user_id=u.id, email=u.email, display_name=u.display_name,
                      role=m.role, created_at=m.created_at) for m, u in rows]


@router.post("/projects/{project_id}/members", response_model=list[MemberOut])
def add_member(project_id: str, payload: MemberAddIn,
               db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    assert_owner(db, user, project_id)
    target = db.query(User).filter(
        User.email == payload.email.strip().lower()).first()
    if target is None:
        raise HTTPException(status_code=404, detail="no registered user with that email")
    exists = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == target.id).first()
    if exists:
        raise HTTPException(status_code=409, detail="already a member")
    db.add(ProjectMember(project_id=project_id, user_id=target.id, role="member"))
    db.commit()
    return list_members(project_id, db, user)


@router.delete("/projects/{project_id}/members/{user_id}")
def remove_member(project_id: str, user_id: str, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    assert_owner(db, user, project_id)
    m = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user_id).first()
    if m is None:
        raise HTTPException(status_code=404, detail="member not found")
    if m.role == "owner":
        owner_count = db.query(ProjectMember).filter(
            ProjectMember.project_id == project_id,
            ProjectMember.role == "owner").count()
        if owner_count <= 1:
            raise HTTPException(status_code=400, detail="cannot remove the last owner")
    db.delete(m)
    db.commit()
    return {"removed": True}
```

Mount it in `backend/main.py`:

```python
from routers import members as members_router
...
app.include_router(members_router.router, prefix="/api")
```

- [ ] **Step 5: Run the members test, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_members_api.py -v`
Expected: PASS

- [ ] **Step 6: Gate config router**

In `backend/routers/config.py`, import the dependency and add it to every endpoint. Add to imports:

```python
from fastapi import APIRouter, Depends, HTTPException
from services.authz import get_current_user
from models.entities import User
```

Add `user: User = Depends(get_current_user)` as a parameter to each of the 8 route functions (`list_providers`, `create_provider`, `update_provider`, `delete_provider`, `list_pricing`, `create_pricing`, `update_pricing`, `delete_pricing`, `list_judge_models`). Do not otherwise change their bodies — providers/pricing stay global (see Follow-up).

- [ ] **Step 7: Gate replay / evaluations / prompts routers**

For each of `routers/replay.py`, `routers/evaluations.py`, `routers/prompts.py`: read the file, add `get_current_user` to every endpoint, and add `assert_member` on the relevant project.

- **prompts.py**: list/create take `project_id` → `assert_member(db, user, project_id)`. `GET /api/prompts/{id}` and version ops → resolve the prompt, then `assert_member` on `prompt.project_id`. `GET /api/prompt-versions/{version_id}/traces` → resolve version→prompt→project, then `assert_member`.
- **replay.py**: `_run_one` and the GET endpoints resolve `source_trace` / run → `project_id`; add `assert_member(db, user, source.project_id)` right after the source-trace lookup in `_run_one`, and `assert_member` on the run's `project_id` in the GET endpoints.
- **evaluations.py**: create/batch resolve `subject_trace_id` → project; add `assert_member` on that project. `GET /api/evaluations` filters by member projects (resolve subject trace → assert_member).

- [ ] **Step 8: Update the four routers' tests to authenticate**

Update `test_config_api.py`, `test_replay_api.py`, `test_batch.py`, `test_prompts_api.py` to use `user_client` and seed a `ProjectMember` for any project the test operates on (mirror the pattern from Task 7 Step 1). For config tests (global resources) just switching to `user_client` suffices.

- [ ] **Step 9: Run the FULL suite**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/ -v`
Expected: PASS (entire suite green)

- [ ] **Step 10: Commit**

```bash
cd backend && git add routers/ schemas/members.py main.py tests/
git commit -m "feat(auth): gate config/replay/eval/prompt routers and add workspace member management"
```

---

### Task 9: Bootstrap CLI scripts (create user, backfill owners)

**Files:**
- Create: `backend/scripts/create_user.py`
- Create: `backend/scripts/backfill_owner.py`
- Test: `backend/tests/test_bootstrap_scripts.py`

**Interfaces:**
- Produces: `scripts/create_user.py <email> <password> [display_name]` creates a local user (idempotent on email); `scripts/backfill_owner.py <email>` assigns every ownerless project to that user as `owner` + adds an owner `ProjectMember`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_bootstrap_scripts.py`:

```python
from models.entities import User, Project, ProjectMember
from scripts.create_user import create_user
from scripts.backfill_owner import backfill_owner


def test_create_user_idempotent(db_session):
    u1 = create_user(db_session, "boot@x.com", "pw123456", "Boot")
    u2 = create_user(db_session, "boot@x.com", "pw123456", "Boot")
    assert u1.id == u2.id
    assert db_session.query(User).count() == 1


def test_backfill_owner_assigns_ownerless_projects(db_session):
    db_session.add_all([Project(name="legacy-a"), Project(name="legacy-b")])
    db_session.commit()
    u = create_user(db_session, "boot@x.com", "pw123456", "Boot")
    n = backfill_owner(db_session, "boot@x.com")
    assert n == 2
    assert db_session.query(Project).filter(
        Project.owner_id == u.id).count() == 2
    assert db_session.query(ProjectMember).filter(
        ProjectMember.role == "owner").count() == 2
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_bootstrap_scripts.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement the scripts**

Create `backend/scripts/create_user.py`:

```python
"""创建本地登录用户。用法：python -m scripts.create_user <email> <password> [display_name]"""
import sys

from sqlalchemy.orm import Session

from db import Base, SessionLocal, engine
from models.entities import User
from services.passwords import hash_password


def create_user(db: Session, email: str, password: str,
                display_name: str = "") -> User:
    email = email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(email=email, display_name=display_name or email,
                    auth_source="local", password_hash=hash_password(password))
        db.add(user)
        db.commit()
    return user


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: python -m scripts.create_user <email> <password> [display_name]")
        sys.exit(1)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        u = create_user(db, sys.argv[1], sys.argv[2],
                        sys.argv[3] if len(sys.argv) > 3 else "")
        print(f"user: {u.email} ({u.id})")
    finally:
        db.close()


if __name__ == "__main__":
    main()
```

Create `backend/scripts/backfill_owner.py`:

```python
"""把所有无 owner 的历史项目归给指定用户。用法：python -m scripts.backfill_owner <email>"""
import sys

from sqlalchemy.orm import Session

from db import Base, SessionLocal, engine
from models.entities import Project, ProjectMember, User


def backfill_owner(db: Session, email: str) -> int:
    user = db.query(User).filter(User.email == email.strip().lower()).first()
    if user is None:
        raise SystemExit(f"no user with email {email}; create it first")
    projects = db.query(Project).filter(Project.owner_id.is_(None)).all()
    for p in projects:
        p.owner_id = user.id
        already = db.query(ProjectMember).filter(
            ProjectMember.project_id == p.id,
            ProjectMember.user_id == user.id).first()
        if already is None:
            db.add(ProjectMember(project_id=p.id, user_id=user.id, role="owner"))
    db.commit()
    return len(projects)


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python -m scripts.backfill_owner <email>")
        sys.exit(1)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        n = backfill_owner(db, sys.argv[1])
        print(f"assigned {n} ownerless project(s) to {sys.argv[1]}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
```

Ensure `backend/scripts/__init__.py` exists (it does — `create_project.py` is already a module there).

- [ ] **Step 4: Run it, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_bootstrap_scripts.py -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite once more**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/ -v`
Expected: PASS (whole suite)

- [ ] **Step 6: Commit**

```bash
cd backend && git add scripts/create_user.py scripts/backfill_owner.py tests/test_bootstrap_scripts.py
git commit -m "feat(auth): add create_user and backfill_owner bootstrap scripts"
```

---

# PHASE C — Frontend auth

### Task 10: API client — credentials + auth/members functions

**Files:**
- Modify: `frontend/lib/api.ts`

**Interfaces:**
- Produces (on the exported `api` object): `getMe()`, `login(body)`, `register(body)`, `logout()`, `getAuthConfig()`, `getMembers(projectId)`, `addMember(projectId, email)`, `removeMember(projectId, userId)`. Types: `CurrentUser`, `Member`, `AuthConfig`. Both fetch wrappers send `credentials: "include"`. `get`/`send` throw an `ApiError` carrying `status` so the UI can detect 401.

- [ ] **Step 1: Add `credentials: "include"` and a status-bearing error to the fetch wrappers**

In `frontend/lib/api.ts`, replace the `get` and `send` wrappers with:

```typescript
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function get<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!resp.ok) throw new ApiError(resp.status, `GET ${path} failed: ${resp.status}`);
  return resp.json();
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    let detail = `${resp.status}`;
    try {
      const data = await resp.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch { /* keep status */ }
    throw new ApiError(resp.status, detail);
  }
  return resp.json();
}
```

- [ ] **Step 2: Add auth/members types and functions**

Add these interfaces near the other exported interfaces in `frontend/lib/api.ts`:

```typescript
export interface CurrentUser {
  id: string;
  email: string;
  display_name: string;
  auth_source: string;
}

export interface AuthConfig {
  allow_registration: boolean;
}

export interface Member {
  user_id: string;
  email: string;
  display_name: string;
  role: "owner" | "member";
  created_at: string;
}
```

Add these entries to the exported `api` object:

```typescript
  // Auth
  getMe: () => get<CurrentUser>("/api/auth/me"),
  getAuthConfig: () => get<AuthConfig>("/api/auth/config"),
  login: (body: { email: string; password: string }) =>
    send<CurrentUser>("POST", "/api/auth/login", body),
  register: (body: { email: string; password: string; display_name: string }) =>
    send<CurrentUser>("POST", "/api/auth/register", body),
  logout: () => send<{ logged_out: boolean }>("POST", "/api/auth/logout"),

  // Members
  getMembers: (projectId: string) =>
    get<Member[]>(`/api/projects/${projectId}/members`),
  addMember: (projectId: string, email: string) =>
    send<Member[]>("POST", `/api/projects/${projectId}/members`, { email }),
  removeMember: (projectId: string, userId: string) =>
    send<{ removed: boolean }>("DELETE", `/api/projects/${projectId}/members/${userId}`),
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd frontend && git add lib/api.ts
git commit -m "feat(auth): send credentials and add auth/members API client functions"
```

---

### Task 11: AuthContext + login page + AuthGate + sidebar account section

**Files:**
- Create: `frontend/contexts/AuthContext.tsx`
- Create: `frontend/components/layout/AuthGate.tsx`
- Create: `frontend/app/login/page.tsx`
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/components/layout/AppSidebar.tsx`
- Test: `frontend/contexts/__tests__/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `api.{getMe, login, register, logout, getAuthConfig}`, `ApiError`.
- Produces: `useAuth()` → `{ user: CurrentUser | null, loading: boolean, login, register, logout, refresh }`; `<AuthProvider>`; `<AuthGate>` (redirects to `/login` when unauthenticated, renders nothing on `/login`); a login page at `/login`.

- [ ] **Step 1: Write the AuthContext**

Create `frontend/contexts/AuthContext.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError, type CurrentUser } from "@/lib/api";

interface AuthCtx {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.getMe());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      else setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    setUser(await api.login({ email, password }));
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      setUser(await api.register({ email, password, display_name: displayName }));
    }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
```

- [ ] **Step 2: Write the AuthGate**

Create `frontend/components/layout/AuthGate.tsx`:

```tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    if (!loading && !user && !isLoginPage) router.replace("/login");
  }, [loading, user, isLoginPage, router]);

  if (isLoginPage) return <>{children}</>;
  if (loading) return null;
  if (!user) return null;
  return <>{children}</>;
}
```

- [ ] **Step 3: Write the login page**

Create `frontend/app/login/page.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [allowRegister, setAllowRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAuthConfig().then((c) => setAllowRegister(c.allow_registration)).catch(() => {});
  }, []);
  useEffect(() => {
    if (user) router.replace("/traces");
  }, [user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, displayName);
      router.replace("/traces");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === "login" ? "登录 PromptScope" : "注册账号"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <Input type="email" placeholder="邮箱" value={email} required
                   onChange={(e) => setEmail(e.target.value)} />
            {mode === "register" && (
              <Input placeholder="显示名" value={displayName}
                     onChange={(e) => setDisplayName(e.target.value)} />
            )}
            <Input type="password" placeholder="密码（至少 8 位）" value={password} required
                   minLength={8} onChange={(e) => setPassword(e.target.value)} />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "处理中…" : mode === "login" ? "登录" : "注册"}
            </Button>
          </form>
          {allowRegister && (
            <button type="button" className="mt-3 text-sm text-muted-foreground underline"
                    onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
              {mode === "login" ? "没有账号？去注册" : "已有账号？去登录"}
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Wire providers into `layout.tsx`**

In `frontend/app/layout.tsx`, wrap the app so `AuthProvider` is outermost (inside `ThemeProvider`/`TooltipProvider`), and `AuthGate` guards the sidebar+main shell. The login page must render WITHOUT the sidebar, so `AuthGate` returns bare children on `/login`. Replace the body content with:

```tsx
<ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
  <TooltipProvider>
    <AuthProvider>
      <AuthGate>
        <ProjectProvider>
          <div className="flex h-screen bg-background">
            <AppSidebar />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </ProjectProvider>
      </AuthGate>
    </AuthProvider>
    <Toaster richColors />
  </TooltipProvider>
</ThemeProvider>
```

Add the imports:

```tsx
import { AuthProvider } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/layout/AuthGate";
```

> Because `AuthGate` renders bare `children` on `/login`, the login page never mounts `ProjectProvider`/`AppSidebar` (which call authenticated endpoints), avoiding a 401 loop.

- [ ] **Step 5: Replace the sidebar account placeholder**

In `frontend/components/layout/AppSidebar.tsx`, replace the placeholder block (the `<Tooltip>` with "账户" / "登录功能规划中", ~lines 202–217) with a real account row showing the user's email and a logout action. Add `import { useAuth } from "@/contexts/AuthContext";` and `import { LogOut } from "lucide-react";` at the top, call `const { user, logout } = useAuth();` in the component, and render:

```tsx
<div className={cn("flex h-8 items-center gap-2 rounded-md px-1", collapsed && "justify-center px-0")}>
  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
    <User className="h-3.5 w-3.5" />
  </span>
  {!collapsed && (
    <span className="flex-1 truncate text-xs text-muted-foreground" title={user?.email}>
      {user?.email ?? ""}
    </span>
  )}
  {!collapsed && (
    <button type="button" onClick={() => logout()} title="退出登录"
            className="text-muted-foreground hover:text-foreground">
      <LogOut className="h-3.5 w-3.5" />
    </button>
  )}
</div>
```

`User` is already imported in this file (used by the old placeholder).

- [ ] **Step 6: Write the AuthContext test**

Create `frontend/contexts/__tests__/AuthContext.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";

function Probe() {
  const { user, loading } = useAuth();
  return <div>{loading ? "loading" : user ? user.email : "anon"}</div>;
}

describe("AuthContext", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the user when getMe succeeds", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      id: "1", email: "a@x.com", display_name: "A", auth_source: "local" });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("a@x.com")).toBeInTheDocument());
  });

  it("shows anon on 401", async () => {
    vi.spyOn(api, "getMe").mockRejectedValue(new ApiError(401, "not authenticated"));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("anon")).toBeInTheDocument());
  });
});
```

- [ ] **Step 7: Run vitest + build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all tests PASS, build succeeds

- [ ] **Step 8: Commit**

```bash
cd frontend && git add contexts/AuthContext.tsx components/layout/AuthGate.tsx app/login/page.tsx app/layout.tsx components/layout/AppSidebar.tsx contexts/__tests__/AuthContext.test.tsx
git commit -m "feat(auth): add AuthContext, login page, route guard, and sidebar account section"
```

---

### Task 12: Members management tab in settings

**Files:**
- Modify: `frontend/app/settings/page.tsx`
- Test: `frontend/app/settings/__tests__/members.test.tsx`

**Interfaces:**
- Consumes: `useProject().currentProject`, `useAuth().user`, `api.{getMembers, addMember, removeMember}`.
- Produces: a fourth tab "成员" in the settings `Tabs` showing the current project's members; an add-by-email form and per-row remove button visible only when the current user's role in this project is `owner`.

- [ ] **Step 1: Add a `成员` tab trigger + content**

In `frontend/app/settings/page.tsx`, add a `TabsTrigger value="members">成员</TabsTrigger>` to the `TabsList`, and a matching `TabsContent value="members"` rendering a new `<MembersTab />` component (defined in the same file, following the existing `ProvidersTab`/`PricingTab` pattern).

- [ ] **Step 2: Implement `MembersTab`**

Add this component in `frontend/app/settings/page.tsx` (it uses the already-imported `useProject`, `Button`, `Input`, `Table` primitives; add `import { useAuth } from "@/contexts/AuthContext";` and `import { api, type Member } from "@/lib/api";` if not already imported):

```tsx
function MembersTab() {
  const { currentProject } = useProject();
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!currentProject) return;
    api.getMembers(currentProject.id).then(setMembers).catch(() => setMembers([]));
  }, [currentProject]);
  useEffect(() => { load(); }, [load]);

  const myRole = members.find((m) => m.user_id === user?.id)?.role;
  const isOwner = myRole === "owner";

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    setError(null);
    try {
      setMembers(await api.addMember(currentProject.id, email));
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    }
  };

  const remove = async (userId: string) => {
    if (!currentProject) return;
    try {
      await api.removeMember(currentProject.id, userId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除失败");
    }
  };

  if (!currentProject) return <p className="text-sm text-muted-foreground">请先选择一个项目。</p>;

  return (
    <div className="space-y-4">
      {isOwner && (
        <form onSubmit={add} className="flex gap-2">
          <Input placeholder="邀请已注册用户的邮箱" value={email} type="email" required
                 onChange={(e) => setEmail(e.target.value)} className="max-w-xs" />
          <Button type="submit">添加成员</Button>
        </form>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1">邮箱</th><th>显示名</th><th>角色</th>{isOwner && <th></th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.user_id} className="border-t border-border">
              <td className="py-1">{m.email}</td>
              <td>{m.display_name}</td>
              <td>{m.role === "owner" ? "所有者" : "成员"}</td>
              {isOwner && (
                <td className="text-right">
                  {m.user_id !== user?.id && (
                    <button className="text-destructive hover:underline"
                            onClick={() => remove(m.user_id)}>移除</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Write the members tab test**

Create `frontend/app/settings/__tests__/members.test.tsx` mocking `api.getMembers` to return an owner + a member and asserting both emails render and the "移除" button appears only for the non-self member. (Wrap render in `AuthProvider` + `ProjectProvider` with mocked `api.getMe`/`api.getProjects`, following the pattern in the existing settings tests under `frontend/app/settings/__tests__/` or `frontend/components/__tests__/`.)

- [ ] **Step 4: Run vitest + build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS + build success

- [ ] **Step 5: Commit**

```bash
cd frontend && git add app/settings/page.tsx app/settings/__tests__/members.test.tsx
git commit -m "feat(auth): add workspace members management tab to settings"
```

---

### Task 13: End-to-end journey — log in first

**Files:**
- Modify: `frontend/e2e/journey.spec.ts`
- Modify: `frontend/e2e/theme.spec.ts` (if it navigates to a gated page)

**Interfaces:**
- Consumes: the e2e harness (`npm run e2e` spins up backend :8100 / frontend :3100 + temp sqlite per the updated CLAUDE.md).

- [ ] **Step 1: Read the current e2e setup**

Read `frontend/playwright.config.ts` and `frontend/e2e/journey.spec.ts` to see how the backend is seeded (whether it creates a project/API key via CLI, and how the temp DB is provisioned).

- [ ] **Step 2: Register + log in at the journey start**

At the top of the main journey test, before any navigation to a gated page, register a user through the UI (visit `/login`, toggle to register if needed, submit) OR seed one via the backend and log in. Since registration is on by default, the simplest is: `await page.goto("/login")`, fill register form, submit, expect redirect to `/traces`. Any project the journey needs must be created by that same logged-in user (via the settings UI or `api.createProject`) so membership holds.

- [ ] **Step 3: Run e2e**

Run: `cd frontend && npm run e2e`
Expected: PASS (journey completes as an authenticated user)

- [ ] **Step 4: Full frontend verification**

Run: `cd frontend && npm run build && npx vitest run && npm run lint`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
cd frontend && git add e2e/
git commit -m "test(auth): log in at the start of the e2e journey"
```

---

## Self-Review Checklist (run before execution)

- **Cross-tenant isolation:** Task 7 adds `test_traces_hidden_from_non_member`; Task 6 adds `test_non_owner_cannot_touch_keys`; Task 8 covers member add/remove authz. ✔
- **SSO seam:** `User.auth_source`/`external_id` (Task 1), `AuthProvider` protocol + `get_or_create_user` JIT path (Task 3) — an OIDC provider is a new class + one `login` branch, no schema change. ✔
- **Migration safety:** only `projects.owner_id` is added to an existing table, and it is nullable (Task 1 Step 7 verifies `test_migrate.py`). ✔
- **Ingestion untouched:** no task modifies `routers/ingest.py` or `services/auth.require_api_key`. ✔
- **Legacy data:** Task 9 `backfill_owner.py` assigns the dev's existing demo project to a bootstrap user so it stays visible after auth lands. ✔

## Post-Implementation Manual Step (dev's existing DB)

After merging, to keep the existing demo data visible locally:

```bash
cd backend && source .venv/bin/activate
python -m scripts.create_user you@example.com <password> "Your Name"
python -m scripts.backfill_owner you@example.com
```

Docker/README: add `AUTH_ALLOW_REGISTRATION`, `SECURE_COOKIES`, `SESSION_TTL_DAYS` to `backend/.env.example` and document the two bootstrap commands in the README (fold into Task 9 or a docs touch-up commit).

---

## Follow-up (separate plan — NOT in scope here)

**Per-workspace `ModelProvider` / `ModelPricing` isolation.** Today providers/pricing are global; after this plan they are login-gated but still shared across all workspaces. Moving them per-workspace requires: adding nullable `project_id` to both tables, changing their uniqueness (`model_providers.name` → unique per project; `model_pricings.model` → unique per project) which is a **destructive constraint change** needing a hand-written table-rebuild migration (SQLite can't drop a UNIQUE in place), and threading `project_id` through `services/providers.resolve_provider`, `services/judge_service`, `GET /api/judge-models`, and the settings UI. This deserves its own plan and review cycle because of the migration risk. Recommend writing it as `docs/superpowers/plans/YYYY-MM-DD-per-workspace-providers.md` after this plan merges.
