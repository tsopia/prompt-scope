import os
import uuid
from typing import List, Dict, Any

def generate_mock_candidates() -> List[Dict[str, Any]]:
    """生成 mock candidates 数据 - 匹配设计图场景"""
    experiment_id = str(uuid.uuid4())
    input_text = "请总结以下文章的核心观点：人工智能正在改变软件开发的范式，从代码生成到自动化测试，AI 工具正在提升开发效率。"

    candidates = [
        {
            "id": str(uuid.uuid4()),
            "experiment_id": experiment_id,
            "input": input_text,
            "prompt_id": "prompt1",
            "prompt_version": 1,
            "model": "gpt-4o",
            "output": "人工智能正在深刻改变软件开发。核心观点包括：1) AI 代码生成工具（如 Copilot）显著提升编码效率；2) 自动化测试和代码审查变得智能化；3) 开发者角色从编码者向架构师和审核者转变。",
            "cost": 0.0032,
            "latency": 1.2,
            "status": "completed",
            "score": 9.0,
            "input_tokens": 45,
            "output_tokens": 128,
        },
        {
            "id": str(uuid.uuid4()),
            "experiment_id": experiment_id,
            "input": input_text,
            "prompt_id": "prompt1",
            "prompt_version": 1,
            "model": "claude-3-haiku",
            "output": "人工智能对软件开发的影响：1. 代码辅助生成减少重复劳动 2. 智能测试覆盖更多场景 3. 开发重心转向系统设计和质量把控",
            "cost": 0.00028,
            "latency": 1.5,
            "status": "completed",
            "score": 8.2,
            "input_tokens": 45,
            "output_tokens": 85,
        },
        {
            "id": str(uuid.uuid4()),
            "experiment_id": experiment_id,
            "input": input_text,
            "prompt_id": "prompt2",
            "prompt_version": 2,
            "model": "gpt-4o",
            "output": "AI 正在改变软件开发方式。主要影响：代码生成效率提升、测试自动化、开发者角色转变。开发团队需要适应新的工作流。",
            "cost": 0.0031,
            "latency": 1.1,
            "status": "completed",
            "score": 8.8,
            "input_tokens": 45,
            "output_tokens": 112,
        },
        {
            "id": str(uuid.uuid4()),
            "experiment_id": experiment_id,
            "input": input_text,
            "prompt_id": "prompt2",
            "prompt_version": 2,
            "model": "claude-3-haiku",
            "output": "AI 对软件开发的影响：代码生成、智能测试、角色转变。",
            "cost": 0.00025,
            "latency": 1.3,
            "status": "completed",
            "score": 7.5,
            "input_tokens": 45,
            "output_tokens": 42,
        },
    ]

    return candidates
