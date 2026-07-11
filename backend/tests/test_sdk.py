import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sdk"))

from promptscope.client import PromptScopeClient, PromptScopeError  # noqa: E402

from schemas.ingest import IngestRequest  # noqa: E402


def capture_transport(captured: list, status=200):
    def handler(request):
        assert request.headers["authorization"] == "Bearer ps-key"
        captured.append(json.loads(request.content))
        if status >= 400:
            return httpx.Response(status, json={"detail": "boom"})
        return httpx.Response(status, json={"trace_id": "x",
                                            "observation_count": 0})
    return httpx.MockTransport(handler)


def test_sdk_payload_passes_backend_validation():
    captured = []
    client = PromptScopeClient("http://x", "ps-key",
                               transport=capture_transport(captured))
    with client.trace("run", input={"q": "hi"}) as t:
        llm_id = t.llm("plan", model="gpt-4o",
                       messages=[{"role": "user", "content": "hi"}],
                       tool_calls=[{"name": "search", "arguments": {}}],
                       input_tokens=10, output_tokens=5)
        t.tool("search", tool_input={"q": "hi"}, tool_output={"r": 1},
               parent=llm_id)
        t.llm("answer", model="gpt-4o",
              messages=[{"role": "user", "content": "hi"}],
              completion="hello", input_tokens=20, output_tokens=8)
        t.set_output({"answer": "hello"})

    assert len(captured) == 1
    payload = IngestRequest.model_validate(captured[0])  # 必须过后端校验
    assert payload.trace.name == "run"
    assert payload.trace.output == {"answer": "hello"}
    assert [o.seq for o in payload.observations] == [0, 1, 2]
    assert payload.observations[1].parent_id == payload.observations[0].id


def test_sdk_marks_error_on_exception():
    captured = []
    client = PromptScopeClient("http://x", "ps-key",
                               transport=capture_transport(captured))
    with pytest.raises(ValueError):
        with client.trace("run") as t:
            t.tool("s", tool_input={}, tool_output={})
            raise ValueError("agent crashed")
    assert captured[0]["trace"]["status"] == "error"


def test_sdk_raises_on_http_error():
    client = PromptScopeClient("http://x", "ps-key",
                               transport=capture_transport([], status=401))
    with pytest.raises(PromptScopeError, match="boom"):
        with client.trace("run"):
            pass


def test_sdk_original_exception_survives_flush_failure(capsys):
    client = PromptScopeClient("http://x", "ps-key",
                               transport=capture_transport([], status=500))
    with pytest.raises(ValueError, match="agent crashed"):
        with client.trace("run"):
            raise ValueError("agent crashed")
    assert "上报失败" in capsys.readouterr().err


def test_sdk_span_passes_backend_validation():
    captured = []
    client = PromptScopeClient("http://x", "ps-key",
                               transport=capture_transport(captured))
    with client.trace("run") as t:
        span_id = t.span("retrieve", input={"q": "hi"}, output={"docs": []})
        t.tool("search", tool_input={"q": "hi"}, tool_output={"r": 1},
               parent=span_id)

    payload = IngestRequest.model_validate(captured[0])
    span_obs = payload.observations[0]
    assert span_obs.type == "span"
    assert span_obs.metadata == {"input": {"q": "hi"}, "output": {"docs": []}}
    assert payload.observations[1].parent_id == span_obs.id


def test_sdk_span_error_status():
    captured = []
    client = PromptScopeClient("http://x", "ps-key",
                               transport=capture_transport(captured))
    with client.trace("run") as t:
        t.span("retrieve", error="boom")

    payload = IngestRequest.model_validate(captured[0])
    assert payload.observations[0].status == "error"
    assert payload.observations[0].error == "boom"


def test_sdk_prompt_version_id_on_trace_and_llm():
    captured = []
    client = PromptScopeClient("http://x", "ps-key",
                               transport=capture_transport(captured))
    with client.trace("run", prompt_version_id="pv-1") as t:
        t.llm("plan", model="gpt-4o",
              messages=[{"role": "user", "content": "hi"}],
              prompt_version_id="pv-2")

    payload = IngestRequest.model_validate(captured[0])
    assert payload.trace.prompt_version_id == "pv-1"
    assert payload.observations[0].prompt_version_id == "pv-2"


def test_sdk_llm_error_status_and_metadata():
    captured = []
    client = PromptScopeClient("http://x", "ps-key",
                               transport=capture_transport(captured))
    with client.trace("run") as t:
        t.llm("plan", model="gpt-4o",
              messages=[{"role": "user", "content": "hi"}],
              error="rate limited", metadata={"reasoning_content": "..."})

    payload = IngestRequest.model_validate(captured[0])
    obs = payload.observations[0]
    assert obs.status == "error"
    assert obs.error == "rate limited"
    assert obs.metadata == {"reasoning_content": "..."}


def test_sdk_client_close_and_context_manager():
    client = PromptScopeClient("http://x", "ps-key",
                               transport=capture_transport([]))
    client.close()
    assert client._http.is_closed

    with PromptScopeClient("http://x", "ps-key",
                           transport=capture_transport([])) as c:
        assert c._http.is_closed is False
    assert c._http.is_closed
