"""PromptScope 上报示例：模拟一次带工具调用的 agent 运行并上报。

用法：
  export PROMPTSCOPE_URL=http://localhost:8000
  export PROMPTSCOPE_API_KEY=ps-xxxx
  python examples/report_agent_run.py
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import httpx

BASE_URL = os.environ.get("PROMPTSCOPE_URL", "http://localhost:8000")
API_KEY = os.environ["PROMPTSCOPE_API_KEY"]


def iso(dt: datetime) -> str:
    return dt.isoformat()


def main() -> None:
    t0 = datetime.now(timezone.utc)
    trace_id = uuid.uuid4().hex
    llm_plan, tool_call, llm_answer = (uuid.uuid4().hex for _ in range(3))

    payload = {
        "trace": {
            "id": trace_id,
            "name": "weather-agent-demo",
            "input": {"question": "北京今天天气怎么样？"},
            "output": {"answer": "北京今天晴，32°C。"},
            "started_at": iso(t0),
            "ended_at": iso(t0 + timedelta(seconds=4)),
        },
        "observations": [
            {
                "id": llm_plan, "type": "llm", "name": "plan", "seq": 0,
                "model": "gpt-4o",
                "model_params": {"temperature": 0.2},
                "messages": [
                    {"role": "system", "content": "你是天气助手，可调用工具。"},
                    {"role": "user", "content": "北京今天天气怎么样？"},
                ],
                "tool_definitions": [{
                    "name": "get_weather",
                    "description": "查询城市天气",
                    "parameters": {"type": "object",
                                   "properties": {"city": {"type": "string"}}},
                }],
                "tool_calls": [{"name": "get_weather", "arguments": {"city": "北京"}}],
                "input_tokens": 150, "output_tokens": 25,
                "started_at": iso(t0), "ended_at": iso(t0 + timedelta(seconds=1)),
            },
            {
                "id": tool_call, "parent_id": llm_plan, "type": "tool",
                "name": "get_weather", "seq": 1,
                "tool_input": {"city": "北京"},
                "tool_output": {"weather": "晴", "temperature": 32},
                "started_at": iso(t0 + timedelta(seconds=1)),
                "ended_at": iso(t0 + timedelta(seconds=2)),
            },
            {
                "id": llm_answer, "type": "llm", "name": "answer", "seq": 2,
                "model": "gpt-4o",
                "messages": [
                    {"role": "system", "content": "你是天气助手。"},
                    {"role": "tool", "content": '{"weather": "晴", "temperature": 32}'},
                ],
                "completion": "北京今天晴，32°C。",
                "input_tokens": 220, "output_tokens": 35,
                "started_at": iso(t0 + timedelta(seconds=2)),
                "ended_at": iso(t0 + timedelta(seconds=4)),
            },
        ],
    }

    resp = httpx.post(f"{BASE_URL}/api/ingest", json=payload,
                      headers={"Authorization": f"Bearer {API_KEY}"}, timeout=10)
    if resp.status_code >= 400:
        print(f"error {resp.status_code}: {resp.text}")
    resp.raise_for_status()
    print(f"reported trace {trace_id}: {resp.json()}")
    print(f"view it at {BASE_URL.replace('8000', '3000')}/traces/{trace_id}")


if __name__ == "__main__":
    main()
