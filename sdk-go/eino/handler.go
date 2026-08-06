// Package eino wires the PromptScope Go SDK (github.com/tsopia/prompt-scope/sdk-go)
// into cloudwego/eino's callbacks system, so that ChatModel and Tool
// invocations inside an eino graph/chain are automatically reported to
// PromptScope as llm/tool observations -- no manual tc.LLM/tc.Tool calls
// needed in application code.
//
// Usage:
//
//	tc := client.Trace("my-agent-run")
//	defer tc.End(&err)
//
//	runnable, _ := chain.Compile(ctx)
//	out, err := runnable.Invoke(ctx, input, compose.WithCallbacks(eino.NewHandler(tc)))
//
// See README.md in this directory for known limitations (streaming, graph
// nesting).
package eino

import (
	"context"
	"encoding/json"
	"time"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
	einoutils "github.com/cloudwego/eino/utils/callbacks"

	promptscope "github.com/tsopia/prompt-scope/sdk-go"
)

// NewHandler builds a callbacks.Handler that reports ChatModel and Tool
// component invocations to tc as llm/tool observations respectively.
//
// The handler is flat: it does not attempt to mirror eino's graph structure
// (parent/child node relationships) into PromptScope's observation tree --
// every observation is reported as a direct child of the trace with no
// Parent(...) set. Reconstructing graph nesting is future work; see
// README.md.
func NewHandler(tc *promptscope.TraceContext) callbacks.Handler {
	return einoutils.NewHandlerHelper().
		ChatModel(chatModelHandler(tc)).
		Tool(toolHandler(tc)).
		Handler()
}

// --- ChatModel -------------------------------------------------------------

// chatModelStateKey is the context key chatModelHandler uses to pass state
// from OnStart to OnEnd/OnError/OnEndWithStreamOutput. Using an unexported
// struct type (rather than a string) avoids collisions with context keys set
// by other packages. Because context.Value reads are immutable snapshots,
// stashing state this way is safe for concurrent/parallel graph branches --
// each branch gets its own ctx with its own *chatModelState.
type chatModelStateKey struct{}

type chatModelState struct {
	start time.Time
	input *model.CallbackInput
}

func chatModelHandler(tc *promptscope.TraceContext) *einoutils.ModelCallbackHandler {
	return &einoutils.ModelCallbackHandler{
		OnStart: func(ctx context.Context, info *callbacks.RunInfo, input *model.CallbackInput) context.Context {
			return context.WithValue(ctx, chatModelStateKey{}, &chatModelState{
				start: time.Now(),
				input: input,
			})
		},
		OnEnd: func(ctx context.Context, info *callbacks.RunInfo, output *model.CallbackOutput) context.Context {
			st, _ := ctx.Value(chatModelStateKey{}).(*chatModelState)
			recordLLM(tc, info, st, output, "")
			return ctx
		},
		OnError: func(ctx context.Context, info *callbacks.RunInfo, err error) context.Context {
			st, _ := ctx.Value(chatModelStateKey{}).(*chatModelState)
			recordLLM(tc, info, st, nil, err.Error())
			return ctx
		},
		// OnEndWithStreamOutput fires for streaming ChatModel calls
		// (Stream/Transform paradigms). Eino requires every handler to
		// close its own copy of the stream (see callbacks.Handler doc) --
		// we do so immediately without draining/merging the chunks, since
		// reconstructing a full assistant message from a chunk stream is
		// out of scope for this handler. This means streaming chat model
		// calls are reported with the request side only (name/model/
		// messages/tool_definitions) plus metadata.stream=true, but no
		// completion/tokens. See README.md "Limitations".
		OnEndWithStreamOutput: func(ctx context.Context, info *callbacks.RunInfo, output *schema.StreamReader[*model.CallbackOutput]) context.Context {
			defer output.Close()
			st, _ := ctx.Value(chatModelStateKey{}).(*chatModelState)
			recordLLM(tc, info, st, nil, "")
			return ctx
		},
	}
}

