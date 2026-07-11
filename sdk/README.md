# PromptScope Python SDK

用于向 PromptScope 上报 agent 运行 trace（LLM 调用、工具调用）的轻量 SDK。仅依赖 `httpx` 与标准库。

## 安装

当前未发布到 PyPI，以路径引用 / 复制文件的方式使用：

```python
import sys
sys.path.insert(0, "/path/to/promptscope/sdk")

from promptscope import PromptScopeClient
```

或者直接把 `sdk/promptscope/` 目录复制到你的项目中。

依赖：`pip install httpx`（backend 已包含该依赖）。

## 快速上手

```python
from promptscope import PromptScopeClient

client = PromptScopeClient(base_url="http://localhost:8000", api_key="ps-xxxx")

with client.trace("weather-agent-demo", input={"question": "北京今天天气怎么样？"}) as t:
    llm_id = t.llm(
        "plan",
        model="gpt-4o",
        messages=[{"role": "user", "content": "北京今天天气怎么样？"}],
        tool_definitions=[{"name": "get_weather",
                           "parameters": {"type": "object",
                                          "properties": {"city": {"type": "string"}}}}],
        tool_calls=[{"name": "get_weather", "arguments": {"city": "北京"}}],
        input_tokens=150,
        output_tokens=25,
    )
    t.tool(
        "get_weather",
        tool_input={"city": "北京"},
        tool_output={"weather": "晴", "temperature": 32},
        parent=llm_id,
    )
    t.llm(
        "answer",
        model="gpt-4o",
        messages=[{"role": "user", "content": "北京今天天气怎么样？"}],
        completion="北京今天晴，32°C。",
        input_tokens=220,
        output_tokens=35,
    )
    t.set_output({"answer": "北京今天晴，32°C。"})
```

`with` 代码块退出时会自动 flush（上报）整个 trace；若代码块内抛出异常，trace 的 `status` 会被标记为 `error`，flush 之后异常会被重新抛出。

也可以不用 context manager，显式调用 `client.flush(trace_context)`：

```python
t = client.trace("run")
t.tool("search", tool_input={"q": "hi"}, tool_output={"r": 1})
client.flush(t)   # 幂等：重复调用不会重复上报
```

## 字段说明

### `client.trace(name, input=None, metadata=None)`

| 参数 | 说明 |
|---|---|
| `name` | trace 名称 |
| `input` | trace 的输入（任意 JSON 可序列化值） |
| `metadata` | 附加元数据（dict） |

返回 `TraceContext`，可作为 context manager 使用。

### `TraceContext.llm(name, model, messages, *, ...)` -> 观测 id

| 参数 | 说明 |
|---|---|
| `name` | 观测名称 |
| `model` | 模型名（必填） |
| `messages` | 消息列表（必填） |
| `model_params` | 模型调用参数，如 `{"temperature": 0.2}` |
| `tool_definitions` | 可用工具定义列表 |
| `tool_calls` | 本次调用产生的工具调用列表 |
| `completion` | 模型输出内容 |
| `input_tokens` / `output_tokens` | token 用量 |
| `parent` | 父观测 id（用于构建调用树） |

`seq`（上报顺序）与 `started_at`/`ended_at`（调用时刻的 ISO 时间戳）由 SDK 自动填充。

### `TraceContext.tool(name, tool_input, tool_output=None, error=None, parent=None)` -> 观测 id

工具观测要求 `tool_input` 必填，且 `tool_output` 与 `error` 至少提供一个（与后端校验规则一致）。

### `TraceContext.span(name, *, input=None, output=None, metadata=None, status="success", error=None, parent_id=None)` -> 观测 id

通用观测节点，用于既非 `llm` 也非 `tool` 的逻辑步骤（例如检索步骤、子 agent 边界），主要用于构建调用树的分组结构。

由于后端 ingestion schema 没有为 `span` 单独定义 `input`/`output` 列（不像 `llm` 有 `messages`/`completion`、`tool` 有 `tool_input`/`tool_output`），SDK 会把传入的 `input`/`output` 折叠进 `metadata` 的同名 key 里，而不是静默丢弃：

```python
span_id = t.span("retrieve", input={"query": "北京天气"},
                 output={"doc_count": 3})
# 等价于 metadata == {"input": {...}, "output": {...}}
```

`status`/`error` 与 `tool()` 一致：显式传入 `error` 时状态会被强制为 `"error"`。

### `prompt_version_id`

`client.trace(name, ..., prompt_version_id=None)` 与 `TraceContext.llm(..., prompt_version_id=None)` 均支持关联到某个提示词版本（`prompts`/`prompt_version` 详见后端 `routers/prompts.py`），使该 trace / observation 能在提示词版本详情页的“使用此版本的 traces”里被检索到。

### `TraceContext.llm(...)` 的其余可选字段

`llm()` 还支持 `metadata`（附加元数据，DeepSeek 等 provider 返回的 `reasoning_content` 建议存这里）与 `error`（记录失败的 llm 调用，传入后状态自动置为 `"error"`）。

