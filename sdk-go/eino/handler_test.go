package eino

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/components"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"

	promptscope "github.com/promptscope/sdk-go"
)

// --- test scaffolding ------------------------------------------------------

// newTestTrace returns a TraceContext backed by an httptest.Server that
// captures the ingest payload it receives, so tests can assert on the exact
// JSON shape sent to PromptScope.
func newTestTrace(t *testing.T) (*promptscope.TraceContext, func() map[string]any) {
	t.Helper()
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("failed to decode ingest payload: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	client := promptscope.New(srv.URL, "test-key", promptscope.WithHTTPClient(srv.Client()))
	tc := client.Trace("eino-run")

	return tc, func() map[string]any { return captured }
}

func firstObservation(t *testing.T, payload map[string]any) map[string]any {
	t.Helper()
	obs, ok := payload["observations"].([]any)
	if !ok || len(obs) == 0 {
		t.Fatalf("expected at least 1 observation, got %#v", payload["observations"])
	}
	m, ok := obs[0].(map[string]any)
	if !ok {
		t.Fatalf("observation[0] has unexpected type: %#v", obs[0])
	}
	return m
}

// --- ChatModel: OnStart -> OnEnd round trip ---------------------------------

func TestChatModel_OnStartOnEnd_RecordsLLMObservation(t *testing.T) {
	tc, payload := newTestTrace(t)
	handler := NewHandler(tc)

	info := &callbacks.RunInfo{Name: "planner", Type: "OpenAI", Component: components.ComponentOfChatModel}

	toolParams := schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
		"city": {Type: schema.String, Desc: "city name"},
	})

	input := &model.CallbackInput{
		Messages: []*schema.Message{
			{Role: schema.User, Content: "北京今天天气怎么样？"},
		},
		Tools: []*schema.ToolInfo{
			{Name: "get_weather", Desc: "look up the weather", ParamsOneOf: toolParams},
		},
		Config: &model.Config{Model: "gpt-4o"},
	}

	ctx := handler.OnStart(context.Background(), info, input)

	output := &model.CallbackOutput{
		Message: &schema.Message{Role: schema.Assistant, Content: "北京今天晴，32°C。"},
		TokenUsage: &model.TokenUsage{
			PromptTokens:     120,
			CompletionTokens: 40,
		},
	}
	handler.OnEnd(ctx, info, output)

	if err := tc.Flush(); err != nil {
		t.Fatalf("Flush failed: %v", err)
	}

	obs := firstObservation(t, payload())
	if obs["type"] != "llm" {
		t.Fatalf("expected type=llm, got %v", obs["type"])
	}
	if obs["name"] != "planner" {
		t.Errorf("expected name=planner, got %v", obs["name"])
	}
	if obs["model"] != "gpt-4o" {
		t.Errorf("expected model=gpt-4o (from Config), got %v", obs["model"])
	}

	msgs, ok := obs["messages"].([]any)
	if !ok || len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %#v", obs["messages"])
	}
	msg0 := msgs[0].(map[string]any)
	if msg0["role"] != "user" || msg0["content"] != "北京今天天气怎么样？" {
		t.Errorf("message not mapped faithfully: %#v", msg0)
	}

	toolDefs, ok := obs["tool_definitions"].([]any)
	if !ok || len(toolDefs) != 1 {
		t.Fatalf("expected 1 tool definition, got %#v", obs["tool_definitions"])
	}
	td0 := toolDefs[0].(map[string]any)
	if td0["name"] != "get_weather" {
		t.Errorf("expected tool_definitions[0].name = get_weather, got %v", td0["name"])
	}
	if td0["description"] != "look up the weather" {
		t.Errorf("expected description verbatim, got %v", td0["description"])
	}
	params, ok := td0["parameters"].(map[string]any)
	if !ok {
		t.Fatalf("expected parameters to be a JSON-schema object, got %#v", td0["parameters"])
	}
	if params["type"] != "object" {
		t.Errorf("expected parameters.type = object, got %v", params["type"])
	}
	props, ok := params["properties"].(map[string]any)
	if !ok || props["city"] == nil {
		t.Fatalf("expected parameters.properties.city, got %#v", params["properties"])
	}

	if obs["completion"] == nil {
		t.Fatal("expected completion to be set")
	}
	completion := obs["completion"].(map[string]any)
	if completion["content"] != "北京今天晴，32°C。" || completion["role"] != "assistant" {
		t.Errorf("completion not mapped faithfully: %#v", completion)
	}

	if obs["input_tokens"].(float64) != 120 {
		t.Errorf("expected input_tokens=120, got %v", obs["input_tokens"])
	}
	if obs["output_tokens"].(float64) != 40 {
		t.Errorf("expected output_tokens=40, got %v", obs["output_tokens"])
	}

	meta, ok := obs["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected metadata to carry duration_ms, got %#v", obs["metadata"])
	}
	if _, ok := meta["duration_ms"]; !ok {
		t.Errorf("expected metadata.duration_ms, got %#v", meta)
	}
}