func recordLLM(tc *promptscope.TraceContext, info *callbacks.RunInfo, st *chatModelState, output *model.CallbackOutput, errMsg string) {
	name := runInfoName(info)
	modelName := ""
	var messages []map[string]any
	var toolDefs []map[string]any
	if st != nil && st.input != nil {
		if st.input.Config != nil {
			modelName = st.input.Config.Model
		}
		messages = messagesToMaps(st.input.Messages)
		toolDefs = toolInfosToMaps(st.input.Tools)
	}
	if messages == nil {
		messages = []map[string]any{}
	}
	if modelName == "" {
		modelName = runInfoType(info)
	}

	opts := make([]promptscope.ObsOption, 0, 5)
	if len(toolDefs) > 0 {
		opts = append(opts, promptscope.ToolDefinitions(toolDefs))
	}

	meta := map[string]any{}
	if st != nil {
		meta["duration_ms"] = time.Since(st.start).Milliseconds()
	}

	switch {
	case errMsg != "":
		opts = append(opts, promptscope.ObsError(errMsg))
	case output != nil:
		if output.Message != nil {
			opts = append(opts, promptscope.Completion(messageToMap(output.Message)))
			if len(output.Message.ToolCalls) > 0 {
				opts = append(opts, promptscope.ToolCalls(toolCallsToMaps(output.Message.ToolCalls)))
			}
		}
		if output.TokenUsage != nil {
			opts = append(opts, promptscope.Tokens(output.TokenUsage.PromptTokens, output.TokenUsage.CompletionTokens))
		}
	default:
		// Streaming path: no aggregated output available.
		meta["stream"] = true
	}

	if len(meta) > 0 {
		opts = append(opts, promptscope.ObsMetadata(meta))
	}

	tc.LLM(name, modelName, messages, opts...)
}

// --- Tool --------------------------------------------------------------

// toolStateKey mirrors chatModelStateKey for the Tool component.
type toolStateKey struct{}

type toolState struct {
	start time.Time
	input *tool.CallbackInput
}

func toolHandler(tc *promptscope.TraceContext) *einoutils.ToolCallbackHandler {
	return &einoutils.ToolCallbackHandler{
		OnStart: func(ctx context.Context, info *callbacks.RunInfo, input *tool.CallbackInput) context.Context {
			return context.WithValue(ctx, toolStateKey{}, &toolState{
				start: time.Now(),
				input: input,
			})
		},
		OnEnd: func(ctx context.Context, info *callbacks.RunInfo, output *tool.CallbackOutput) context.Context {
			st, _ := ctx.Value(toolStateKey{}).(*toolState)
			recordTool(tc, info, st, output, "")
			return ctx
		},
		OnError: func(ctx context.Context, info *callbacks.RunInfo, err error) context.Context {
			st, _ := ctx.Value(toolStateKey{}).(*toolState)
			recordTool(tc, info, st, nil, err.Error())
			return ctx
		},
		// See the ChatModel OnEndWithStreamOutput comment: we close the
		// stream copy immediately without draining it. The tool
		// observation is reported with metadata.stream=true and an empty
		// tool_output (the backend requires tool_input plus tool_output
		// or error -- an empty string satisfies "not absent" without
		// fabricating a result). See README.md "Limitations".
		OnEndWithStreamOutput: func(ctx context.Context, info *callbacks.RunInfo, output *schema.StreamReader[*tool.CallbackOutput]) context.Context {
			defer output.Close()
			st, _ := ctx.Value(toolStateKey{}).(*toolState)
			recordTool(tc, info, st, nil, "")
			return ctx
		},
	}
}

func recordTool(tc *promptscope.TraceContext, info *callbacks.RunInfo, st *toolState, output *tool.CallbackOutput, errMsg string) {
	name := runInfoName(info)

	var input any = ""
	if st != nil && st.input != nil {
		input = decodeArguments(st.input.ArgumentsInJSON)
	}

	opts := make([]promptscope.ObsOption, 0, 2)
	meta := map[string]any{}
	if st != nil {
		meta["duration_ms"] = time.Since(st.start).Milliseconds()
	}

	var toolOutput any
	switch {
	case errMsg != "":
		opts = append(opts, promptscope.ObsError(errMsg))
	case output != nil && output.ToolOutput != nil:
		toolOutput = toolResultToMap(output.ToolOutput)
	case output != nil:
		toolOutput = output.Response
	default:
		// Streaming path: no aggregated output available; keep tool_output
		// as an empty (non-nil) string so the observation still satisfies
		// the backend's "tool_output or error" requirement.
		toolOutput = ""
		meta["stream"] = true
	}

	if len(meta) > 0 {
		opts = append(opts, promptscope.ObsMetadata(meta))
	}

	tc.Tool(name, input, toolOutput, opts...)
}

