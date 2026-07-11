package promptscope

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
)

// TraceOption configures a trace constructed by Client.Trace.
type TraceOption func(*traceIn)

// TraceInput sets the trace's input value (any JSON-serializable value).
func TraceInput(v any) TraceOption {
	return func(t *traceIn) { t.Input = v }
}

// TraceMetadata sets the trace's metadata.
func TraceMetadata(v map[string]any) TraceOption {
	return func(t *traceIn) { t.Metadata = v }
}

// TracePromptVersion associates the trace with a prompt version id.
func TracePromptVersion(id string) TraceOption {
	return func(t *traceIn) { t.PromptVersionID = id }
}

// ObsOption configures an observation created by TraceContext.LLM, .Tool,
// or .Span.
type ObsOption func(*observationIn)

// ModelParams sets the model call parameters of an llm observation (e.g.
// {"temperature": 0.2}).
func ModelParams(v map[string]any) ObsOption {
	return func(o *observationIn) { o.ModelParams = v }
}

// ToolDefinitions sets the tool definitions made available to an llm call.
func ToolDefinitions(v []map[string]any) ObsOption {
	return func(o *observationIn) { o.ToolDefinitions = v }
}

// ToolCalls sets the tool calls produced by an llm call.
func ToolCalls(v []map[string]any) ObsOption {
	return func(o *observationIn) { o.ToolCalls = v }
}

// Completion sets the completion/output content of an llm observation.
func Completion(v any) ObsOption {
	return func(o *observationIn) { o.Completion = v }
}

// Tokens sets the input/output token counts of an llm observation.
func Tokens(in, out int) ObsOption {
	return func(o *observationIn) { o.InputTokens = &in; o.OutputTokens = &out }
}

// ObsMetadata sets an observation's metadata.
func ObsMetadata(v map[string]any) ObsOption {
	return func(o *observationIn) { o.Metadata = v }
}

// PromptVersion associates an observation with a prompt version id.
func PromptVersion(id string) ObsOption {
	return func(o *observationIn) { o.PromptVersionID = id }
}

// ObsError marks an observation as failed with the given error message.
func ObsError(msg string) ObsOption {
	return func(o *observationIn) {
		o.Error = msg
		o.Status = "error"
	}
}

// Parent sets an observation's parent observation id, building the call
// tree (e.g. a tool call nested under the llm call that produced it).
func Parent(id string) ObsOption {
	return func(o *observationIn) { o.ParentID = id }
}

// TraceContext collects observations for a single trace and reports them
// to the ingestion API on Flush (or via End, typically deferred).
//
// Obtained via Client.Trace. Not safe for use after Flush/End has completed
// except for further no-op Flush/End calls (Flush is idempotent).
type TraceContext struct {
	client *Client

	mu           sync.Mutex
	seq          int
	flushed      bool
	trace        traceIn
	observations []observationIn
}

// Trace starts a new trace named name. The returned TraceContext collects
// observations locally until Flush or End reports them to the ingestion
// API.
func (c *Client) Trace(name string, opts ...TraceOption) *TraceContext {
	t := traceIn{
		ID:        newID(),
		Name:      name,
		Origin:    "live",
		Status:    "success",
		StartedAt: nowISO(),
	}
	for _, opt := range opts {
		opt(&t)
	}
	return &TraceContext{client: c, trace: t}
}

func (tc *TraceContext) nextSeq() int {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	seq := tc.seq
	tc.seq++
	return seq
}

func (tc *TraceContext) addObservation(o observationIn) string {
	tc.mu.Lock()
	tc.observations = append(tc.observations, o)
	tc.mu.Unlock()
	return o.ID
}

// LLM records an llm observation: a single model call with its request
// messages and (via options) its response/usage. Returns the observation
// id, usable as a Parent(...) option for nested tool calls.
func (tc *TraceContext) LLM(name, model string, messages []map[string]any, opts ...ObsOption) string {
	o := observationIn{
		ID:        newID(),
		Type:      "llm",
		Name:      name,
		Seq:       tc.nextSeq(),
		Status:    "success",
		Model:     model,
		Messages:  messages,
		StartedAt: nowISO(),
	}
	for _, opt := range opts {
		opt(&o)
	}
	o.EndedAt = nowISO()
	return tc.addObservation(o)
}

