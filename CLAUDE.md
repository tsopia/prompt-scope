# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PromptScope is an LLM comparison and cost optimization platform built on top of Langfuse. It lets users compare LLM outputs side-by-side, run LLM-judge evaluations via OpenAI, and visualize cost vs. quality tradeoffs.

## Development Commands

### Backend (FastAPI + Python)

```bash
cd backend
source .venv/bin/activate   # or: source venv/bin/activate
uvicorn main:app --reload --port 8000
```

### Frontend (Next.js 14)

```bash
cd frontend
npm run dev       # dev server on :3000
npm run build     # production build
npm run lint      # ESLint
```

### Docker (full stack)

```bash
docker-compose up -d   # starts both services
```

## Environment Setup

Copy and populate both env files before running:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env  # optional for local dev
```

Backend requires: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `OPENAI_API_KEY`. All others have defaults.

## Architecture

### Request Flow

The frontend makes all API calls to the same origin (empty `API_BASE` in `lib/api.ts`). Next.js rewrites `/api/*` → `http://127.0.0.1:8000/api/*` via `next.config.js`. In Docker, `NEXT_PUBLIC_API_URL` / `API_PROXY_HOST` env var changes this target.

### Backend Layer (backend/)

- `main.py` — FastAPI app, CORS config, lifespan (DB init + initial sync + scheduler start)
- `models/database.py` — raw SQLite ops (no ORM); three tables: `candidates`, `compare_results`, `sync_status`
- `models/schemas.py` — Pydantic v2 request/response models
- `services/candidate_service.py` — Langfuse → Candidate mapping, cost calculation, `MODEL_PRICING` table (edit here to update prices)
- `services/judge_service.py` — OpenAI LLM judge; results are cached in SQLite to avoid re-calling the API
- `services/langfuse_client.py` — Langfuse HTTP API wrapper
- `services/sync_service.py` — APScheduler job that runs `sync_candidates_from_langfuse` every 5 minutes
- `services/mock_data.py` — fallback data used when Langfuse is unreachable

### Frontend Layer (frontend/)

- `app/` — single-page Next.js App Router layout; `page.tsx` is the entire UI
- `components/` — `CandidateList`, `CandidateCard`, `ComparePanel`, `CostChart`, `SyncButton`
- `lib/api.ts` — typed API client (`api.getCandidates()`, `api.compare()`, etc.)
- `store/useStore.ts` — Zustand store; holds candidates, up-to-2 selected IDs, compare result, sort state

### Key Design Decisions

- **Graceful degradation**: if Langfuse sync fails, mock data is loaded automatically; if OpenAI judge fails, a mock result is returned — the app always has data.
- **Compare caching**: `judge_service` checks `compare_results` table before calling OpenAI; bidirectional lookup supported.
- **Model pricing**: hardcoded dict in `candidate_service.py:MODEL_PRICING`. Default pricing applied to unknown models is `{"input": 0.01, "output": 0.03}`.
- **Candidate selection**: Zustand `toggleCandidate` enforces max 2 selections; adding a 3rd drops the first.