// --- shared conversion helpers ------------------------------------------

// runInfoName returns info.Name, falling back to info.Type when the caller
// (or eino's own graph-node auto-wrapping) left Name unset. info is never
// expected to be nil in a callback invocation, but we guard anyway.
func runInfoName(info *callbacks.RunInfo) string {
	if info == nil {
		return ""
	}
	if info.Name != "" {
		return info.Name
	}
	return info.Type
}

func runInfoType(info *callbacks.RunInfo) string {
	if info == nil {
		return ""
	}
	return info.Type
}

// decodeArguments best-effort JSON-decodes a tool call's arguments string
// into a native Go value (map/slice/etc.) so PromptScope stores structured
// tool_input instead of an opaque string. Falls back to the raw string when
// it isn't valid JSON, and also when it decodes to a JSON null -- the
// backend rejects a tool observation whose tool_input is absent/None, so we
// never want decodeArguments to hand back a Go nil.
func decodeArguments(raw string) any {
	if raw == "" {
		return raw
	}
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err != nil || v == nil {
		return raw
	}
	return v
}

// toolResultToMap converts a *schema.ToolResult (eino's multimodal tool
// output type) into a plain map via JSON round-trip, so it travels through
// promptscope's `any` fields the same way any other structured value would.
func toolResultToMap(tr *schema.ToolResult) any {
	b, err := json.Marshal(tr)
	if err != nil {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil
	}
	return m
}

// messageToMap converts a *schema.Message to the map[string]any shape the
// core SDK's tc.LLM expects for a message, mapping role/content faithfully
// plus tool_calls/tool_call_id/tool_name/name when present.
func messageToMap(m *schema.Message) map[string]any {
	if m == nil {
		return nil
	}
	out := map[string]any{
		"role":    string(m.Role),
		"content": m.Content,
	}
	if m.Name != "" {
		out["name"] = m.Name
	}
	if m.ToolCallID != "" {
		out["tool_call_id"] = m.ToolCallID
	}
	if m.ToolName != "" {
		out["tool_name"] = m.ToolName
	}
	if len(m.ToolCalls) > 0 {
		out["tool_calls"] = toolCallsToMaps(m.ToolCalls)
	}
	return out
}

func messagesToMaps(msgs []*schema.Message) []map[string]any {
	if msgs == nil {
		return nil
	}
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, messageToMap(m))
	}
	return out
}

func toolCallsToMaps(calls []schema.ToolCall) []map[string]any {
	if len(calls) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, len(calls))
	for _, c := range calls {
		out = append(out, map[string]any{
			"id":   c.ID,
			"type": c.Type,
			"function": map[string]any{
				"name":      c.Function.Name,
				"arguments": c.Function.Arguments,
			},
		})
	}
	return out
}

// toolInfoToMap flattens a *schema.ToolInfo (name/description/JSON-schema
// parameters) into the {name, description, parameters} shape used by
// tc.LLM's ToolDefinitions option. The JSON schema is produced via
// ParamsOneOf.ToJSONSchema() and round-tripped through encoding/json into a
// plain map; a nil ParamsOneOf (tool takes no parameters) omits the
// "parameters" key entirely rather than sending a fabricated empty schema.
func toolInfoToMap(ti *schema.ToolInfo) map[string]any {
	if ti == nil {
		return nil
	}
	out := map[string]any{
		"name":        ti.Name,
		"description": ti.Desc,
	}
	if ti.ParamsOneOf != nil {
		if js, err := ti.ParamsOneOf.ToJSONSchema(); err == nil && js != nil {
			if b, err := json.Marshal(js); err == nil {
				var params map[string]any
				if json.Unmarshal(b, &params) == nil {
					out["parameters"] = params
				}
			}
		}
	}
	return out
}

func toolInfosToMaps(tis []*schema.ToolInfo) []map[string]any {
	if len(tis) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, len(tis))
	for _, ti := range tis {
		out = append(out, toolInfoToMap(ti))
	}
	return out
}
