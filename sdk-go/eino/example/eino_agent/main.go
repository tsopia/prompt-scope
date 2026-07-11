// Command eino_agent runs a minimal two-turn eino agent (a stub ChatModel
// that first emits a tool call, then a real InvokableTool that answers it,
// then the ChatModel again for the final answer) through two small compiled
// compose.Chain graphs, wired with promptscope/sdk-go/eino.NewHandler so
// every ChatModel/Tool invocation is automatically reported to PromptScope
// -- no manual tc.LLM/tc.Tool calls in this file.
//
// Usage:
//
//	export PROMPTSCOPE_BASE_URL=http://localhost:8000
//	export PROMPTSCOPE_API_KEY=ps-xxxx
//	go run ./example/eino_agent
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	toolutils "github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"

	promptscope "github.com/promptscope/sdk-go"
	einohandler "github.com/promptscope/sdk-go/eino"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "eino_agent:", err)
		os.Exit(1)
	}
}

func run() (err error) {
	baseURL := os.Getenv("PROMPTSCOPE_BASE_URL")
	apiKey := os.Getenv("PROMPTSCOPE_API_KEY")
	if baseURL == "" || apiKey == "" {
		return fmt.Errorf("PROMPTSCOPE_BASE_URL and PROMPTSCOPE_API_KEY must be set")
	}

	ctx := context.Background()

	weatherTool, err := toolutils.InferTool[weatherInput, weatherOutput](
		"get_weather",
		"Look up the current weather for a city.",
		getWeather,
	)
	if err != nil {
		return fmt.Errorf("build weather tool: %w", err)
	}

	chatRunnable, err := compose.NewChain[[]*schema.Message, *schema.Message]().
		AppendChatModel(&stubChatModel{}).
		Compile(ctx)
	if err != nil {
		return fmt.Errorf("compile chat chain: %w", err)
	}

	toolsNode, err := compose.NewToolNode(ctx, &compose.ToolsNodeConfig{
		Tools: []tool.BaseTool{weatherTool},
	})
	if err != nil {
		return fmt.Errorf("build tools node: %w", err)
	}
	toolsRunnable, err := compose.NewChain[*schema.Message, []*schema.Message]().
		AppendToolsNode(toolsNode).
		Compile(ctx)
	if err != nil {
		return fmt.Errorf("compile tools chain: %w", err)
	}

	client := promptscope.New(baseURL, apiKey)

	question := "北京今天天气怎么样？"
	tc := client.Trace("eino-agent-demo",
		promptscope.TraceInput(map[string]any{"question": question}),
	)
	defer tc.End(&err)

	handler := einohandler.NewHandler(tc)
	callbackOpt := compose.WithCallbacks(handler)

	messages := []*schema.Message{
		{Role: schema.User, Content: question},
	}

	// Turn 1: the (stub) model plans a tool call.
	assistantMsg, err := chatRunnable.Invoke(ctx, messages, callbackOpt)
	if err != nil {
		return fmt.Errorf("chat model turn 1: %w", err)
	}
	messages = append(messages, assistantMsg)

	// Execute the tool call(s) the model just produced.
	toolResults, err := toolsRunnable.Invoke(ctx, assistantMsg, callbackOpt)
	if err != nil {
		return fmt.Errorf("tool execution: %w", err)
	}
	messages = append(messages, toolResults...)

	// Turn 2: the model produces the final answer given the tool result.
	finalMsg, err := chatRunnable.Invoke(ctx, messages, callbackOpt)
	if err != nil {
		return fmt.Errorf("chat model turn 2: %w", err)
	}

	tc.SetOutput(map[string]any{"answer": finalMsg.Content})

	fmt.Println("answer:", finalMsg.Content)
	fmt.Println("reported trace id:", tc.TraceID())
	return nil
}

// --- stub ChatModel ----------------------------------------------------

// stubChatModel is a fixed-response model.BaseChatModel: it emits a
// get_weather tool call the first time it sees a message history with no
// tool results yet, and a final natural-language answer once a tool
// (schema.Tool role) message is present in the history. It deliberately
// does not implement components.Checker/its own callback injection, so
// eino's graph-node wrapper auto-injects OnStart/OnEnd around Generate --
// exercising the same code path most non-callback-aware BaseChatModel
// implementations hit.
type stubChatModel struct{}

func (s *stubChatModel) Generate(_ context.Context, input []*schema.Message, _ ...model.Option) (*schema.Message, error) {
	for _, m := range input {
		if m.Role == schema.Tool {
			return &schema.Message{
				Role:    schema.Assistant,
				Content: "北京今天晴，32°C。",
			}, nil
		}
	}
	return &schema.Message{
		Role: schema.Assistant,
		ToolCalls: []schema.ToolCall{
			{
				ID:   "call_1",
				Type: "function",
				Function: schema.FunctionCall{
					Name:      "get_weather",
					Arguments: `{"city":"北京"}`,
				},
			},
		},
	}, nil
}

func (s *stubChatModel) Stream(_ context.Context, _ []*schema.Message, _ ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	return nil, fmt.Errorf("stubChatModel: Stream not implemented in this example")
}

// --- real InvokableTool --------------------------------------------------

type weatherInput struct {
	City string `json:"city" jsonschema:"required,description=city name, e.g. 北京"`
}

type weatherOutput struct {
	Weather     string  `json:"weather"`
	Temperature float64 `json:"temperature"`
}

func getWeather(_ context.Context, in weatherInput) (weatherOutput, error) {
	// A real tool would call out to a weather API; this example returns a
	// fixed reading so the run is deterministic and needs no extra
	// credentials beyond PromptScope's own.
	return weatherOutput{Weather: "晴", Temperature: 32}, nil
}