### `TraceContext.set_output(output)`

设置 trace 的最终输出。

## 关闭 client / 作为 context manager 使用

`PromptScopeClient` 内部持有一个 `httpx.Client` 连接池，用完后可以显式关闭：

```python
client = PromptScopeClient(base_url, api_key)
try:
    ...
finally:
    client.close()
```

或直接把 client 当 context manager 用：

```python
with PromptScopeClient(base_url, api_key) as client:
    with client.trace("run") as t:
        t.tool("search", tool_input={"q": "hi"}, tool_output={"r": 1})
    # client.close() 会在这里自动调用
```

**注意：关闭 client 与 flush trace 是两回事。** `client.close()` 只关闭底层 HTTP 连接池，不会替你 flush 尚未上报的 trace；务必确保所有 `TraceContext` 都已经通过 `with` 代码块退出或显式 `client.flush(...)` 完成上报，再调用 `close()`（否则后续的 flush 请求会因为 client 已关闭而失败）。

## 让 trace 可回放的必需字段

PromptScope 的回放引擎直接复用上报的 trace/observation 数据，以下字段缺失不会在上报时报错，但会让回放不可用或语义残缺：

- **llm 节点必须记录完整 `messages` 与 `tool_definitions`**：`messages` 是回放请求发给模型的初始上下文（单点回放时该节点录制的完整消息会原样发送，不做截断），`tool_definitions` 缺失会导致回放时模型收不到工具定义、无法产生工具调用，mock 工具链路整体失效。
- **tool 节点必须挂 `parent`（对应的 llm 观测 id）且记录 `tool_input`/`tool_output`**：回放按 `parent_id` 做工具录制的子树隔离（尤其是单点回放场景），不挂 `parent` 的 tool 观测不会被回放消费到；缺失 `tool_input`/`tool_output` 会让参数比对与结果 mock 都没有依据。

## 自动埋点（OpenAI 兼容客户端）

手动调用 `t.llm(...)` 上报时，很容易漏传 `tool_definitions`（工具描述）、漏算 `model_params`，或者在异常路径下干脆忘记上报。`promptscope.instrument` 提供一个无侵入的自动埋点方案：包一层 OpenAI（或任意 OpenAI 协议兼容客户端），之后每次 `chat.completions.create(...)` 调用都会自动追加一条 `llm` 观测到指定的 `TraceContext`，不需要手写任何上报代码。

```python
from openai import OpenAI
from promptscope import PromptScopeClient, instrument_openai

client = PromptScopeClient(base_url, api_key)

with client.trace("weather-agent-demo") as t:
    llm_client = instrument_openai(OpenAI(api_key="..."), t)
    resp = llm_client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "北京今天天气怎么样？"}],
        tools=[{"type": "function", "function": {
            "name": "get_weather", "description": "查询城市天气",
            "parameters": {"type": "object",
                           "properties": {"city": {"type": "string"}}}}}],
        temperature=0.2,
    )
    # 一条 llm 观测已自动追加到 t：model / messages / tool_definitions（工具描述原样保留）
    # / model_params（除 model/messages/tools/stream 之外的所有 kwargs，如 temperature）
    # / completion 与 tool_calls（从响应里解析）/ input_tokens 与 output_tokens（来自 usage）
    t.set_output({"answer": resp.choices[0].message.content})
```

`wrap_openai(client, trace_context)` 是同一实现的另一个名字，二选一都可以。

要点：

- **不硬依赖 `openai` 包**：`instrument.py` 模块顶层不 import `openai`，纯靠 duck-typing 包一层 `client.chat.completions.create` 属性，因此任何暴露同样接口形状的 OpenAI 协议兼容客户端（DeepSeek、vLLM 网关等）都能用。
- **工具描述始终被捕获**：`tools` kwarg 会原样写入观测的 `tool_definitions`，因为它就在请求 payload 里，不依赖调用方手动传。
- **`tool_calls` 归一化**：无论响应对象是 dict 还是属性对象（`message.tool_calls[i].function.name/arguments`），都会被归一化成 `{"id", "name", "arguments"}` 形状，与 SDK 其余地方使用的 `tool_calls` 形状一致。
- **DeepSeek 等 provider 的 `reasoning_content`**：若响应的 `message.reasoning_content` 存在，会被写入观测的 `metadata.reasoning_content`。
- **异常不会被吞掉**：真实调用抛出异常时，wrapper 会先记录一条 `status="error"` 的 llm 观测（`error` 为异常信息），然后原样重新抛出该异常。
- **诚实的限制：不支持流式**。传入 `stream=True` 会直接抛出 `NotImplementedError`，而不是悄悄上报一个空/不完整的 completion。如果你的场景必须用流式响应，请在自己消费完整个 stream 之后手动调用 `t.llm(...)` 上报。

## 鉴权与错误处理

- 上报请求携带 `Authorization: Bearer <api_key>`。
- 后端返回非 2xx 时，SDK 抛出 `PromptScopeError`，其信息为后端响应中的 `detail` 文本。
