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

### `TraceContext.set_output(output)`

设置 trace 的最终输出。

## 让 trace 可回放的必需字段

PromptScope 的回放引擎直接复用上报的 trace/observation 数据，以下字段缺失不会在上报时报错，但会让回放不可用或语义残缺：

- **llm 节点必须记录完整 `messages` 与 `tool_definitions`**：`messages` 是回放请求发给模型的初始上下文（单点回放时该节点录制的完整消息会原样发送，不做截断），`tool_definitions` 缺失会导致回放时模型收不到工具定义、无法产生工具调用，mock 工具链路整体失效。
- **tool 节点必须挂 `parent`（对应的 llm 观测 id）且记录 `tool_input`/`tool_output`**：回放按 `parent_id` 做工具录制的子树隔离（尤其是单点回放场景），不挂 `parent` 的 tool 观测不会被回放消费到；缺失 `tool_input`/`tool_output` 会让参数比对与结果 mock 都没有依据。

## 鉴权与错误处理

- 上报请求携带 `Authorization: Bearer <api_key>`。
- 后端返回非 2xx 时，SDK 抛出 `PromptScopeError`，其信息为后端响应中的 `detail` 文本。
