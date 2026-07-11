package promptscope

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// newTestServer returns an httptest.Server that records every request it
// receives and always responds with the given status/body.
func newTestServer(t *testing.T, status int, body string) (*httptest.Server, *[]capturedRequest) {
	t.Helper()
	var reqs []capturedRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}
		reqs = append(reqs, capturedRequest{
			auth:    r.Header.Get("Authorization"),
			payload: payload,
		})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if body != "" {
			w.Write([]byte(body))
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &reqs
}

type capturedRequest struct {
	auth    string
	payload map[string]any
}

func testClient(t *testing.T, srv *httptest.Server) *Client {
	t.Helper()
	return New(srv.URL, "test-api-key", WithHTTPClient(srv.Client()))
}

// --- payload shape ---------------------------------------------------

func TestPayloadShapeLLMToolSpan(t *testing.T) {
	srv, reqs := newTestServer(t, http.StatusOK, `{}`)
	client := testClient(t, srv)

	tc := client.Trace("weather-agent-demo",
		TraceInput(map[string]any{"question": "北京今天天气怎么样？"}),
		TraceMetadata(map[string]any{"env": "test"}),
	)

	llmID := tc.LLM("plan", "gpt-4o",
		[]map[string]any{{"role": "user", "content": "北京今天天气怎么样？"}},
		ToolDefinitions([]map[string]any{
			{"name": "get_weather", "description": "look up weather", "parameters": map[string]any{
				"type":       "object",
				"properties": map[string]any{"city": map[string]any{"type": "string"}},
			}},
		}),
		ToolCalls([]map[string]any{{"name": "get_weather", "arguments": map[string]any{"city": "北京"}}}),
		Tokens(150, 25),
	)

	tc.Span("weather-lookup", Parent(llmID))

	tc.Tool("get_weather",
		map[string]any{"city": "北京"},
		map[string]any{"weather": "晴", "temperature": 32},
		Parent(llmID),
	)

	tc.SetOutput(map[string]any{"answer": "北京今天晴，32°C。"})

	func() {
		var err error
		defer tc.End(&err)
	}()

	if len(*reqs) != 1 {
		t.Fatalf("expected exactly 1 request, got %d", len(*reqs))
	}
	payload := (*reqs)[0].payload

	trace, ok := payload["trace"].(map[string]any)
	if !ok {
		t.Fatalf("payload.trace missing or wrong type: %#v", payload["trace"])
	}
	for _, key := range []string{"id", "name", "origin", "status", "input", "metadata", "started_at", "ended_at", "output"} {
		if _, ok := trace[key]; !ok {
			t.Errorf("trace missing expected key %q: %#v", key, trace)
		}
	}
	if trace["status"] != "success" {
		t.Errorf("expected trace.status = success, got %v", trace["status"])
	}
	if trace["origin"] != "live" {
		t.Errorf("expected trace.origin = live, got %v", trace["origin"])
	}

	obsRaw, ok := payload["observations"].([]any)
	if !ok || len(obsRaw) != 3 {
		t.Fatalf("expected 3 observations, got %#v", payload["observations"])
	}

	llmObs := obsRaw[0].(map[string]any)
	if llmObs["type"] != "llm" {
		t.Errorf("expected observations[0].type = llm, got %v", llmObs["type"])
	}
	for _, key := range []string{"id", "type", "name", "seq", "status", "model", "messages", "tool_definitions", "tool_calls", "input_tokens", "output_tokens", "started_at", "ended_at"} {
		if _, ok := llmObs[key]; !ok {
			t.Errorf("llm observation missing expected key %q: %#v", key, llmObs)
		}
	}
	if llmObs["seq"].(float64) != 0 {
		t.Errorf("expected first observation seq = 0, got %v", llmObs["seq"])
	}

	spanObs := obsRaw[1].(map[string]any)
	if spanObs["type"] != "span" {
		t.Errorf("expected observations[1].type = span, got %v", spanObs["type"])
	}
	if spanObs["parent_id"] != llmID {
		t.Errorf("expected span.parent_id = %q, got %v", llmID, spanObs["parent_id"])
	}
	if spanObs["seq"].(float64) != 1 {
		t.Errorf("expected span seq = 1 (auto-increment), got %v", spanObs["seq"])
	}

	toolObs := obsRaw[2].(map[string]any)
	if toolObs["type"] != "tool" {
		t.Errorf("expected observations[2].type = tool, got %v", toolObs["type"])
	}
	for _, key := range []string{"id", "type", "name", "seq", "status", "tool_input", "tool_output", "parent_id"} {
		if _, ok := toolObs[key]; !ok {
			t.Errorf("tool observation missing expected key %q: %#v", key, toolObs)
		}
	}
	if toolObs["parent_id"] != llmID {
		t.Errorf("expected tool.parent_id = %q, got %v", llmID, toolObs["parent_id"])
	}
	if toolObs["seq"].(float64) != 2 {
		t.Errorf("expected tool seq = 2 (auto-increment), got %v", toolObs["seq"])
	}
}

