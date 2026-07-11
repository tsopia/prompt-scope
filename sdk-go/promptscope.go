// Package promptscope is a lightweight Go SDK for reporting agent run traces
// (LLM calls, tool calls, spans) to the PromptScope ingestion API.
//
// It mirrors the semantics of the bundled Python SDK (sdk/promptscope in the
// promptscope repo): client-generated hex ids, auto-incrementing observation
// sequence numbers, ISO-8601 UTC timestamps, and a trace scope that reports
// success on clean exit and error status on a returned error or recovered
// panic.
//
// Basic usage:
//
//	client := promptscope.New(baseURL, apiKey)
//	tc := client.Trace("weather-agent-demo", promptscope.TraceInput(q))
//	defer tc.End(&err)
//	llmID := tc.LLM("plan", "gpt-4o", messages)
//	tc.Tool("get_weather", input, output, promptscope.Parent(llmID))
//	tc.SetOutput(answer)
//
// See example/report_agent_run for a complete runnable example.
package promptscope

import "net/http"

// Client reports traces to a PromptScope ingestion API endpoint.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// Option configures a Client constructed by New.
type Option func(*Client)

// WithHTTPClient overrides the *http.Client used to send requests. Useful
// for setting timeouts, transports, or (in tests) pointing at an
// httptest.Server.
func WithHTTPClient(hc *http.Client) Option {
	return func(c *Client) {
		if hc != nil {
			c.http = hc
		}
	}
}

// New creates a Client for the ingestion API at baseURL, authenticating
// requests with apiKey (sent as "Authorization: Bearer <apiKey>").
func New(baseURL, apiKey string, opts ...Option) *Client {
	c := &Client{
		baseURL: trimTrailingSlash(baseURL),
		apiKey:  apiKey,
		http:    http.DefaultClient,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

func trimTrailingSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}
