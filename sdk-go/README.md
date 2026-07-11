# PromptScope Go SDK

轻量的 Go SDK，用于向 PromptScope 上报 agent 运行 trace（LLM 调用、工具调用、span）。仅依赖标准库。

镜像 `sdk/`（Python SDK）的语义：客户端生成 32 位十六进制 id、`seq` 自动递增、ISO-8601 UTC 时间戳、成功正常退出上报 `success`、失败上报 `error`、flush 幂等、flush 失败绝不掩盖原始错误。

## 安装

当前未发布到独立仓库（`go.mod` 中的 module path `github.com/promptscope/sdk-go` 是占位符，等 SDK 拆分为独立开源仓库后会迁移，见下方“未来事项”）。以路径引用的方式在本仓库内使用：

```go
import "github.com/promptscope/sdk-go"
```

或配合 `go.mod` 的 `replace` 指令指向本地路径。

依赖：Go 标准库，无第三方依赖。

## 快速上手

```go
package main

import (
	"fmt"
	"os"

	"github.com/promptscope/sdk-go"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() (err error) {
	client := promptscope.New("http://localhost:8000", "ps-xxxx")

	tc := client.Trace("weather-agent-demo",
		promptscope.TraceInput(map[string]any{"question": "北京今天天气怎么样？"}),
	)
	defer tc.End(&err) // 正常返回 -> status=success；err非nil或panic -> status=error

	planID := tc.LLM("plan", "gpt-4o",
		[]map[string]any{{"role": "user", "content": "北京今天天气怎么样？"}},
		promptscope.ToolDefinitions([]map[string]any{
			{"name": "get_weather", "description": "查询天气", "parameters": map[string]any{
				"type":       "object",
				"properties": map[string]any{"city": map[string]any{"type": "string"}},
			}},
		}),
		promptscope.ToolCalls([]map[string]any{
			{"name": "get_weather", "arguments": map[string]any{"city": "北京"}},
		}),
		promptscope.Tokens(150, 25),
	)

	tc.Tool("get_weather",
		map[string]any{"city": "北京"},
		map[string]any{"weather": "晴", "temperature": 32},
		promptscope.Parent(planID), // 挂到 plan 这次 llm 调用下面
	)

	tc.LLM("answer", "gpt-4o",
		[]map[string]any{{"role": "user", "content": "北京今天天气怎么样？"}},
		promptscope.Completion("北京今天晴，32°C。"),
		promptscope.Tokens(220, 35),
	)

	tc.SetOutput(map[string]any{"answer": "北京今天晴，32°C。"})
	return nil
}
```

完整可运行示例见 [`example/report_agent_run/main.go`](example/report_agent_run/main.go)：

```bash
export PROMPTSCOPE_BASE_URL=http://localhost:8000
export PROMPTSCOPE_API_KEY=ps-xxxx
go run ./example/report_agent_run
```

也可以不用 `defer tc.End(&err)`，显式调用 `tc.Flush()`（幂等，重复调用是 no-op）：

```go
tc := client.Trace("run")
tc.Tool("search", map[string]any{"q": "hi"}, map[string]any{"r": 1})
if err := tc.Flush(); err != nil {
	// ...
}
```

注意：显式调用 `Flush()` 而不经过 `End()` 时，trace 的 `status` 保持构造时的默认值 `"success"`，且 `ended_at` 不会被设置（与 Python SDK 直接调用 `client.flush(trace_context)` 时的行为一致）。

## API 一览

- `promptscope.New(baseURL, apiKey string, opts ...Option) *Client` — `WithHTTPClient(*http.Client)` 可自定义超时/transport（测试中常用于指向 `httptest.Server`）。
- `client.Trace(name string, opts ...TraceOption) *TraceContext` — `TraceInput(any)` / `TraceMetadata(map[string]any)` / `TracePromptVersion(id string)`。
- `tc.LLM(name, model string, messages []map[string]any, opts ...ObsOption) string` — 返回观测 id。
- `tc.Tool(name string, input, output any, opts ...ObsOption) string` — 返回观测 id。
- `tc.Span(name string, opts ...ObsOption) string` — 返回观测 id。
- `ObsOption`：`ModelParams(map[string]any)` / `ToolDefinitions([]map[string]any)` / `ToolCalls([]map[string]any)` / `Completion(any)` / `Tokens(in, out int)` / `ObsMetadata(map[string]any)` / `PromptVersion(id string)` / `ObsError(msg string)`（同时把 `status` 置为 `"error"`）/ `Parent(id string)`（挂接父观测，构建调用树，对应 Python SDK 的 `parent=` 参数）。
- `tc.SetOutput(any)` — 设置 trace 的最终输出。
- `tc.TraceID() string` — 读取本次 trace 的客户端生成 id。
- `tc.Flush() error` — 幂等；非 2xx 响应返回 `*promptscope.PromptScopeError`（`StatusCode` + `Detail`）。
- `tc.End(errPtr *error)` — 配合 `defer tc.End(&err)` 使用：
  - `*errPtr == nil` 且未 panic：`status = "success"`，flush；flush 失败时**会**写回 `*errPtr`（success 路径上没有别的地方可以"保留"这个失败，等价于 Python SDK 里"flush 失败在正常退出路径上正常传播"）。
  - `*errPtr != nil`：`status = "error"`，flush；flush 失败只打印到 stderr，**绝不**覆盖 `*errPtr`——调用方原始的业务错误永远优先。
  - 发生 panic：`status = "error"`，flush（失败只打印到 stderr），然后重新 `panic`，原始 panic 值不变。

