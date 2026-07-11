import json
import httpx

from models.entities import ModelProvider

ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_TIMEOUT = 120.0
DEFAULT_MAX_TOKENS = 4096


class LLMClientError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _normalize_tool_calls(message: dict) -> list | None:
    raw = message.get("tool_calls")
    if not raw:
        return None
    normalized = []
    for tc in raw:
        fn = tc.get("function") or {}
        args = fn.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except (ValueError, TypeError):
                pass  # 保留原始字符串
        normalized.append({"id": tc.get("id"), "name": fn.get("name"),
                           "arguments": args})
    return normalized


def _openai_call(client: httpx.Client, provider: ModelProvider, model: str,
                 messages: list, model_params: dict | None, tools: list | None) -> dict:
    payload = {"model": model, "messages": messages, **(model_params or {})}
    if tools:
        payload["tools"] = tools
    resp = client.post(
        f"{provider.base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {provider.api_key}"},
        json=payload,
        timeout=DEFAULT_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    message = data["choices"][0]["message"]
    usage = data.get("usage") or {}
    return {
        "content": message.get("content"),
        "tool_calls": _normalize_tool_calls(message),
        "raw_message": message,
        # DeepSeek 等思考模型的推理过程；raw_message 已含此字段，多轮工具调用时
        # 必须原样回传（缺失会被 provider 400），单独暴露仅用于落库展示。
        "reasoning_content": message.get("reasoning_content"),
        "input_tokens": usage.get("prompt_tokens"),
        "output_tokens": usage.get("completion_tokens"),
    }


def _anthropic_call(client: httpx.Client, provider: ModelProvider, model: str,
                    messages: list, model_params: dict | None, tools: list | None) -> dict:
    if tools:
        raise LLMClientError("anthropic provider 暂不支持工具回放（Phase 4 计划）")
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
        "tool_calls": None,
        "raw_message": None,
        "reasoning_content": None,
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
    }


def chat_completion(provider: ModelProvider, model: str, messages: list,
                    model_params: dict | None = None, tools: list | None = None,
                    client: httpx.Client | None = None) -> dict:
    own_client = client is None
    client = client or httpx.Client()
    try:
        if provider.provider_type == "anthropic":
            return _anthropic_call(client, provider, model, messages, model_params, tools)
        return _openai_call(client, provider, model, messages, model_params, tools)
    except httpx.HTTPStatusError as e:
        raise LLMClientError(
            f"provider returned {e.response.status_code}: {e.response.text[:500]}",
            status_code=e.response.status_code) from e
    except httpx.HTTPError as e:
        raise LLMClientError(f"provider request failed: {e}") from e
    finally:
        if own_client:
            client.close()
