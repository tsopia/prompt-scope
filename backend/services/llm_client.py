import httpx

from models.entities import ModelProvider

ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_TIMEOUT = 120.0
DEFAULT_MAX_TOKENS = 4096


class LLMClientError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _openai_call(client: httpx.Client, provider: ModelProvider, model: str,
                 messages: list, model_params: dict | None) -> dict:
    resp = client.post(
        f"{provider.base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {provider.api_key}"},
        json={"model": model, "messages": messages, **(model_params or {})},
        timeout=DEFAULT_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    usage = data.get("usage") or {}
    return {
        "content": data["choices"][0]["message"]["content"],
        "input_tokens": usage.get("prompt_tokens"),
        "output_tokens": usage.get("completion_tokens"),
    }


def _anthropic_call(client: httpx.Client, provider: ModelProvider, model: str,
                    messages: list, model_params: dict | None) -> dict:
    params = dict(model_params or {})
    max_tokens = params.pop("max_tokens", DEFAULT_MAX_TOKENS)
    base = provider.base_url.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    resp = client.post(
        f"{base}/v1/messages",
        headers={"x-api-key": provider.api_key,
                 "anthropic-version": ANTHROPIC_VERSION},
        json={"model": model, "max_tokens": max_tokens,
              "messages": messages, **params},
        timeout=DEFAULT_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    usage = data.get("usage") or {}
    return {
        "content": "".join(b["text"] for b in data["content"]
                           if b.get("type") == "text"),
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
    }


def chat_completion(provider: ModelProvider, model: str, messages: list,
                    model_params: dict | None = None,
                    client: httpx.Client | None = None) -> dict:
    own_client = client is None
    client = client or httpx.Client()
    try:
        if provider.provider_type == "anthropic":
            return _anthropic_call(client, provider, model, messages, model_params)
        return _openai_call(client, provider, model, messages, model_params)
    except httpx.HTTPStatusError as e:
        raise LLMClientError(
            f"provider returned {e.response.status_code}: {e.response.text[:500]}",
            status_code=e.response.status_code) from e
    except httpx.HTTPError as e:
        raise LLMClientError(f"provider request failed: {e}") from e
    finally:
        if own_client:
            client.close()
