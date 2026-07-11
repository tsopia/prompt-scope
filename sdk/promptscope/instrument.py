"""OpenAI auto-instrumentation: wraps an OpenAI-compatible client so every
`chat.completions.create(...)` call is automatically recorded as an `llm`
observation on a `TraceContext`, with no manual reporting from agent code.

This is what guarantees tool *descriptions* are always captured: they live
in the `tools` kwarg of the request payload, which manual `t.llm(...)`
reporting could easily forget to pass, but the wrapper never does.

Duck-typed on purpose: this module does NOT import the `openai` package,
so it has no hard dependency on it. It works with any client object that
exposes `.chat.completions.create(**kwargs)` — the real OpenAI SDK client,
or any OpenAI-compatible client (DeepSeek, vLLM, etc.).

Usage:
    from promptscope.instrument import instrument_openai

    client = instrument_openai(OpenAI(api_key=...), trace_context)
    resp = client.chat.completions.create(model="gpt-4o", messages=[...])
    # an `llm` observation has already been appended to trace_context

Limitations:
    - Streaming (`stream=True`) is not supported: the wrapper raises
      `NotImplementedError` up front rather than silently under-reporting
      a partial/empty completion. Report streamed calls manually via
      `trace_context.llm(...)` once the stream is fully consumed.
"""
from __future__ import annotations

from typing import Any

# kwargs of chat.completions.create(...) that are handled explicitly and
# must NOT be echoed back into model_params.
_NON_MODEL_PARAM_KWARGS = {"model", "messages", "tools", "stream"}


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """Duck-typed field access: works for plain dicts and for
    attribute-style objects (SDK response objects, SimpleNamespace, ...)."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _normalize_tool_calls(tool_calls: Any) -> list | None:
    """Normalize OpenAI-shaped tool_calls (`[{id, function: {name,
    arguments}}]` or the attribute-style equivalent) into the ingest
    shape used elsewhere in the SDK: `{"id", "name", "arguments"}`."""
    if not tool_calls:
        return None
    normalized = []
    for tc in tool_calls:
        fn = _get(tc, "function")
        normalized.append({
            "id": _get(tc, "id"),
            "name": _get(fn, "name"),
            "arguments": _get(fn, "arguments"),
        })
    return normalized


def _extract_message(response: Any) -> tuple[Any, list | None, dict | None]:
    """Returns (completion, tool_calls, metadata) from a chat completion
    response, handling both message.content and message.tool_calls, plus
    a provider-specific `reasoning_content` (DeepSeek) if present."""
    choices = _get(response, "choices")
    if not choices:
        return None, None, None
    message = _get(choices[0], "message")
    if message is None:
        return None, None, None
    completion = _get(message, "content")
    tool_calls = _normalize_tool_calls(_get(message, "tool_calls"))
    reasoning_content = _get(message, "reasoning_content")
    metadata = {"reasoning_content": reasoning_content} if reasoning_content else None
    return completion, tool_calls, metadata


def _extract_usage(response: Any) -> tuple[int | None, int | None]:
    usage = _get(response, "usage")
    return _get(usage, "prompt_tokens"), _get(usage, "completion_tokens")


def wrap_openai(client: Any, trace_context: "TraceContext") -> Any:  # noqa: F821
    """Patch `client.chat.completions.create` in place so every call is
    auto-reported as an `llm` observation on `trace_context`. Mutates and
    returns the same client object, so it can be used as:

        client = wrap_openai(OpenAI(), trace_context)

    Never swallows the underlying call's exception: on failure it still
    records an error-status `llm` observation, then re-raises.
    """
    original_create = client.chat.completions.create

    def patched_create(*args: Any, **kwargs: Any) -> Any:
        if kwargs.get("stream"):
            raise NotImplementedError(
                "promptscope.instrument.wrap_openai: streaming "
                "chat.completions.create(stream=True) calls are not "
                "supported for auto-instrumentation. Call without "
                "stream=True, or report the observation manually via "
                "trace_context.llm(...) once you've consumed the stream."
            )

        model = kwargs.get("model")
        messages = kwargs.get("messages")
        tools = kwargs.get("tools")
        model_params = {k: v for k, v in kwargs.items()
                        if k not in _NON_MODEL_PARAM_KWARGS} or None

        try:
            response = original_create(*args, **kwargs)
        except Exception as exc:
            trace_context.llm(
                "chat.completions.create",
                model=model,
                messages=messages,
                tool_definitions=tools,
                model_params=model_params,
                error=str(exc),
            )
            raise

        completion, tool_calls, metadata = _extract_message(response)
        input_tokens, output_tokens = _extract_usage(response)
        trace_context.llm(
            "chat.completions.create",
            model=model,
            messages=messages,
            tool_definitions=tools,
            model_params=model_params,
            tool_calls=tool_calls,
            completion=completion,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            metadata=metadata,
        )
        return response

    client.chat.completions.create = patched_create
    return client


# Alternate name mirroring the two spellings used across our docs/plans.
instrument_openai = wrap_openai