// Tool records a tool observation: a single tool invocation with its input
// and output (or, via ObsError, a failure). Returns the observation id.
func (tc *TraceContext) Tool(name string, input, output any, opts ...ObsOption) string {
	o := observationIn{
		ID:         newID(),
		Type:       "tool",
		Name:       name,
		Seq:        tc.nextSeq(),
		Status:     "success",
		ToolInput:  input,
		ToolOutput: output,
		StartedAt:  nowISO(),
	}
	for _, opt := range opts {
		opt(&o)
	}
	o.EndedAt = nowISO()
	return tc.addObservation(o)
}

// Span records a span observation: a generic grouping node with no
// llm/tool-specific fields, useful for organizing a subtree of calls.
// Returns the observation id.
func (tc *TraceContext) Span(name string, opts ...ObsOption) string {
	o := observationIn{
		ID:        newID(),
		Type:      "span",
		Name:      name,
		Seq:       tc.nextSeq(),
		Status:    "success",
		StartedAt: nowISO(),
	}
	for _, opt := range opts {
		opt(&o)
	}
	o.EndedAt = nowISO()
	return tc.addObservation(o)
}

// TraceID returns the client-generated id of this trace, e.g. for logging
// or building a link to the trace in the PromptScope UI.
func (tc *TraceContext) TraceID() string {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	return tc.trace.ID
}

// SetOutput sets the trace's final output value.
func (tc *TraceContext) SetOutput(output any) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	tc.trace.Output = output
}

// Flush sends the trace and its observations to the ingestion API. It is
// idempotent: a second call on an already-flushed TraceContext is a no-op
// that returns nil.
func (tc *TraceContext) Flush() error {
	tc.mu.Lock()
	if tc.flushed {
		tc.mu.Unlock()
		return nil
	}
	tc.flushed = true
	payload := ingestRequest{Trace: tc.trace, Observations: tc.observations}
	tc.mu.Unlock()

	if payload.Observations == nil {
		payload.Observations = []observationIn{}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("promptscope: failed to marshal ingest payload: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, tc.client.baseURL+"/api/ingest", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("promptscope: failed to build ingest request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tc.client.apiKey)

	resp, err := tc.client.http.Do(req)
	if err != nil {
		return fmt.Errorf("promptscope: ingest request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return &PromptScopeError{StatusCode: resp.StatusCode, Detail: detailFromResponse(resp)}
	}
	return nil
}

// End finalizes the trace and flushes it; intended to be used with defer:
//
//	tc := client.Trace("run")
//	defer tc.End(&err)
//
// Behavior:
//   - If a panic is in flight, the trace is marked "error", flushed (a
//     flush failure is logged to stderr, never suppressing the panic), and
//     the panic is re-raised.
//   - Else if *errPtr is non-nil, the trace is marked "error" and flushed;
//     a flush failure is logged to stderr but never replaces *errPtr --
//     the original error from the caller's function always wins.
//   - Else (clean exit), the trace is marked "success" and flushed; unlike
//     the error path, a flush failure here has nothing to defer to, so it
//     is written into *errPtr (mirroring the Python SDK, where flush
//     errors "propagate normally" on the success path).
//
// errPtr may be nil, in which case a flush failure on the success path is
// simply dropped (there is nowhere to report it).
func (tc *TraceContext) End(errPtr *error) {
	tc.mu.Lock()
	tc.trace.EndedAt = nowISO()
	tc.mu.Unlock()

	if r := recover(); r != nil {
		tc.mu.Lock()
		tc.trace.Status = "error"
		tc.mu.Unlock()
		if ferr := tc.Flush(); ferr != nil {
			fmt.Fprintf(os.Stderr, "promptscope: report failed (original panic preserved): %v\n", ferr)
		}
		panic(r)
	}

	if errPtr != nil && *errPtr != nil {
		tc.mu.Lock()
		tc.trace.Status = "error"
		tc.mu.Unlock()
		if ferr := tc.Flush(); ferr != nil {
			fmt.Fprintf(os.Stderr, "promptscope: report failed (original error preserved): %v\n", ferr)
		}
		return
	}

	tc.mu.Lock()
	tc.trace.Status = "success"
	tc.mu.Unlock()
	if ferr := tc.Flush(); ferr != nil && errPtr != nil {
		*errPtr = ferr
	}
}