SDK **不做任何客户端校验**（与 Python SDK 一致）：例如 `llm` 观测缺 `model`/`messages`、`tool` 观测缺 `tool_input` 等，SDK 会原样发送，由后端 `IngestRequest`（`backend/schemas/ingest.py`）校验并返回 422 —— 这是有意为之，避免 SDK 与后端 schema 产生行为分叉。

## 与 Python SDK（`sdk/`）的对应关系

| 语义 | Python SDK | Go SDK |
|---|---|---|
| 创建客户端 | `PromptScopeClient(base_url, api_key)` | `promptscope.New(baseURL, apiKey, opts...)` |
| 开始一个 trace | `client.trace(name, input=, metadata=)` | `client.Trace(name, opts...)` |
| trace 输入/元数据 | 构造函数关键字参数 | `TraceInput(...)` / `TraceMetadata(...)` 选项 |
| llm 观测 | `t.llm(name, model, messages, **kwargs)` | `tc.LLM(name, model, messages, opts...)` |
| tool 观测 | `t.tool(name, tool_input, tool_output=, error=, parent=)` | `tc.Tool(name, input, output, opts...)`，`error` 走 `ObsError(...)` 选项 |
| span 观测 | 无（Python SDK 目前未提供 span 便捷方法） | `tc.Span(name, opts...)` |
| 父子挂接 | `parent=` 关键字参数 | `Parent(id)` 选项 |
| 设置最终输出 | `t.set_output(output)` | `tc.SetOutput(output)` |
| 上报 | `with client.trace(...) as t: ...`（`__exit__` 自动 flush） | `defer tc.End(&err)` |
| 幂等上报 | `client.flush(t)`，`_flushed` 守卫 | `tc.Flush()`，内部 `flushed` 守卫（加锁） |
| 错误路径不掩盖原始异常 | `__exit__` 里 flush 失败只打印 stderr，重新抛出原始异常 | `End()` 里 `*errPtr != nil` 分支，flush 失败只打印 stderr，不覆盖 `*errPtr` |
| id 生成 | `uuid.uuid4().hex` | 16 字节 `crypto/rand`，十六进制编码（同为 32 字符十六进制） |
| 时间戳 | `datetime.now(timezone.utc).isoformat()`（`+00:00` 后缀） | `time.Now().UTC().Format(time.RFC3339Nano)`（`Z` 后缀；两种格式 Pydantic 均可解析） |
| 鉴权 | `Authorization: Bearer <api_key>` | 同左 |
| 错误类型 | `PromptScopeError`（`detail` 文本） | `*promptscope.PromptScopeError`（`StatusCode` + `Detail`） |
| 客户端校验 | 无（由后端 schema 校验） | 无（同左） |

## 尚未实现 / 已知差距（诚实清单）

- **无重试/超时默认值**：与 Python SDK 一样，网络失败直接返回错误；如需重试或超时策略，通过 `WithHTTPClient` 传入自定义配置的 `*http.Client`。
- **无批量/异步上报**：每个 `Flush`/`End` 调用是一次同步 HTTP POST，没有后台队列或批处理。
- **无 context.Context 支持**：`Flush`/`End` 不接受 `context.Context`，无法从调用方传入取消/超时（Python SDK 同样没有）。
- **模块路径是占位符**：`go.mod` 的 `github.com/promptscope/sdk-go` 会在 SDK 拆分为独立开源仓库时变更，届时现有 import path 需要迁移。
- **无 replay 相关辅助方法**：只覆盖上报（ingest）路径；查询/回放 API 目前没有 Go 客户端封装。
- **`Span` 是 Go SDK 独有的便捷方法**：Python SDK 目前没有对应的 `span(...)` 方法（span 观测目前只能通过直接构造字典上报）；两侧最终发送的 JSON 形状一致。

## eino 集成

需要自动上报 [cloudwego/eino](https://github.com/cloudwego/eino) 的 ChatModel/Tool 调用？见 [`eino/README.md`](eino/README.md)。