// --- ChatModel: name falls back to RunInfo.Type -----------------------------

func TestChatModel_NameFallsBackToType(t *testing.T) {
	tc, payload := newTestTrace(t)
	handler := NewHandler(tc)

	info := &callbacks.RunInfo{Type: "OpenAI", Component: components.ComponentOfChatModel} // Name unset

	ctx := handler.OnStart(context.Background(), info, &model.CallbackInput{
		Messages: []*schema.Message{{Role: schema.User, Content: "hi"}},
	})
	handler.OnEnd(ctx, info, &model.CallbackOutput{Message: &schema.Message{Role: schema.Assistant, Content: "hello"}})

	if err := tc.Flush(); err != nil {
		t.Fatalf("Flush failed: %v", err)
	}
	obs := firstObservation(t, payload())
	if obs["name"] != "OpenAI" {
		t.Errorf("expected name to fall back to RunInfo.Type=OpenAI, got %v", obs["name"])
	}
	if obs["model"] != "OpenAI" {
		t.Errorf("expected model to fall back to RunInfo.Type=OpenAI when Config is nil, got %v", obs["model"])
	}
}

// --- ChatModel: OnError ------------------------------------------------------

func TestChatModel_OnError_RecordsErrorObservation(t *testing.T) {
	tc, payload := newTestTrace(t)
	handler := NewHandler(tc)

	info := &callbacks.RunInfo{Name: "planner", Type: "OpenAI", Component: components.ComponentOfChatModel}
	input := &model.CallbackInput{
		Messages: []*schema.Message{{Role: schema.User, Content: "hi"}},
		Config:   &model.Config{Model: "gpt-4o"},
	}
	ctx := handler.OnStart(context.Background(), info, input)
	handler.OnError(ctx, info, errBoom)

	if err := tc.Flush(); err != nil {
		t.Fatalf("Flush failed: %v", err)
	}
	obs := firstObservation(t, payload())
	if obs["status"] != "error" {
		t.Errorf("expected status=error, got %v", obs["status"])
	}
	if obs["error"] != errBoom.Error() {
		t.Errorf("expected error=%q, got %v", errBoom.Error(), obs["error"])
	}
	// messages must still be present (llm observations require messages
	// even on the error path -- see backend/schemas/ingest.py).
	if msgs, ok := obs["messages"].([]any); !ok || len(msgs) != 1 {
		t.Errorf("expected messages to still be populated on the error path, got %#v", obs["messages"])
	}
}

// --- ChatModel: streaming path ------------------------------------------

func TestChatModel_OnEndWithStreamOutput_ClosesStreamAndRecordsMetadata(t *testing.T) {
	tc, payload := newTestTrace(t)
	handler := NewHandler(tc)

	info := &callbacks.RunInfo{Name: "planner", Type: "OpenAI", Component: components.ComponentOfChatModel}
	input := &model.CallbackInput{
		Messages: []*schema.Message{{Role: schema.User, Content: "hi"}},
		Config:   &model.Config{Model: "gpt-4o"},
	}
	ctx := handler.OnStart(context.Background(), info, input)

	sr := schema.StreamReaderFromArray([]*model.CallbackOutput{
		{Message: &schema.Message{Role: schema.Assistant, Content: "chunk-1"}},
	})
	// Wrap in the generic CallbackOutput stream type the Handler interface
	// expects, mirroring how eino's manager converts component-specific
	// stream types before calling the handler.
	converted := schema.StreamReaderWithConvert(sr, func(o *model.CallbackOutput) (callbacks.CallbackOutput, error) {
		return o, nil
	})

	handler.OnEndWithStreamOutput(ctx, info, converted)

	// The handler must have closed its copy already; a second Close must
	// not panic (StreamReader.Close is documented safe to call once we
	// own the reader -- this just asserts the handler didn't leave things
	// in a state that blows up when the framework also closes its side).
	sr.Close()

	if err := tc.Flush(); err != nil {
		t.Fatalf("Flush failed: %v", err)
	}
	obs := firstObservation(t, payload())
	if obs["type"] != "llm" {
		t.Fatalf("expected type=llm, got %v", obs["type"])
	}
	meta, ok := obs["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected metadata, got %#v", obs["metadata"])
	}
	if stream, _ := meta["stream"].(bool); !stream {
		t.Errorf("expected metadata.stream=true, got %#v", meta)
	}
	// Streaming output is not aggregated -- no completion should be set.
	if obs["completion"] != nil {
		t.Errorf("expected no completion for the streaming path, got %v", obs["completion"])
	}
}

