"""PromptScope Python SDK: report agent run traces to the ingestion API.

Usage:
    from promptscope import PromptScopeClient

    client = PromptScopeClient(base_url, api_key)
    with client.trace("run", input={"q": "hi"}) as t:
        t.llm("plan", model="gpt-4o", messages=[...])
        t.tool("search", tool_input={...}, tool_output={...})
        t.set_output({"answer": "hello"})
"""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx


class PromptScopeError(Exception):
    """Raised when the ingestion API returns a non-2xx response."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


class TraceContext:
    """Collects observations for a single trace and reports them on flush.

    Obtained via `PromptScopeClient.trace(...)`. Used as a context manager:
    on normal exit the trace is flushed with status "success"; on an
    exception the trace status is set to "error" and the exception is
    re-raised after flushing.
    """

    def __init__(self, client: "PromptScopeClient", name: str,
                 input: Any = None, metadata: dict | None = None,
                 prompt_version_id: str | None = None):
        self._client = client
        self._seq = 0
        self._flushed = False
        self._observations: list[dict] = []
        self.trace: dict = {
            "id": _new_id(),
            "name": name,
            "input": input,
            "metadata": metadata,
            "status": "success",
            "started_at": _now_iso(),
            "prompt_version_id": prompt_version_id,
        }

    def _next_seq(self) -> int:
        seq = self._seq
        self._seq += 1
        return seq

    def llm(self, name: str, model: str, messages: list, *,
            model_params: dict | None = None,
            tool_definitions: list | None = None,
            tool_calls: list | None = None,
            completion: Any = None,
            input_tokens: int | None = None,
            output_tokens: int | None = None,
            prompt_version_id: str | None = None,
            metadata: dict | None = None,
            error: str | None = None,
            parent: str | None = None) -> str:
        obs_id = _new_id()
        started_at = _now_iso()
        self._observations.append({
            "id": obs_id,
            "parent_id": parent,
            "type": "llm",
            "name": name,
            "seq": self._next_seq(),
            "status": "error" if error is not None else "success",
            "error": error,
            "metadata": metadata,
            "model": model,
            "model_params": model_params,
            "messages": messages,
            "tool_definitions": tool_definitions,
            "tool_calls": tool_calls,
            "completion": completion,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "prompt_version_id": prompt_version_id,
            "started_at": started_at,
            "ended_at": _now_iso(),
        })
        return obs_id

    def tool(self, name: str, tool_input: Any, tool_output: Any = None,
             error: str | None = None, parent: str | None = None) -> str:
        obs_id = _new_id()
        started_at = _now_iso()
        self._observations.append({
            "id": obs_id,
            "parent_id": parent,
            "type": "tool",
            "name": name,
            "seq": self._next_seq(),
            "status": "error" if error is not None else "success",
            "error": error,
            "tool_input": tool_input,
            "tool_output": tool_output,
            "started_at": started_at,
            "ended_at": _now_iso(),
        })
        return obs_id

    def span(self, name: str, *, input: Any = None, output: Any = None,
             metadata: dict | None = None, status: str = "success",
             error: str | None = None, parent_id: str | None = None) -> str:
        """Generic span observation, for grouping/marking a logical step
        that is neither an `llm` nor a `tool` call (e.g. a retrieval step,
        a sub-agent boundary). Unlike `llm`/`tool`, the ingestion schema has
        no dedicated columns for span input/output, so they are folded into
        `metadata` under the `input`/`output` keys rather than being
        silently dropped."""
        obs_id = _new_id()
        started_at = _now_iso()
        span_metadata = dict(metadata) if metadata else {}
        if input is not None:
            span_metadata.setdefault("input", input)
        if output is not None:
            span_metadata.setdefault("output", output)
        self._observations.append({
            "id": obs_id,
            "parent_id": parent_id,
            "type": "span",
            "name": name,
            "seq": self._next_seq(),
            "status": "error" if error is not None else status,
            "error": error,
            "metadata": span_metadata or None,
            "started_at": started_at,
            "ended_at": _now_iso(),
        })
        return obs_id

    def set_output(self, output: Any) -> None:
        self.trace["output"] = output

    def __enter__(self) -> "TraceContext":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if exc_type is not None:
            self.trace["status"] = "error"
        self.trace["ended_at"] = _now_iso()
        if exc_type is None:
            # Normal exit: flush errors propagate normally
            self._client.flush(self)
        else:
            # Exception during agent code: preserve original exception
            try:
                self._client.flush(self)
            except Exception as e:
                print(f"promptscope: 上报失败（原始异常保留）: {e}", file=sys.stderr)
        # returning None (falsy) re-raises any exception


class PromptScopeClient:
    """Client for reporting agent run traces to the PromptScope ingestion API."""

    def __init__(self, base_url: str, api_key: str,
                 transport: httpx.BaseTransport | None = None):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._http = httpx.Client(transport=transport)

    def trace(self, name: str, input: Any = None,
              metadata: dict | None = None,
              prompt_version_id: str | None = None) -> TraceContext:
        return TraceContext(self, name, input=input, metadata=metadata,
                            prompt_version_id=prompt_version_id)

    def close(self) -> None:
        """Close the underlying httpx client (releases the connection pool).

        This is independent of trace flushing: any `TraceContext` that
        hasn't been flushed yet (e.g. via its `with` block or an explicit
        `client.flush(...)` call) must be flushed *before* calling `close`,
        otherwise the flush's HTTP request will fail against a closed
        client.
        """
        self._http.close()

    def __enter__(self) -> "PromptScopeClient":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    def flush(self, trace_context: TraceContext) -> None:
        """Send the trace's observations to the ingestion API. Idempotent:
        a second call on an already-flushed trace context is a no-op."""
        if trace_context._flushed:
            return
        trace_context._flushed = True
        payload = {
            "trace": trace_context.trace,
            "observations": trace_context._observations,
        }
        resp = self._http.post(
            f"{self._base_url}/api/ingest",
            json=payload,
            headers={"Authorization": f"Bearer {self._api_key}"},
        )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except ValueError:
                detail = resp.text
            raise PromptScopeError(detail)
