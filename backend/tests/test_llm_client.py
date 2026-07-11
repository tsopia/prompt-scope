import httpx
import pytest

from models.entities import ModelProvider
from services.llm_client import LLMClientError, chat_completion


def make_client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def openai_provider():
    return ModelProvider(name="oai", base_url="https://api.test.com/v1",
                         api_key="sk-test", provider_type="openai")


def test_openai_compatible_success():
    def handler(request):
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer sk-test"
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "hello"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5}})

    out = chat_completion(openai_provider(), "gpt-4o",
                          [{"role": "user", "content": "hi"}],
                          client=make_client(handler))
    assert out == {"content": "hello", "tool_calls": None, "raw_message": {"content": "hello"},
                   "reasoning_content": None,
                   "input_tokens": 10, "output_tokens": 5}


def test_anthropic_success():
    provider = ModelProvider(name="ant", base_url="https://api.anthropic.test",
                             api_key="ak-test", provider_type="anthropic")

    def handler(request):
        assert request.url.path == "/v1/messages"
        assert request.headers["x-api-key"] == "ak-test"
        return httpx.Response(200, json={
            "content": [{"type": "text", "text": "hey"}],
            "usage": {"input_tokens": 8, "output_tokens": 3}})

    out = chat_completion(provider, "claude-x",
                          [{"role": "user", "content": "hi"}],
                          client=make_client(handler))
    assert out == {"content": "hey", "tool_calls": None, "raw_message": None,
                   "reasoning_content": None,
                   "input_tokens": 8, "output_tokens": 3}


def test_anthropic_base_url_with_v1_suffix_not_doubled():
    provider = ModelProvider(name="ant", base_url="https://api.anthropic.test/v1",
                             api_key="ak-test", provider_type="anthropic")

    def handler(request):
        assert request.url.path == "/v1/messages"
        return httpx.Response(200, json={
            "content": [{"type": "text", "text": "hey"}],
            "usage": {"input_tokens": 8, "output_tokens": 3}})

    out = chat_completion(provider, "claude-x",
                          [{"role": "user", "content": "hi"}],
                          client=make_client(handler))
    assert out == {"content": "hey", "tool_calls": None, "raw_message": None,
                   "reasoning_content": None,
                   "input_tokens": 8, "output_tokens": 3}


def test_model_params_passed_through():
    seen = {}

    def handler(request):
        import json
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "x"}}], "usage": {}})

    chat_completion(openai_provider(), "gpt-4o", [{"role": "user", "content": "hi"}],
                    model_params={"temperature": 0.3}, client=make_client(handler))
    assert seen["temperature"] == 0.3
    assert seen["model"] == "gpt-4o"


def test_http_error_raises_llm_client_error():
    def handler(request):
        return httpx.Response(429, json={"error": "rate limited"})

    with pytest.raises(LLMClientError) as exc:
        chat_completion(openai_provider(), "gpt-4o",
                        [{"role": "user", "content": "hi"}],
                        client=make_client(handler))
    assert exc.value.status_code == 429


def test_network_error_raises_llm_client_error():
    def handler(request):
        raise httpx.ConnectError("boom")

    with pytest.raises(LLMClientError):
        chat_completion(openai_provider(), "gpt-4o",
                        [{"role": "user", "content": "hi"}],
                        client=make_client(handler))


def test_openai_tools_passed_and_tool_calls_normalized():
    seen = {}

    def handler(request):
        import json as _json
        seen.update(_json.loads(request.content))
        return httpx.Response(200, json={
            "choices": [{"message": {
                "role": "assistant", "content": None,
                "tool_calls": [{"id": "call_1", "type": "function",
                                "function": {"name": "get_weather",
                                             "arguments": "{\"city\": \"北京\"}"}}]}}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 10}})

    tools = [{"type": "function", "function": {"name": "get_weather", "parameters": {}}}]
    out = chat_completion(openai_provider(), "gpt-4o",
                          [{"role": "user", "content": "天气"}],
                          tools=tools, client=make_client(handler))
    assert seen["tools"] == tools
    assert out["tool_calls"] == [{"id": "call_1", "name": "get_weather",
                                  "arguments": {"city": "北京"}}]
    assert out["raw_message"]["tool_calls"][0]["id"] == "call_1"
    assert out["content"] is None


def test_openai_unparseable_tool_arguments_kept_raw():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {
                "role": "assistant", "content": None,
                "tool_calls": [{"id": "c1", "type": "function",
                                "function": {"name": "t", "arguments": "not-json"}}]}}],
            "usage": {}})

    out = chat_completion(openai_provider(), "gpt-4o",
                          [{"role": "user", "content": "x"}],
                          tools=[{"type": "function", "function": {"name": "t"}}],
                          client=make_client(handler))
    assert out["tool_calls"][0]["arguments"] == "not-json"


def test_no_tools_response_has_none_tool_calls():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"role": "assistant", "content": "hi"}}],
            "usage": {}})

    out = chat_completion(openai_provider(), "gpt-4o",
                          [{"role": "user", "content": "x"}],
                          client=make_client(handler))
    assert out["tool_calls"] is None
    assert out["content"] == "hi"


def test_anthropic_with_tools_rejected():
    provider = ModelProvider(name="ant2", base_url="https://api.anthropic.test",
                             api_key="ak", provider_type="anthropic")
    with pytest.raises(LLMClientError, match="暂不支持工具回放"):
        chat_completion(provider, "claude-x", [{"role": "user", "content": "x"}],
                        tools=[{"type": "function", "function": {"name": "t"}}],
                        client=make_client(lambda r: httpx.Response(200, json={})))


def test_thinking_param_passthrough_and_reasoning_extraction():
    """DeepSeek 思考模式契约：model_params 里的 thinking 原样进 payload；
    响应中的 reasoning_content 被单独暴露，且 raw_message 完整保留（多轮回传需要）。"""
    seen = {}

    def handler(request):
        import json as _json
        body = _json.loads(request.content)
        seen.update(body)
        return httpx.Response(200, json={
            "choices": [{"message": {
                "content": "答案是2",
                "reasoning_content": "用户问1+1，显然等于2。",
            }}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 70,
                      "completion_tokens_details": {"reasoning_tokens": 63}}})

    out = chat_completion(openai_provider(), "deepseek-v4-flash",
                          [{"role": "user", "content": "1+1=?"}],
                          model_params={"thinking": {"type": "enabled"}},
                          client=make_client(handler))
    assert seen["thinking"] == {"type": "enabled"}
    assert out["reasoning_content"] == "用户问1+1，显然等于2。"
    assert out["raw_message"]["reasoning_content"] == "用户问1+1，显然等于2。"
    assert out["content"] == "答案是2"


def test_thinking_disabled_no_reasoning():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "2"}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 1}})

    out = chat_completion(openai_provider(), "deepseek-v4-flash",
                          [{"role": "user", "content": "1+1=?"}],
                          model_params={"thinking": {"type": "disabled"}},
                          client=make_client(handler))
    assert out["reasoning_content"] is None
