# PromptScope eino callbacks handler

把 [cloudwego/eino](https://github.com/cloudwego/eino) 的 ChatModel / Tool 调用自动上报到 PromptScope，无需在业务代码里手写 `tc.LLM(...)` / `tc.Tool(...)`。

## 一行接入

```go
tc := client.Trace("my-agent-run")
defer tc.End(&err)

runnable, _ := chain.Compile(ctx)
out, err := runnable.Invoke(ctx, input, compose.WithCallbacks(eino.NewHandler(tc)))
```

`eino.NewHandler(tc)` 返回一个 `callbacks.Handler`，可以传给 `compose.WithCallbacks(...)`（单次调用生效）或 `callbacks.AppendGlobalHandlers(...)`（进程级全局生效，需在任何 graph 执行之前调用一次，且非并发安全，只应在 `main`/`init` 里调用一次）。

完整可运行示例见 [`example/eino_agent/main.go`](example/eino_agent/main.go)：一个 stub ChatModel（先产出 tool call，工具执行完再给出最终回答）+ 一个用 `utils.InferTool` 构造的真实 `tool.InvokableTool`，跑两个小的 `compose.Chain`。

```bash
export PROMPTSCOPE_BASE_URL=http://localhost:8000
export PROMPTSCOPE_API_KEY=ps-xxxx
go run ./example/eino_agent
```

安装：`go get github.com/tsopia/prompt-scope/sdk-go/eino@latest`

依赖：`github.com/cloudwego/eino` + 核心 SDK `github.com/tsopia/prompt-scope/sdk-go`（本目录是独立的 Go module；仓库内开发时 `go.mod` 通过 `replace` 指向 `../`，消费者侧按 require 的发布版本解析）。

## 映射规则

- **ChatModel** -> `llm` 观测：`name` 取 `RunInfo.Name`，为空时回退 `RunInfo.Type`；`model` 取 `model.CallbackInput.Config.Model`，为空时同样回退 `RunInfo.Type`。`messages`/`tool_definitions` 来自 `OnStart` 阶段的 `model.CallbackInput`（`ToolInfo` 通过 `ParamsOneOf.ToJSONSchema()` 展开成 `{name, description, parameters}`，`parameters` 为 `nil` 时省略该 key）；`completion`/`tool_calls`/`input_tokens`/`output_tokens` 来自 `OnEnd` 阶段的 `model.CallbackOutput`。
- **Tool** -> `tool` 观测：`tool_input` 是 `ArgumentsInJSON` 的 best-effort JSON 解码结果（解析失败或解出 JSON `null` 时回退为原始字符串，保证 `tool_input` 永远非 `nil`，满足后端 `tool_input` 必填的校验）；`tool_output` 优先取 `CallbackOutput.ToolOutput`（`*schema.ToolResult`，经 JSON 往返转换为 map），否则取 `CallbackOutput.Response`。
- **OnError**：ChatModel/Tool 的 `OnError` 都会上报一条 `status=error` 的观测（`ObsError(err.Error())`），字段规则同上（`messages`/`tool_input` 仍然基于 `OnStart` 阶段暂存的输入）。
- **顺序是平的（flat）**：本 handler 不会尝试把 eino 的 graph 结构（node 之间的父子关系）映射成 PromptScope 的观测树 —— 每条观测都是 trace 的直接子节点，不带 `Parent(...)`。重建 graph 嵌套结构是未来事项。

## 已知限制（诚实清单）

- **Streaming 只留元数据，不聚合内容**：`OnEndWithStreamOutput`（ChatModel 和 Tool 都有）按 eino 文档要求的语义立即 `Close()` 自己拿到的 stream 拷贝，不读取/合并 chunk（把一串 chunk 拼回完整 assistant message 或 tool 输出超出本 handler 的范围）。上报的观测只带 `metadata.stream = true`，ChatModel 侧没有 `completion`/`tokens`，Tool 侧 `tool_output` 是空字符串（`""`，而非 `nil`，用于满足后端 "tool_output 或 error 必须有一个非空" 的校验）。
- **`model` 字段依赖组件是否自带 callback 注入**：如果 ChatModel 组件没有实现 `components.Checker`（大多数手写的 stub/mock 模型都是这种情况），eino 的 graph 会用原始的 `[]*schema.Message` / `*schema.Message` 自动包装成 `model.CallbackInput`/`model.CallbackOutput`，此时 `Config` 字段是 `nil`，`model` 会回退到 `RunInfo.Type`（组件的 Go 类型名，例如 `"stubChatModel"`），而不是真实的模型名。真实的 eino-ext 模型实现（OpenAI/Anthropic 等）通常自己管理 callback 注入并会正确填充 `Config.Model`。
- **没有把 eino 的 graph/node 结构映射成 PromptScope 的观测树**：见上方"顺序是平的"。当前所有观测都是一层平铺，不带 `parent_id`。如果需要还原多 step/多分支 agent 的调用树，需要调用方自己在应用层用 `Parent(...)`（core SDK 提供的选项）挂接，或者等待未来版本支持。
- **没有对 `RunInfo`/`CallbackInput`/`CallbackOutput` 做任何 nil 之外的防御性校验**：和 core Go/Python SDK 的哲学一致 —— 本 handler 不做客户端校验，只是尽力把能拿到的字段映射过去，由后端 `IngestRequest`（`backend/schemas/ingest.py`）校验并在有问题时返回 422。
- **`duration_ms` 而非真实的 `started_at`/`ended_at`**：core SDK 的 `tc.LLM`/`tc.Tool` 在被调用的那一刻内部生成 `started_at`/`ended_at`（都约等于"现在"），没有暴露"传入自定义起止时间"的选项 —— 而本 handler 只能在 `OnEnd`/`OnError`（也就是组件调用结束之后）才调用 `tc.LLM`/`tc.Tool`。所以观测上的 `started_at`/`ended_at` 反映的是"上报时刻"而不是"组件真实执行区间"；`OnStart` 阶段记录的真实起始时间改为放进 `metadata.duration_ms`（`OnEnd`/`OnError` 时刻减去 `OnStart` 时刻的毫秒数），供需要真实耗时的场景使用。
