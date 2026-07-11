import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sdk"))

from promptscope.client import PromptScopeClient  # noqa: E402
from promptscope.instrument import instrument_openai, wrap_openai  # noqa: E402

from schemas.ingest import IngestRequest  # noqa: E402


def _mock_client():
    """Bare PromptScopeClient, transport never actually invoked in these
    tests since we only inspect the in-memory TraceContext."""
    return PromptScopeClient("http://x", "ps-key",
                             transport=httpx.MockTransport(
                                 lambda r: httpx.Response(200, json={
                                     "trace_id": "x", "observation_count": 0})))


class FakeChatCompletions:
    def __init__(self, response=None, exc=None):
        self._response = response
        self._exc = exc
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._exc is not None:
            raise self._exc
        return self._response


class FakeChat:
    def __init__(self, completions):
        self.completions = completions


class FakeOpenAI:
    def __init__(self, response=None, exc=None):
        self.chat = FakeChat(FakeChatCompletions(response=response, exc=exc))


def _canned_response(content="hi there", tool_calls=None,
                      reasoning_content=None,
                      prompt_tokens=10, completion_tokens=5):
    message = SimpleNamespace(content=content, tool_calls=tool_calls,
                              reasoning_content=reasoning_content)
    choice = SimpleNamespace(message=message)
    usage = SimpleNamespace(prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens)
    return SimpleNamespace(choices=[choice], usage=usage)


def test_wrap_openai_captures_tools_and_params_verbatim():
    tools = [{"type": "function", "function": {
        "name": "get_weather", "description": "查询城市天气",
        "parameters": {"type": "object",
                       "properties": {"city": {"type": "string"}}}}}]
    ps_client = _mock_client()
    with ps_client.trace("run") as t:
        client = wrap_openai(FakeOpenAI(response=_canned_response()), t)
        client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "北京今天天气怎么样？"}],
            tools=tools,
            temperature=0.2,
            top_p=0.9,
            max_tokens=256,
        )

    payload = IngestRequest.model_validate({
        "trace": t.trace, "observations": t._observations})
    obs = payload.observations[0]
    assert obs.type == "llm"
    assert obs.model == "gpt-4o"
    assert obs.tool_definitions == tools
    assert obs.model_params == {"temperature": 0.2, "top_p": 0.9,
                                "max_tokens": 256}
    assert obs.completion == "hi there"
    assert obs.input_tokens == 10
    assert obs.output_tokens == 5
    assert obs.status == "success"


def test_wrap_openai_normalizes_tool_calls_and_reasoning_content():
    tool_call = SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(name="get_weather",
                                 arguments='{"city": "北京"}'))
    response = _canned_response(content=None, tool_calls=[tool_call],
                                reasoning_content="thinking about weather...")
    ps_client = _mock_client()
    with ps_client.trace("run") as t:
        client = instrument_openai(FakeOpenAI(response=response), t)
        client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": "北京今天天气怎么样？"}],
        )

    obs = t._observations[0]
    assert obs["tool_calls"] == [
        {"id": "call_1", "name": "get_weather", "arguments": '{"city": "北京"}'}]
    assert obs["metadata"] == {"reasoning_content": "thinking about weather..."}


def test_wrap_openai_records_error_observation_and_reraises():
    ps_client = _mock_client()
    with ps_client.trace("run") as t:
        client = wrap_openai(FakeOpenAI(exc=RuntimeError("boom")), t)
        with pytest.raises(RuntimeError, match="boom"):
            client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": "hi"}])

    obs = t._observations[0]
    assert obs["status"] == "error"
    assert obs["error"] == "boom"
    assert obs["model"] == "gpt-4o"


def test_wrap_openai_stream_raises_not_implemented():
    ps_client = _mock_client()
    with ps_client.trace("run") as t:
        client = wrap_openai(FakeOpenAI(response=_canned_response()), t)
        with pytest.raises(NotImplementedError):
            client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": "hi"}],
                stream=True)
    # no observation recorded for the rejected streaming call
    assert t._observations == []