// --- auth header -------------------------------------------------------

func TestBearerAuthHeader(t *testing.T) {
	srv, reqs := newTestServer(t, http.StatusOK, `{}`)
	client := testClient(t, srv)

	tc := client.Trace("run")
	tc.Tool("search", map[string]any{"q": "hi"}, map[string]any{"r": 1})
	if err := tc.Flush(); err != nil {
		t.Fatalf("Flush failed: %v", err)
	}

	if len(*reqs) != 1 {
		t.Fatalf("expected 1 request, got %d", len(*reqs))
	}
	if got := (*reqs)[0].auth; got != "Bearer test-api-key" {
		t.Errorf("expected Authorization header %q, got %q", "Bearer test-api-key", got)
	}
}

// --- idempotent flush ---------------------------------------------------

func TestFlushIsIdempotent(t *testing.T) {
	srv, reqs := newTestServer(t, http.StatusOK, `{}`)
	client := testClient(t, srv)

	tc := client.Trace("run")
	tc.Tool("search", map[string]any{"q": "hi"}, map[string]any{"r": 1})

	if err := tc.Flush(); err != nil {
		t.Fatalf("first Flush failed: %v", err)
	}
	if err := tc.Flush(); err != nil {
		t.Fatalf("second Flush should be a no-op, got error: %v", err)
	}
	if err := tc.Flush(); err != nil {
		t.Fatalf("third Flush should be a no-op, got error: %v", err)
	}

	if len(*reqs) != 1 {
		t.Fatalf("expected exactly 1 POST across 3 Flush calls, got %d", len(*reqs))
	}
}

func TestEndFlushesExactlyOnce(t *testing.T) {
	srv, reqs := newTestServer(t, http.StatusOK, `{}`)
	client := testClient(t, srv)

	func() {
		var err error
		tc := client.Trace("run")
		defer tc.End(&err)
		tc.Tool("search", map[string]any{"q": "hi"}, map[string]any{"r": 1})
		// explicit Flush before End's deferred flush -- must still be one POST.
		_ = tc.Flush()
	}()

	if len(*reqs) != 1 {
		t.Fatalf("expected exactly 1 POST, got %d", len(*reqs))
	}
}

// --- error path preserves original error --------------------------------

func TestEndPreservesOriginalErrorOnFlushFailure(t *testing.T) {
	srv, reqs := newTestServer(t, http.StatusInternalServerError, `{"detail":"boom"}`)
	client := testClient(t, srv)

	originalErr := &testError{"business logic failed"}

	run := func() (err error) {
		tc := client.Trace("run")
		defer tc.End(&err)
		err = originalErr
		return err
	}

	gotErr := run()
	if gotErr != originalErr {
		t.Fatalf("expected End to preserve the original error even though flush failed, got %v", gotErr)
	}
	if len(*reqs) != 1 {
		t.Fatalf("expected exactly 1 POST attempt, got %d", len(*reqs))
	}
}

func TestEndReportsErrorStatusOnFailure(t *testing.T) {
	srv, reqs := newTestServer(t, http.StatusOK, `{}`)
	client := testClient(t, srv)

	run := func() (err error) {
		tc := client.Trace("run")
		defer tc.End(&err)
		err = &testError{"business logic failed"}
		return err
	}
	_ = run()

	if len(*reqs) != 1 {
		t.Fatalf("expected 1 request, got %d", len(*reqs))
	}
	trace := (*reqs)[0].payload["trace"].(map[string]any)
	if trace["status"] != "error" {
		t.Errorf("expected trace.status = error, got %v", trace["status"])
	}
}

func TestEndSuccessPathSurfacesFlushFailure(t *testing.T) {
	srv, _ := newTestServer(t, http.StatusInternalServerError, `{"detail":"ingest unreachable"}`)
	client := testClient(t, srv)

	run := func() (err error) {
		tc := client.Trace("run")
		defer tc.End(&err)
		return nil
	}

	err := run()
	if err == nil {
		t.Fatal("expected End to surface the flush failure into *errPtr on the clean-exit path")
	}
}

type testError struct{ msg string }

func (e *testError) Error() string { return e.msg }

// --- panic re-panics after flush -----------------------------------------

func TestEndRePanicsAfterFlushingOnPanic(t *testing.T) {
	srv, reqs := newTestServer(t, http.StatusOK, `{}`)
	client := testClient(t, srv)

	var recovered any
	func() {
		defer func() {
			recovered = recover()
		}()
		func() {
			var err error
			tc := client.Trace("run")
			defer tc.End(&err)
			tc.LLM("plan", "gpt-4o", []map[string]any{{"role": "user", "content": "hi"}})
			panic("agent exploded")
		}()
	}()

	if recovered != "agent exploded" {
		t.Fatalf("expected panic to re-propagate with original value, got %#v", recovered)
	}
	if len(*reqs) != 1 {
		t.Fatalf("expected the trace to be flushed exactly once before re-panicking, got %d requests", len(*reqs))
	}
	trace := (*reqs)[0].payload["trace"].(map[string]any)
	if trace["status"] != "error" {
		t.Errorf("expected trace.status = error after panic, got %v", trace["status"])
	}
}

