package promptscope

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// PromptScopeError is returned when the ingestion API responds with a
// non-2xx status. Detail mirrors the "detail" field FastAPI returns, either
// a plain message (explicit HTTPException) or a stringified validation
// error list (422 field errors) — the same shape the Python SDK surfaces.
type PromptScopeError struct {
	StatusCode int
	Detail     string
}

func (e *PromptScopeError) Error() string {
	return fmt.Sprintf("promptscope: ingestion request failed (status %d): %s", e.StatusCode, e.Detail)
}

// detailFromResponse extracts FastAPI's conventional {"detail": ...} field
// from a non-2xx response body, falling back to the raw body text if it
// isn't JSON or has no "detail" key.
func detailFromResponse(resp *http.Response) string {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Sprintf("(failed to read response body: %v)", err)
	}

	var parsed map[string]json.RawMessage
	if err := json.Unmarshal(body, &parsed); err != nil {
		return string(body)
	}
	raw, ok := parsed["detail"]
	if !ok {
		return string(body)
	}

	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		return asString
	}
	// Non-string detail (e.g. a 422 validation error list of objects) --
	// surface it as-is rather than discarding structure.
	return string(raw)
}
