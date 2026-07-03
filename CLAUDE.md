# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PromptScope is a self-hosted agent tuning & replay platform (团队内部). Agents report full run traces (LLM calls with messages/tool definitions, tool calls with input/output) via an ingestion HTTP API; the platform visualizes call chains, and will support trace-vs-trace comparison with LLM-judge scoring (Phase 2) and record-and-replay with mocked tools (Phase 3).

Design spec: `docs/superpowers/specs/2026-07-04-agent-replay-platform-design.md` (supersedes the retired Langfuse-based design). Implementation plans live in `docs/superpowers/plans/`.

## Development Commands

### Backend (FastAPI + SQLAlchemy 2.0)

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000
python -m pytest tests/ -v          # test suite
python -m scripts.create_project <name>   # create project + API key (printed once)
```

### Frontend (Next.js 14)

```bash
cd frontend
npm run dev       # dev server on :3000 (proxies /api/* to :8000 via next.config.js)
npm run build
npx vitest run    # component tests
```

### Docker (full stack, Postgres 16)

```bash
docker-compose up -d   # postgres (host port 5433) + backend + frontend
```

## Environment

- `DATABASE_URL` — defaults to `sqlite:///./db/promptscope.db` for zero-config local dev; docker-compose sets Postgres (`postgresql+psycopg://...`). See `backend/.env.example`.
- Ingestion requires a Bearer API key (issued by `scripts/create_project.py`); query APIs are unauthenticated (internal, same-origin frontend).

## Architecture

### Backend (backend/)

- `main.py` — FastAPI app, lifespan (create_all), CORS, router mounting under `/api`
- `config.py` / `db.py` — DATABASE_URL, engine, `SessionLocal`, `Base`, `get_db`
- `models/entities.py` — ALL platform entities (designed up-front for Phases 1-4): `Project`, `ApiKey`, `Trace`, `Observation` (tree via `parent_id`, types `llm|tool|span`), `Prompt`/`PromptVersion`, `ReplayRun`, `Evaluation`, `ModelProvider`/`ModelPricing`. Trace/Observation ids are client-generated; `Trace.origin` is `live|replay` (replay outputs are traces too). Python attr `meta` maps to DB column `metadata` (reserved by SQLAlchemy).
- `schemas/ingest.py` — Pydantic ingestion models; enforces llm→messages+model, tool→tool_input + (tool_output|error) with field-level 422 locs
- `schemas/query.py` — response models incl. recursive `ObservationNode` tree
- `services/auth.py` — key hashing (sha256), `require_api_key` dependency
- `services/ingest_service.py` — idempotent upsert (`ingest()`), `compute_cost()` from `ModelPricing` (per-1K-token USD), trace aggregate recompute. Phase 3 replay will reuse `ingest()` to persist replay traces.
- `routers/ingest.py` — `POST /api/ingest` (auth required)
- `routers/query.py` — `GET /api/projects`, `GET /api/traces` (filter/search/pagination, eager-loads observations), `GET /api/traces/{id}` (observation tree via `build_tree`)
- `tests/` — pytest suite on in-memory SQLite (`db_session` fixture in conftest overrides `get_db`)

### Frontend (frontend/)

- `lib/api.ts` — typed client mirroring backend response schemas field-for-field
- `lib/format.ts` — `formatCost`/`formatLatency`/`formatTokens`
- `contexts/ProjectContext.tsx` — project switcher state, localStorage key `promptscope.projectId`
- `components/TopBar.tsx`, `TraceTable.tsx`, `TraceTree.tsx`, `ObservationDetail.tsx`
- `app/traces/page.tsx` — list with origin filter + search (server-side filtering)
- `app/traces/[id]/page.tsx` — detail: header summary + call-chain tree + node detail
- `components/__tests__/` — vitest + @testing-library/react

### Key Design Decisions

- Replay outputs ARE traces (`origin=replay`) so chain view / compare / judge work identically on live and replayed runs.
- llm observations must carry full message sequence + tool definitions; tool observations must carry input and output — these are what make Phase 3 replay possible. Never weaken these ingestion requirements.
- Judge failures must NOT fall back to mock results (old graceful-degradation behavior was deliberately retired — fake data poisons cost/quality decisions).
- Model pricing lives in the `model_pricings` table, not hardcoded.

## Working Conventions

- Follow the phase plans in `docs/superpowers/plans/`; Phase 2 (compare + judge), Phase 3 (replay engine), Phase 4 (prompt mgmt, SDK, batch) build on the existing entities — avoid schema rewrites.
- Backend tests: TDD, run `python -m pytest tests/ -v` from `backend/` before committing.
- git commits: no AI attribution of any kind.
