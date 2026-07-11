package promptscope

// traceIn is the wire representation of the "trace" field in an ingestion
// request. Field names/tags mirror backend/schemas/ingest.py's TraceIn
// exactly (snake_case JSON).
type traceIn struct {
	ID              string         `json:"id"`
	Name            string         `json:"name"`
	Origin          string         `json:"origin"`
	Status          string         `json:"status"`
	Input           any            `json:"input"`
	Output          any            `json:"output"`
	Metadata        map[string]any `json:"metadata,omitempty"`
	StartedAt       string         `json:"started_at,omitempty"`
	EndedAt         string         `json:"ended_at,omitempty"`
	PromptVersionID string         `json:"prompt_version_id,omitempty"`
}

// observationIn is the wire representation of one entry in the
// "observations" array of an ingestion request. Field names/tags mirror
// backend/schemas/ingest.py's ObservationIn exactly (snake_case JSON).
//
// The SDK performs no client-side validation of the type-specific required
// fields (e.g. llm requires messages+model, tool requires tool_input plus
// tool_output or error) -- the backend's IngestRequest Pydantic model is the
// single source of truth for that, same as the Python SDK.
type observationIn struct {
	ID       string `json:"id"`
	ParentID string `json:"parent_id,omitempty"`
	Type     string `json:"type"`
	Name     string `json:"name"`
	// Seq deliberately has no `omitempty`: the first observation on a
	// trace legitimately has Seq == 0, and omitempty would drop it.
	Seq       int            `json:"seq"`
	Status    string         `json:"status"`
	Error     string         `json:"error,omitempty"`
	StartedAt string         `json:"started_at,omitempty"`
	EndedAt   string         `json:"ended_at,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`

	// llm
	Model       string         `json:"model,omitempty"`
	ModelParams map[string]any `json:"model_params,omitempty"`
	// Messages deliberately has no `omitempty`: the ingest schema treats
	// "field absent" (nil) and "explicit []" differently for its
	// llm-requires-messages check, so a caller-supplied empty slice must
	// still be sent rather than silently dropped.
	Messages        []map[string]any `json:"messages"`
	ToolDefinitions []map[string]any `json:"tool_definitions,omitempty"`
	ToolCalls       []map[string]any `json:"tool_calls,omitempty"`
	// Completion deliberately has no `omitempty`: it is an arbitrary
	// JSON value (Any on the Python side) and a legitimate completion
	// could be "", 0, or false -- values encoding/json's omitempty would
	// otherwise treat as absent.
	Completion      any    `json:"completion"`
	InputTokens     *int   `json:"input_tokens,omitempty"`
	OutputTokens    *int   `json:"output_tokens,omitempty"`
	PromptVersionID string `json:"prompt_version_id,omitempty"`

	// tool
	// ToolInput/ToolOutput deliberately have no `omitempty` for the same
	// reason as Completion above.
	ToolInput  any `json:"tool_input"`
	ToolOutput any `json:"tool_output"`
}

// ingestRequest is the top-level POST /api/ingest payload.
type ingestRequest struct {
	Trace        traceIn         `json:"trace"`
	Observations []observationIn `json:"observations"`
}
