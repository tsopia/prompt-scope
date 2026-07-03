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
    assert out == {"content": "hello", "input_tokens": 10, "output_tokens": 5}


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
    assert out == {"content": "hey", "input_tokens": 8, "output_tokens": 3}


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
