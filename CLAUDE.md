# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PromptScope is a self-hosted agent tuning & replay platform (团队内部). Agents report full run traces (LLM calls with messages/tool definitions, tool calls with input/output) via an ingestion HTTP API or the bundled Python SDK (`sdk/`); the platform visualizes call chains, supports trace-vs-trace comparison with multi-model LLM-judge scoring (Phase 2, complete), supports record-and-replay with mocked tools including single-step replay of one observation in a multi-step trace (Phase 3 + Phase 4, complete), and supports prompt version management and batch replay/evaluation endpoints (Phase 4, complete). All four phases are complete.

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
- `models/entities.py` — ALL platform entities (designed up-front for Phases 1-4): `Project`, `ApiKey`, `Trace`, `Observation` (tree via `parent_id`, types `llm|tool|span`), `Prompt`/`PromptVersion`, `ReplayRun` (incl. `target_observation_id`, nullable FK to `observations.id`, used for single-step replay), `Evaluation`, `ModelProvider`/`ModelPricing`. Trace/Observation ids are client-generated; `Trace.origin` is `live|replay` (replay outputs are traces too). Python attr `meta` maps to DB column `metadata` (reserved by SQLAlchemy).
- `schemas/ingest.py` — Pydantic ingestion models; enforces llm→messages+model, tool→tool_input + (tool_output|error) with field-level 422 locs
- `schemas/query.py` — response models incl. recursive `ObservationNode` tree
- `services/auth.py` — key hashing (sha256), `require_api_key` dependency
- `services/ingest_service.py` — idempotent upsert (`ingest()`), `compute_cost()` from `ModelPricing` (per-1K-token USD), trace aggregate recompute. Replay reuses `ingest()` to persist replay traces.
- `services/llm_client.py` — `chat_completion(provider, model, messages, model_params=None, client=None)`: dispatches to `_openai_call`/`_anthropic_call` based on `provider.provider_type`, raises `LLMClientError` on any `httpx` failure (status errors carry `status_code`). Used by both judge and replay.
- `services/judge_service.py` — `run_judge(db, subject_trace_id, judge_model, compare_trace_id=None, context_mode="output_only", force=False, client=None)`: resolves the judge model's `ModelProvider` via `ModelPricing`, builds a pairwise (`PAIR_PROMPT`) or single (`SINGLE_PROMPT`) Chinese judge prompt, calls `chat_completion`, extracts the JSON verdict, and persists an `Evaluation` row. Cache lookup keyed on `(subject_trace_id, compare_trace_id, judge_model, context_mode)` unless `force=True`.
- `services/providers.py` — `resolve_provider(db, model)`: looks up `ModelPricing` by model name, requires a non-null `provider_id`, returns the linked `ModelProvider`; raises `400` if the model has no pricing row or no linked provider.
- `services/replay_service.py` — `execute_replay(db, run, client=None)`: the replay engine. If `run.target_observation_id` is set, resolves that specific `llm` observation as the entry point (`_resolve_target`, validated to be an `llm` observation on the source trace, else `400`) for single-step replay; otherwise finds the source trace's first entry `llm` observation. Truncates the entry's message history back to the pre-assistant/tool prefix (optionally swapping in an overridden system prompt), then loops up to `MAX_REPLAY_STEPS` (=15) calling `chat_completion` against the resolved provider/model, bounded overall by a `MAX_REPLAY_WALL_SECONDS` (=240) wall-clock guard checked at the top of each loop iteration (exceeding it appends a `wall_clock_exceeded` divergence, breaks the loop, and marks the run `failed` — protects against a single stuck/slow provider call monopolizing a synchronous request indefinitely). Tool calls are never executed for real — `RecordedTools` buckets tool observations into per-tool-name FIFO queues; for a single-step replay the queues are scoped to only the target observation's direct children (`parent_id == target.id`), so single-step replay never consumes recorded tool calls that belong to other steps in the same source trace (subtree isolation). Each actual tool call pops the next recorded observation for that name and feeds its `tool_output` back into the conversation. Divergences are appended to a list but never abort the loop (`param_mismatch`, `unrecorded_call`, `max_steps_exceeded`, `wall_clock_exceeded`). Anthropic providers raise `400` up front if the entry call carries `tool_definitions` (tool replay unsupported for anthropic). Persists results via `_persist_result()`, which calls `ingest()` to write the replay trace/observations before writing `run.result_trace_id` (FK ordering — see Key Design Decisions); single-step replay traces get a `(replay:step-N)` name suffix and `target_observation_id` in trace metadata, vs. `(replay)` for full-chain replay. On `LLMClientError` the loop stops, any observations produced so far are still persisted, and `run.status = "failed"` with the real error in `run.error`.
- `routers/ingest.py` — `POST /api/ingest` (auth required)
- `routers/query.py` — `GET /api/projects`, `GET /api/traces` (filter/search/pagination, eager-loads observations), `GET /api/traces/{id}` (observation tree via `build_tree`)
- `routers/config.py` — CRUD for `ModelProvider` (`/api/providers`) and `ModelPricing` (`/api/pricing`), plus `GET /api/judge-models` (inner join of pricing+provider — only pricing rows with a linked provider are usable as judge models)
- `routers/prompts.py` — `GET /api/prompts` (list, optional `project_id` filter), `POST /api/prompts` (create prompt + version 1, `name` unique per project, 409 on dup), `GET /api/prompts/{id}` (detail incl. all versions), `POST /api/prompts/{id}/versions` (append version, auto `max(existing)+1`, prior versions immutable), `GET /api/prompt-versions/{version_id}/traces` (traces referencing a version, matched via `Trace.prompt_version_id` or any child `Observation.prompt_version_id`, capped at 100, newest first)
- `routers/evaluations.py` — `POST /api/evaluations` (runs one or more judge models, per-model try/except so one failure doesn't abort the batch — returns `200` with `results[].status == "error"` on failure, never a 500 or fabricated score), `POST /api/evaluations/batch` (Phase 4: cartesian product of `subject_trace_ids` (1-50) × `judge_models`, single-trace evaluation only — no `compare_trace_id` — per-combination try/except mirroring the single-evaluate endpoint), `GET /api/evaluations` (list cached evaluations by subject/compare trace id)
- `routers/replay.py` — `POST /api/replays` (accepts optional `target_observation_id` for single-step replay), `POST /api/replays/batch` (Phase 4: `source_trace_ids` (1-20), same override config applied to each, full-chain replay only — `BatchReplayRequest` has no `target_observation_id`), `GET /api/replays/{id}`, `GET /api/replays?source_trace_id=` (list runs for a source trace, newest first). Both POST endpoints funnel through a shared `_run_one()` helper that does source-trace lookup (404 if missing), the `origin == "live"` guard (400 on replaying a replay), `ReplayRun` row creation, and the `execute_replay()` call wrapped so any `HTTPException` or unexpected exception marks the already-committed run `failed` with the real error — so single-step, full-chain, and batch replay all share identical validation and failure handling instead of drifting.
- `tests/` — pytest suite on in-memory SQLite (`db_session` fixture in conftest overrides `get_db`); `tests/test_replay.py` / `tests/test_replay_api.py` cover the replay engine and endpoints (including single-step replay, wall-clock guard, and batch endpoints)

### Python SDK (sdk/)

- `sdk/promptscope/client.py` — `PromptScopeClient(base_url, api_key)` + `TraceContext`: a thin wrapper over the ingestion API, dependency-free besides `httpx`. `client.trace(name, input=, metadata=)` returns a `TraceContext` used as a context manager; `TraceContext.llm(...)` / `.tool(...)` append observation dicts locally (auto-filling `id`, `seq`, `started_at`/`ended_at`), `.set_output(...)` sets the trace's final output. On `__exit__`, normal exit flushes with `trace.status = "success"`; an exception in the `with` block sets `trace.status = "error"` before flushing and then always re-raises the original exception — if `flush()` itself also fails on that error path, the SDK only prints to stderr and still re-raises the original exception (never swaps in or swallows it). `client.flush(trace_context)` POSTs `{"trace": ..., "observations": [...]}` to `/api/ingest` and is idempotent (`_flushed` guard — a second call is a no-op); the JSON payload is a plain dict but is validated server-side by the exact same `IngestRequest` Pydantic model the raw HTTP ingestion path uses (FastAPI parses the request body into `IngestRequest` regardless of client), so SDK-reported traces get identical validation to direct HTTP callers — see `examples/report_agent_run.py` for a full usage example. `sdk/README.md` has the field reference.

### Frontend (frontend/)

- `lib/api.ts` — typed client mirroring backend response schemas field-for-field
- `lib/format.ts` — `formatCost`/`formatLatency`/`formatTokens`
- `contexts/ProjectContext.tsx` — project switcher state, localStorage key `promptscope.projectId`
- `components/TopBar.tsx`, `TraceTable.tsx`, `TraceTree.tsx`, `ObservationDetail.tsx`
- `app/traces/page.tsx` — list with origin filter + search (server-side filtering); checkbox-based 2-trace selection (`compareIds`) that surfaces a "对比选中项" link into `/compare`
- `app/traces/[id]/page.tsx` — detail: header summary + call-chain tree + node detail; when the source trace is `origin === "live"` and the selected node is `type === "llm"`, shows a "单点回放此步 ▶" link into `/replay/{id}?target=<observation_id>`
- `app/compare/page.tsx` — `/compare?a=<id>&b=<id>` dual-trace workspace: cost/latency/token summary, `AlignedTraceView` (aligned rows from `lib/align.ts`), and `JudgePanel`
- `app/replay/[id]/page.tsx` — replay configuration + results page for a source trace (linked from `/traces/{id}`'s "回放 ▶" button, shown only when `trace.origin === "live"`): override model (dropdown from `GET /api/judge-models`) / temperature / system prompt, "运行回放 ▶" calls `POST /api/replays` synchronously, then renders the returned run (status badge, error, divergence list, links to `/compare?a=<source>&b=<result_trace_id>` and `/traces/<result_trace_id>`) plus a history list from `GET /api/replays?source_trace_id=`. Reads an optional `?target=<observation_id>` query param — when present, submits `target_observation_id` in the replay request and defaults the editable system-prompt field to the target observation's own system message (not the trace's entry observation), labeling the page as a single-step replay of that node.
- `app/prompts/page.tsx` — Prompt library: left column lists prompts for the current project (`GET /api/prompts?project_id=`) plus a create form (`POST /api/prompts`); right column shows version history for the selected prompt (`GET /api/prompts/{id}`), newest first, each version card offering "基于此版本新建" (fork — edits go to `POST /api/prompts/{id}/versions`, never mutates the existing version) and an expandable "使用此版本的 traces" panel (`GET /api/prompt-versions/{version_id}/traces`). Checking two version cards renders a side-by-side plain-text diff view (no line-level highlighting) above the version list.
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
- Query/config/evaluations APIs are deliberately unauthenticated (team-internal, network-boundary protected; CORS restricted to the frontend origin). Only ingestion requires an API key. Evaluations/replay endpoints spend real provider money — a lightweight shared-secret gate remains a future hardening item.
- Replay divergences never abort the run: `param_mismatch` (actual tool-call arguments differ from the next recorded call for that tool name) and `unrecorded_call` (no recorded observation left in that tool's FIFO queue) are appended to `ReplayRun.divergences` and execution continues with the recorded/placeholder result. Only an actual provider call failure (`LLMClientError`, e.g. bad API key, non-2xx, network error) stops the loop — and even then the real error is written to `run.error` verbatim, never masked or replaced with a fabricated result.
- `_persist_result()` in `services/replay_service.py` must call `ingest()` to write the replay trace/observations to the DB *before* setting `run.result_trace_id` — `ReplayRun.result_trace_id` is a foreign key to `traces.id`, so writing it before the trace row exists would violate the FK constraint (fails hard on Postgres; SQLite is looser but the ordering is still required for correctness). This also means a replay that fails after producing at least one observation still leaves a partial replay trace behind (`origin=replay`, `status=error`) for inspection — replay results are never silently discarded on failure.
- Replay must go through `ingest()` rather than writing `Trace`/`Observation` rows directly, so replay traces get the same aggregate recompute (cost/latency/token totals) and validation as live-reported traces, and remain indistinguishable in the query/compare/judge APIs except for `origin`.
- Anthropic tool replay is out of scope for the Phase 3 MVP: `execute_replay()` raises `400` up front if the entry LLM observation carries `tool_definitions` and the resolved provider's `provider_type == "anthropic"`, rather than attempting a translation to Anthropic's tool-call format.
- `routers/replay.py` `_run_one()` (shared by `create_replay()` and `batch_replay()`) rejects replaying a `replay`-origin trace (`source.origin != "live"` → `400`) before creating the `ReplayRun` row, and wraps the `execute_replay()` call so any `HTTPException` or unexpected exception marks the already-committed `ReplayRun` as `failed` (with the real error in `run.error`) instead of leaving it stuck at `pending`/`running`. Keeping this in one function is deliberate: single-step, full-chain, and batch replay must not drift apart on validation or failure handling.
- `MAX_REPLAY_STEPS = 15` bounds the LLM↔mock-tool round-trip loop in `execute_replay()`; hitting the cap without a final (non-tool-call) response records a `max_steps_exceeded` divergence and marks the run `failed`, but any observations already produced are still persisted.
- **Single-step replay subtree isolation**: when `ReplayRun.target_observation_id` is set, `execute_replay()` resolves that specific `llm` observation as the replay entry point instead of the trace's first `llm` observation, and scopes `RecordedTools` to only the tool observations that are direct children of the target (`parent_id == target.id`). This is a deliberate isolation boundary — a multi-step trace can have several `llm` nodes each with their own tool calls, and single-step replay of node B must never accidentally consume or get confused by tool recordings that belong to node A's subtree. Omitting `target_observation_id` preserves the original Phase 3 behavior exactly (entry = first `llm` observation, tool queues built from *all* tool observations in the trace).
- **Replay wall-clock guard**: `MAX_REPLAY_WALL_SECONDS = 240` in `services/replay_service.py` is checked at the top of every loop iteration in `execute_replay()`, independent of `MAX_REPLAY_STEPS`. It exists because `MAX_REPLAY_STEPS` bounds round-trip *count* but not wall-clock time — a single slow/hanging provider call could otherwise block the synchronous `POST /api/replays` request indefinitely. Exceeding it appends a `wall_clock_exceeded` divergence, breaks the loop without raising, and the run is persisted as `failed` (observations produced so far are kept, same partial-persistence guarantee as `max_steps_exceeded`).
- **SDK payload must pass `IngestRequest` validation**: `sdk/promptscope/client.py`'s `TraceContext.flush()` builds a plain dict and POSTs it to `/api/ingest` — it does not pre-validate client-side. The backend's `ingest_endpoint()` still parses the body into the same `schemas.ingest.IngestRequest` Pydantic model used by direct HTTP callers, so the SDK gets no special leniency; any SDK change that would produce a payload violating `IngestRequest` (e.g. an `llm` observation without `messages`/`model`) must be caught by that shared validation, not worked around in the SDK.
- **SDK flush failure must never mask the original exception**: in `TraceContext.__exit__`, when the wrapped code raised, the SDK marks the trace `status="error"` and attempts to flush before re-raising. If that flush itself fails (e.g. ingestion API unreachable), the SDK only logs to stderr and still re-raises the *original* exception — it must never raise the flush error in place of the original exception, since that would hide the real bug from the caller behind an unrelated networking failure.

## Working Conventions

- Follow the phase plans in `docs/superpowers/plans/`; Phase 2 (compare + judge), Phase 3 (replay engine), Phase 4 (prompt mgmt, SDK, batch) build on the existing entities — avoid schema rewrites.
- Backend tests: TDD, run `python -m pytest tests/ -v` from `backend/` before committing.
- git commits: no AI attribution of any kind.