// --- no client-side validation --------------------------------------------

func TestNoClientSideValidationOfLLMRequiredFields(t *testing.T) {
	// The backend's IngestRequest Pydantic model requires an llm
	// observation to carry "model" and "messages". The SDK must NOT
	// enforce this itself -- it mirrors the Python SDK, which performs no
	// client-side validation and simply lets the server reject bad
	// payloads. This test documents that calling LLM with an empty model
	// and nil messages does not error or panic client-side; it is sent
	// as-is and it is the server's job (not exercised here) to reject it.
	srv, reqs := newTestServer(t, http.StatusOK, `{}`)
	client := testClient(t, srv)

	tc := client.Trace("run")
	tc.LLM("plan", "" /* no model */, nil /* no messages */)

	if err := tc.Flush(); err != nil {
		t.Fatalf("SDK must not reject an invalid-per-schema llm observation client-side, got: %v", err)
	}
	if len(*reqs) != 1 {
		t.Fatalf("expected the (schema-invalid) payload to still be sent, got %d requests", len(*reqs))
	}
	obs := (*reqs)[0].payload["observations"].([]any)[0].(map[string]any)
	// An empty model is indistinguishable from "unset" to the server either
	// way (both fail the same "llm requires model" check), so the SDK is
	// free to omit it -- the point of this test is that Flush did not
	// refuse to send the request client-side.
	if v, present := obs["model"]; present && v != "" {
		t.Errorf("expected model to be empty or omitted, got %v", v)
	}
	if obs["type"] != "llm" {
		t.Errorf("expected observation type llm, got %v", obs["type"])
	}
}

// --- PromptScopeError detail extraction ------------------------------------

func TestPromptScopeErrorDetailFromSimpleHTTPException(t *testing.T) {
	srv, _ := newTestServer(t, http.StatusUnauthorized, `{"detail":"invalid api key"}`)
	client := testClient(t, srv)

	tc := client.Trace("run")
	err := tc.Flush()
	if err == nil {
		t.Fatal("expected an error for a 401 response")
	}
	pse, ok := err.(*PromptScopeError)
	if !ok {
		t.Fatalf("expected *PromptScopeError, got %T: %v", err, err)
	}
	if pse.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", pse.StatusCode)
	}
	if pse.Detail != "invalid api key" {
		t.Errorf("expected detail %q, got %q", "invalid api key", pse.Detail)
	}
}

func TestPromptScopeErrorDetailFromValidationList(t *testing.T) {
	body := `{"detail":[{"type":"value_error","loc":["messages"],"msg":"llm observation requires messages"}]}`
	srv, _ := newTestServer(t, http.StatusUnprocessableEntity, body)
	client := testClient(t, srv)

	tc := client.Trace("run")
	err := tc.Flush()
	if err == nil {
		t.Fatal("expected an error for a 422 response")
	}
	pse, ok := err.(*PromptScopeError)
	if !ok {
		t.Fatalf("expected *PromptScopeError, got %T: %v", err, err)
	}
	if pse.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("expected status 422, got %d", pse.StatusCode)
	}
	if pse.Detail == "" {
		t.Errorf("expected a non-empty detail surfaced from the 422 validation error list")
	}
}

// --- concurrency safety of seq auto-increment ------------------------------

func TestSeqAutoIncrementIsMonotonic(t *testing.T) {
	srv, reqs := newTestServer(t, http.StatusOK, `{}`)
	client := testClient(t, srv)

	tc := client.Trace("run")
	var counter int64
	const n = 20
	done := make(chan struct{}, n)
	for i := 0; i < n; i++ {
		go func() {
			tc.Tool("t", map[string]any{"i": atomic.AddInt64(&counter, 1)}, map[string]any{})
			done <- struct{}{}
		}()
	}
	for i := 0; i < n; i++ {
		<-done
	}

	if err := tc.Flush(); err != nil {
		t.Fatalf("Flush failed: %v", err)
	}
	obs := (*reqs)[0].payload["observations"].([]any)
	if len(obs) != n {
		t.Fatalf("expected %d observations, got %d", n, len(obs))
	}
	seen := map[int]bool{}
	for _, o := range obs {
		seq := int(o.(map[string]any)["seq"].(float64))
		if seen[seq] {
			t.Fatalf("duplicate seq %d", seq)
		}
		seen[seq] = true
	}
	for i := 0; i < n; i++ {
		if !seen[i] {
			t.Fatalf("missing seq %d in %v", i, seen)
		}
	}
}
