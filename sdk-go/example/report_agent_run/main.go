// Command report_agent_run reports one realistic agent run trace to a
// PromptScope ingestion API endpoint: an initial llm call that plans a tool
// call, the tool call itself, and a final llm call that produces the
// answer.
//
// Usage:
//
//	export PROMPTSCOPE_BASE_URL=http://localhost:8000
//	export PROMPTSCOPE_API_KEY=ps-xxxx
//	go run ./example/report_agent_run
package main

import (
	"fmt"
	"os"

	"github.com/promptscope/sdk-go"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "report_agent_run:", err)
		os.Exit(1)
	}
}

func run() (err error) {
	baseURL := os.Getenv("PROMPTSCOPE_BASE_URL")
	apiKey := os.Getenv("PROMPTSCOPE_API_KEY")
	if baseURL == "" || apiKey == "" {
		return fmt.Errorf("PROMPTSCOPE_BASE_URL and PROMPTSCOPE_API_KEY must be set")
	}

	client := promptscope.New(baseURL, apiKey)

	question := "北京今天天气怎么样？"

	tc := client.Trace("weather-agent-demo",
		promptscope.TraceInput(map[string]any{"question": question}),
	)
	defer tc.End(&err)

	planID := tc.LLM("plan", "gpt-4o",
		[]map[string]any{
			{"role": "user", "content": question},
		},
		promptscope.ToolDefinitions([]map[string]any{
			{
				"name":        "get_weather",
				"description": "Look up the current weather for a city.",
				"parameters": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"city": map[string]any{
							"type":        "string",
							"description": "City name, e.g. 北京",
						},
					},
					"required": []string{"city"},
				},
			},
		}),
		promptscope.ToolCalls([]map[string]any{
			{"name": "get_weather", "arguments": map[string]any{"city": "北京"}},
		}),
		promptscope.Tokens(150, 25),
	)

	weather := map[string]any{"weather": "晴", "temperature": 32}
	tc.Tool("get_weather",
		map[string]any{"city": "北京"},
		weather,
		promptscope.Parent(planID),
	)

	answer := "北京今天晴，32°C。"
	tc.LLM("answer", "gpt-4o",
		[]map[string]any{
			{"role": "user", "content": question},
			{"role": "assistant", "content": nil, "tool_calls": []map[string]any{
				{"name": "get_weather", "arguments": map[string]any{"city": "北京"}},
			}},
			{"role": "tool", "name": "get_weather", "content": weather},
		},
		promptscope.Completion(answer),
		promptscope.Tokens(220, 35),
	)

	tc.SetOutput(map[string]any{"answer": answer})

	fmt.Println("reported trace id:", tc.TraceID())
	return nil
}
