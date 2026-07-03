# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PromptScope is a self-hosted agent tuning & replay platform (团队内部). Agents report full run traces (LLM calls with messages/tool definitions, tool calls with input/output) via an ingestion HTTP API; the platform visualizes call chains, supports trace-vs-trace comparison with multi-model LLM-judge scoring (Phase 2, complete), and will support record-and-replay with mocked tools (Phase 3).

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
- `services/llm_client.py` — `chat_completion(provider, model, messages, model_params=None, client=None)`: dispatches to `_openai_call`/`_anthropic_call` based on `provider.provider_type`, raises `LLMClientError` on any `httpx` failure (status errors carry `status_code`). Used by judge today; Phase 3 replay will call the same function.
- `services/judge_service.py` — `run_judge(db, subject_trace_id, judge_model, compare_trace_id=None, context_mode="output_only", force=False, client=None)`: resolves the judge model's `ModelProvider` via `ModelPricing`, builds a pairwise (`PAIR_PROMPT`) or single (`SINGLE_PROMPT`) Chinese judge prompt, calls `chat_completion`, extracts the JSON verdict, and persists an `Evaluation` row. Cache lookup keyed on `(subject_trace_id, compare_trace_id, judge_model, context_mode)` unless `force=True`.
- `routers/ingest.py` — `POST /api/ingest` (auth required)
- `routers/query.py` — `GET /api/projects`, `GET /api/traces` (filter/search/pagination, eager-loads observations), `GET /api/traces/{id}` (observation tree via `build_tree`)
- `routers/config.py` — CRUD for `ModelProvider` (`/api/providers`) and `ModelPricing` (`/api/pricing`), plus `GET /api/judge-models` (inner join of pricing+provider — only pricing rows with a linked provider are usable as judge models)
- `routers/evaluations.py` — `POST /api/evaluations` (runs one or more judge models, per-model try/except so one failure doesn't abort the batch — returns `200` with `results[].status == "error"` on failure, never a 500 or fabricated score), `GET /api/evaluations` (list cached evaluations by subject/compare trace id)
- `tests/` — pytest suite on in-memory SQLite (`db_session` fixture in conftest overrides `get_db`)

### Frontend (frontend/)

- `lib/api.ts` — typed client mirroring backend response schemas field-for-field
- `lib/format.ts` — `formatCost`/`formatLatency`/`formatTokens`
- `contexts/ProjectContext.tsx` — project switcher state, localStorage key `promptscope.projectId`
- `components/TopBar.tsx`, `TraceTable.tsx`, `TraceTree.tsx`, `ObservationDetail.tsx`
- `app/traces/page.tsx` — list with origin filter + search (server-side filtering); checkbox-based 2-trace selection (`compareIds`) that surfaces a "对比选中项" link into `/compare`
- `app/traces/[id]/page.tsx` — detail: header summary + call-chain tree + node detail
- `app/compare/page.tsx` — `/compare?a=<id>&b=<id>` dual-trace workspace: cost/latency/token summary, `AlignedTraceView` (aligned rows from `lib/align.ts`), and `JudgePanel`
- `app/settings/page.tsx` — provider CRUD table + pricing CRUD table (pricing row's `provider_id` dropdown determines judge-model eligibility)
- `lib/align.ts` — `alignTraces(aTree, bTree)`: flattens both observation trees, runs classic LCS DP keyed on `(type, name)` to produce `AlignedRow[]` with `status: matched|only_left|only_right` and a `paramDiff` flag when matched tool observations' `tool_input` differ
- `components/__tests__/`, `lib/__tests__/align.test.ts` — vitest + @testing-library/react

### Key Design Decisions

- Replay outputs ARE traces (`origin=replay`) so chain view / compare / judge work identically on live and replayed runs.
- llm observations must carry full message sequence + tool definitions; tool observations must carry input and output — these are what make Phase 3 replay possible. Never weaken these ingestion requirements.
- Judge failures must NOT fall back to mock results (old graceful-degradation behavior was deliberately retired — fake data poisons cost/quality decisions). `routers/evaluations.py` catches per-model exceptions and reports `status: "error"` with the real error message instead of returning 500 or writing a fabricated `Evaluation` row.
- Judge cache key is `(subject_trace_id, compare_trace_id, judge_model, context_mode)` — `run_judge()` reuses a cached `Evaluation` on match unless `force=True`, so re-running the same judge/context combo doesn't re-spend tokens.
- `Evaluation.score` is always the subject/A-side score; `Evaluation.score_b` is the compare/B-side score and is `null` for single-trace evaluations (no `compare_trace_id`). `verdict` is `pass`/`fail` for single-trace, `replaceable`/`not_replaceable` for pairwise.
- Model pricing lives in the `model_pricings` table, not hardcoded. Only pricing rows with a non-null `provider_id` are usable as judge models (see `GET /api/judge-models`).
- `ModelProvider.api_key` is write-only from the API's perspective: `ProviderOut` exposes `api_key_set: bool` only, never the raw key; `PUT /api/providers/{id}` leaves the stored key untouched when the request omits `api_key`.
- Query/config/evaluations APIs are deliberately unauthenticated (team-internal, network-boundary protected; CORS restricted to the frontend origin). Only ingestion requires an API key. Evaluations/replay endpoints spend real provider money — a lightweight shared-secret gate is planned alongside Phase 3 replay.

## Working Conventions

- Follow the phase plans in `docs/superpowers/plans/`; Phase 2 (compare + judge), Phase 3 (replay engine), Phase 4 (prompt mgmt, SDK, batch) build on the existing entities — avoid schema rewrites.
- Backend tests: TDD, run `python -m pytest tests/ -v` from `backend/` before committing.
- git commits: no AI attribution of any kind.
