"""E2E fixture data generator: reports a handful of real traces via the
PromptScope Python SDK against the running e2e backend.

Invoked by frontend/e2e/journey.spec.ts via child_process, with the freshly
created project's API key passed in through PS_URL / PS_KEY env vars.
"""
import os
import sys
from pathlib import Path

# Locate the SDK relative to this script file (not cwd) so it works
# regardless of the working directory playwright launches it from.
SDK_ROOT = Path(__file__).resolve().parents[3] / "sdk"
sys.path.insert(0, str(SDK_ROOT))

from promptscope import PromptScopeClient  # noqa: E402

WEATHER_TOOL_DEF = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather for a city",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
                },
                "required": ["city"],
            },
        },
    }
]


def report_weather_agent(client: PromptScopeClient, *, model: str, city: str, unit: str) -> None:
    with client.trace("e2e-weather-agent", input={"question": f"What's the weather in {city}?"}) as t:
        llm_id = t.llm(
            "plan",
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful weather assistant."},
                {"role": "user", "content": f"What's the weather in {city}?"},
            ],
            tool_definitions=WEATHER_TOOL_DEF,
            tool_calls=[
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "get_weather", "arguments": f'{{"city": "{city}", "unit": "{unit}"}}'},
                }
            ],
            completion=None,
            input_tokens=42,
            output_tokens=18,
        )
        t.tool(
            "get_weather",
            tool_input={"city": city, "unit": unit},
            tool_output={"temperature": 22, "condition": "sunny", "unit": unit},
            parent=llm_id,
        )
        t.llm(
            "respond",
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful weather assistant."},
                {"role": "user", "content": f"What's the weather in {city}?"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "get_weather", "arguments": f'{{"city": "{city}", "unit": "{unit}"}}'},
                        }
                    ],
                },
                {"role": "tool", "content": '{"temperature": 22, "condition": "sunny"}'},
            ],
            completion={"role": "assistant", "content": f"It's sunny and 22 degrees in {city}."},
            input_tokens=70,
            output_tokens=14,
        )
        t.set_output({"answer": f"It's sunny and 22 degrees in {city}."})


def report_failed_bot(client: PromptScopeClient) -> None:
    try:
        with client.trace("e2e-failed-bot", input={"question": "trigger a failure"}) as t:
            t.llm(
                "plan",
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a bot that always fails for e2e testing."},
                    {"role": "user", "content": "trigger a failure"},
                ],
                completion={"role": "assistant", "content": "attempting the impossible…"},
                input_tokens=20,
                output_tokens=8,
            )
            raise ValueError("simulated agent failure for e2e coverage")
    except ValueError:
        pass


def main() -> None:
    base_url = os.environ["PS_URL"]
    api_key = os.environ["PS_KEY"]
    client = PromptScopeClient(base_url, api_key)

    # Two traces sharing the same name so they can be selected together for
    # /compare — deliberately different tool call params (city) to produce a
    # param_mismatch-worthy diff when aligned.
    report_weather_agent(client, model="gpt-4o", city="Beijing", unit="celsius")
    report_weather_agent(client, model="deepseek-chat", city="Shanghai", unit="celsius")

    report_failed_bot(client)


if __name__ == "__main__":
    main()
