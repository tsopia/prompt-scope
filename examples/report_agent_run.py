"""PromptScope 上报示例：模拟一次带工具调用的 agent 运行并上报。

用法：
  export PROMPTSCOPE_URL=http://localhost:8000
  export PROMPTSCOPE_API_KEY=ps-xxxx
  python examples/report_agent_run.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sdk"))

from promptscope import PromptScopeClient, PromptScopeError  # noqa: E402

BASE_URL = os.environ.get("PROMPTSCOPE_URL", "http://localhost:8000")
API_KEY = os.environ["PROMPTSCOPE_API_KEY"]


def main() -> None:
    client = PromptScopeClient(BASE_URL, API_KEY)

    try:
        with client.trace("weather-agent-demo",
                           input={"question": "北京今天天气怎么样？"}) as t:
            llm_plan = t.llm(
                "plan", model="gpt-4o",
                model_params={"temperature": 0.2},
                messages=[
                    {"role": "system", "content": "你是天气助手，可调用工具。"},
                    {"role": "user", "content": "北京今天天气怎么样？"},
                ],
                tool_definitions=[{
                    "name": "get_weather",
                    "description": "查询城市天气",
                    "parameters": {"type": "object",
                                   "properties": {"city": {"type": "string"}}},
                }],
                tool_calls=[{"name": "get_weather", "arguments": {"city": "北京"}}],
                input_tokens=150, output_tokens=25,
            )
            t.tool(
                "get_weather", tool_input={"city": "北京"},
                tool_output={"weather": "晴", "temperature": 32},
                parent=llm_plan,
            )
            t.llm(
                "answer", model="gpt-4o",
                messages=[
                    {"role": "system", "content": "你是天气助手。"},
                    {"role": "tool", "content": '{"weather": "晴", "temperature": 32}'},
                ],
                completion="北京今天晴，32°C。",
                input_tokens=220, output_tokens=35,
            )
            t.set_output({"answer": "北京今天晴，32°C。"})
    except PromptScopeError as e:
        print(f"error: {e}")
        raise

    trace_id = t.trace["id"]
    print(f"reported trace {trace_id}")
    print(f"view it at {BASE_URL.replace('8000', '3000')}/traces/{trace_id}")


if __name__ == "__main__":
    main()
