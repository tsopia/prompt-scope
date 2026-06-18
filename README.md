# PromptScope

基于 Langfuse 的 LLM 对比与成本优化平台。

## 功能特性

- **Experiment 列表**：查看所有 LLM 实验及其 candidates
- **Candidate 对比**：支持任意两个 candidate 的 side-by-side 对比
- **LLM Judge 评估**：调用 OpenAI 评估替代可行性、打分并说明理由
- **成本分析**：内置模型定价表，自动计算并展示成本差异
- **Cost vs Quality 图表**：直观展示成本与质量的关系
- **自动同步**：每 5 分钟自动从 Langfuse 同步数据

## 技术栈

- **前端**：Next.js 14 + TypeScript + TailwindCSS + shadcn/ui + Recharts + Zustand
- **后端**：FastAPI + Python + SQLite
- **外部依赖**：Langfuse（数据源）+ OpenAI（LLM Judge）

## 快速开始

### 1. 配置环境变量

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

编辑 `backend/.env`：

```env
LANGFUSE_HOST=https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=your_public_key
LANGFUSE_SECRET_KEY=your_secret_key
OPENAI_API_KEY=your_openai_api_key
```

### 2. Docker 启动（推荐）

```bash
docker-compose up -d
```

访问：http://localhost:3000

### 3. 本地开发启动

**后端：**

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**前端：**

```bash
cd frontend
npm install
npm run dev
```

访问：http://localhost:3000

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/candidates` | GET | 获取所有 candidates |
| `/api/experiments` | GET | 按 experiment 分组获取 |
| `/api/compare` | POST | 对比两个 candidate |
| `/api/sync` | POST | 手动触发同步 |
| `/api/sync/status` | GET | 获取同步状态 |
| `/api/health` | GET | 健康检查 |

## 项目结构

```
promptscope/
├── backend/          # FastAPI 后端
│   ├── main.py
│   ├── services/     # 业务逻辑
│   ├── models/       # 数据模型
│   └── db/           # SQLite 数据目录
├── frontend/         # Next.js 前端
│   ├── app/          # 页面路由
│   ├── components/   # React 组件
│   ├── lib/          # 工具函数 & API
│   └── store/        # Zustand 状态管理
└── docker-compose.yml
```

## 模型定价表

内置以下模型定价（每 1K tokens / 美元）：

| 模型 | Input | Output |
|------|-------|--------|
| gpt-4o | $0.005 | $0.015 |
| gpt-4o-mini | $0.00015 | $0.0006 |
| gpt-4-turbo | $0.01 | $0.03 |
| claude-3-5-sonnet | $0.003 | $0.015 |
| claude-3-opus | $0.015 | $0.075 |
| deepseek-chat | $0.00014 | $0.00028 |
| gemini-1.5-pro | $0.00125 | $0.005 |
| gemini-1.5-flash | $0.000075 | $0.0003 |

> 注：价格仅供参考，可在 `backend/services/candidate_service.py` 中修改。

## Langfuse 埋点示例

```python
from langfuse import Langfuse

langfuse = Langfuse()

trace = langfuse.trace(name="promptscope-run", input=input_text)
trace.generation(
    name="llm-call",
    model=model,
    input=prompt + input_text,
    output=output["text"],
    usage=output.get("usage"),
    metadata={
        "prompt_id": prompt["id"],
        "prompt_version": prompt.get("version", 1)
    }
)
```

## License

MIT