// --- Tool: OnStart -> OnEnd round trip ---------------------------------

func TestTool_OnStartOnEnd_RecordsToolObservation(t *testing.T) {
	tc, payload := newTestTrace(t)
	handler := NewHandler(tc)

	info := &callbacks.RunInfo{Name: "get_weather", Type: "LocalTool", Component: components.ComponentOfTool}
	input := &tool.CallbackInput{ArgumentsInJSON: `{"city":"北京"}`}

	ctx := handler.OnStart(context.Background(), info, input)
	output := &tool.CallbackOutput{Response: `{"weather":"晴","temperature":32}`}
	handler.OnEnd(ctx, info, output)

	if err := tc.Flush(); err != nil {
		t.Fatalf("Flush failed: %v", err)
	}
	obs := firstObservation(t, payload())
	if obs["type"] != "tool" {
		t.Fatalf("expected type=tool, got %v", obs["type"])
	}
	if obs["name"] != "get_weather" {
		t.Errorf("expected name=get_weather, got %v", obs["name"])
	}

	toolInput, ok := obs["tool_input"].(map[string]any)
	if !ok {
		t.Fatalf("expected tool_input decoded to a map, got %#v", obs["tool_input"])
	}
	if toolInput["city"] != "北京" {
		t.Errorf("expected tool_input.city verbatim, got %v", toolInput["city"])
	}

	if obs["tool_output"] != output.Response {
		t.Errorf("expected tool_output = raw Response string, got %v", obs["tool_output"])
	}

	meta, ok := obs["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected metadata, got %#v", obs["metadata"])
	}
	if _, ok := meta["duration_ms"]; !ok {
		t.Errorf("expected metadata.duration_ms, got %#v", meta)
	}
}

// --- Tool: malformed JSON arguments fall back to the raw string ------------

func TestTool_NonJSONArguments_FallBackToRawString(t *testing.T) {
	tc, payload := newTestTrace(t)
	handler := NewHandler(tc)

	info := &callbacks.RunInfo{Name: "echo", Type: "LocalTool", Component: components.ComponentOfTool}
	input := &tool.CallbackInput{ArgumentsInJSON: "not-json"}

	ctx := handler.OnStart(context.Background(), info, input)
	handler.OnEnd(ctx, info, &tool.CallbackOutput{Response: "ok"})

	if err := tc.Flush(); err != nil {
		t.Fatalf("Flush failed: %v", err)
	}
	obs := firstObservation(t, payload())
	if obs["tool_input"] != "not-json" {
		t.Errorf("expected tool_input to fall back to the raw string, got %v", obs["tool_input"])
	}
}

// --- Tool: structured ToolOutput -----------------------------------------

func TestTool_StructuredToolOutput_IsMapped(t *testing.T) {
	tc, payload := newTestTrace(t)
	handler := NewHandler(tc)

	info := &callbacks.RunInfo{Name: "get_weather", Type: "LocalTool", Component: components.ComponentOfTool}
	input := &tool.CallbackInput{ArgumentsInJSON: `{"city":"北京"}`}
	ctx := handler.OnStart(context.Background(), info, input)

	toolResult := &schema.ToolResult{
		Parts: []schema.ToolOutputPart{
			{Type: schema.ToolPartTypeText, Text: "晴，32°C"},
		},
	}
	handler.OnEnd(ctx, info, &tool.CallbackOutput{ToolOutput: toolResult})

	if err := tc.Flush(); err != nil {
		t.Fatalf("Flush failed: %v", err)
	}
	obs := firstObservation(t, payload())
	out, ok := obs["tool_output"].(map[string]any)
	if !ok {
		t.Fatalf("expected tool_output to be a map from ToolResult, got %#v", obs["tool_output"])
	}
	if _, ok := out["parts"]; !ok {
		t.Errorf("expected tool_output.parts, got %#v", out)
	}
}

// --- Tool: OnError -------------------------------------------------------

func TestTool_OnError_RecordsErrorObservation(t *testing.T) {
	tc, payload := newTestTrace(t)
	handler := NewHandler(tc)

	info := &callbacks.RunInfo{Name: "get_weather", Type: "LocalTool", Component: components.ComponentOfTool}
	input := &tool.CallbackInput{ArgumentsInJSON: `{"city":"北京"}`}
	ctx := handler.OnStart(context.Background(), info, input)
	handler.OnError(ctx, info, errBoom)

	if err := tc.Flush(); err != nil {
		t.Fatalf("Flush failed: %v", err)
	}
	obs := firstObservation(t, payload())
	if obs["status"] != "error" {
		t.Errorf("expected status=error, got %v", obs["status"])
	}
	if obs["error"] != errBoom.Error() {
		t.Errorf("expected error=%q, got %v", errBoom.Error(), obs["error"])
	}
	// tool observations require tool_input to still be present on the
	// error path (see backend/schemas/ingest.py: tool_input is required
	// unconditionally, independent of tool_output/error).
	if obs["tool_input"] == nil {
		t.Errorf("expected tool_input to still be populated on the error path, got %#v", obs["tool_input"])
	}
}

// --- Tool: streaming path -------------------------------------------------

func TestTool_OnEndWithStreamOutput_ClosesStreamAndRecordsMetadata(t *testing.T) {
	tc, payload := newTestTrace(t)
	handler := NewHandler(tc)

	info := &callbacks.RunInfo{Name: "get_weather", Type: "LocalTool", Component: components.ComponentOfTool}
	input := &tool.CallbackInput{ArgumentsInJSON: `{"city":"北京"}`}
	ctx := handler.OnStart(context.Background(), info, input)

	sr := schema.StreamReaderFromArray([]*tool.CallbackOutput{{Response: "chunk-1"}})
	converted := schema.StreamReaderWithConvert(sr, func(o *tool.CallbackOutput) (callbacks.CallbackOutput, error) {
		return o, nil
	})

	handler.OnEndWithStreamOutput(ctx, info, converted)
	sr.Close()

	if err := tc.Flush(); err != nil {
		t.Fatalf("Flush failed: %v", err)
	}
	obs := firstObservation(t, payload())
	if obs["tool_output"] != "" {
		t.Errorf("expected empty (non-nil) tool_output for the streaming path, got %#v", obs["tool_output"])
	}
	meta := obs["metadata"].(map[string]any)
	if stream, _ := meta["stream"].(bool); !stream {
		t.Errorf("expected metadata.stream=true, got %#v", meta)
	}
}

// --- flat sequencing across ChatModel + Tool ------------------------------

func TestFlatSequencing_NoParentNesting(t *testing.T) {
	tc, payload := newTestTrace(t)
	handler := NewHandler(tc)

	llmInfo := &callbacks.RunInfo{Name: "plan", Type: "OpenAI", Component: components.ComponentOfChatModel}
	ctx := handler.OnStart(context.Background(), llmInfo, &model.CallbackInput{
		Messages: []*schema.Message{{Role: schema.User, Content: "hi"}},
		Config:   &model.Config{Model: "gpt-4o"},
	})
	handler.OnEnd(ctx, llmInfo, &model.CallbackOutput{
		Message: &schema.Message{
			Role: schema.Assistant,
			ToolCalls: []schema.ToolCall{
				{ID: "call_1", Type: "function", Function: schema.FunctionCall{Name: "get_weather", Arguments: `{"city":"北京"}`}},
			},
		},
	})

	toolInfo := &callbacks.RunInfo{Name: "get_weather", Type: "LocalTool", Component: components.ComponentOfTool}
	tctx := handler.OnStart(context.Background(), toolInfo, &tool.CallbackInput{ArgumentsInJSON: `{"city":"北京"}`})
	handler.OnEnd(tctx, toolInfo, &tool.CallbackOutput{Response: `{"weather":"晴"}`})

	if err := tc.Flush(); err != nil {
		t.Fatalf("Flush failed: %v", err)
	}
	obsList := payload()["observations"].([]any)
	if len(obsList) != 2 {
		t.Fatalf("expected 2 observations, got %d", len(obsList))
	}
	for i, o := range obsList {
		m := o.(map[string]any)
		if pid, ok := m["parent_id"]; ok && pid != "" && pid != nil {
			t.Errorf("observation[%d] unexpectedly has a parent_id (flat sequencing expected): %#v", i, pid)
		}
	}
	llmObs := obsList[0].(map[string]any)
	toolCalls, ok := llmObs["tool_calls"].([]any)
	if !ok || len(toolCalls) != 1 {
		t.Fatalf("expected 1 tool call on the llm observation, got %#v", llmObs["tool_calls"])
	}
	tc0 := toolCalls[0].(map[string]any)
	fn := tc0["function"].(map[string]any)
	if fn["name"] != "get_weather" {
		t.Errorf("expected tool_calls[0].function.name = get_weather, got %v", fn["name"])
	}
}

type simpleError string

func (e simpleError) Error() string { return string(e) }

const errBoom = simpleError("boom: simulated failure")
