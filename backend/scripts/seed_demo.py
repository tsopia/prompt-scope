"""灌入演示用 mock 数据，方便查看页面交互与样式。

用法：cd backend && .venv/bin/python -m scripts.seed_demo
可重复执行（trace id 固定，幂等 upsert）。
"""
from datetime import timedelta

from db import Base, SessionLocal, engine
from db_migrate import ensure_columns
from models.entities import (ApiKey, Evaluation, ModelPricing, ModelProvider,
                             Project, Prompt, PromptVersion, ReplayRun, utcnow)
from schemas.ingest import IngestRequest, ObservationIn, TraceIn
from services.auth import generate_api_key
from services.ingest_service import ingest


def get_or_create_project(db, name: str) -> Project:
    p = db.query(Project).filter(Project.name == name).first()
    if p is None:
        p = Project(name=name)
        db.add(p)
        db.flush()
        raw, key_hash, prefix = generate_api_key()
        db.add(ApiKey(project_id=p.id, key_hash=key_hash, prefix=prefix))
        db.commit()
        print(f"project [{name}] created, api key (仅显示一次): {raw}")
    else:
        print(f"project [{name}] already exists, reusing")
    return p


def seed_providers_and_pricing(db, project):
    if db.query(ModelProvider).filter(ModelProvider.project_id == project.id).count() == 0:
        oai = ModelProvider(project_id=project.id, name="openai-demo",
                            base_url="https://api.openai.com/v1",
                            api_key="sk-demo-not-real", provider_type="openai")
        ds = ModelProvider(project_id=project.id, name="deepseek-demo",
                           base_url="https://api.deepseek.com/v1",
                           api_key="sk-demo-not-real", provider_type="openai")
        db.add_all([oai, ds])
        db.flush()
        pricing = [
            ("gpt-4o", 0.005, 0.015, oai.id),
            ("gpt-4o-mini", 0.00015, 0.0006, oai.id),
            ("deepseek-chat", 0.00014, 0.00028, ds.id),
            ("claude-3-5-sonnet", 0.003, 0.015, None),
        ]
        for model, inp, outp, pid in pricing:
            db.add(ModelPricing(project_id=project.id, model=model,
                                input_price_per_1k=inp,
                                output_price_per_1k=outp, provider_id=pid))
        db.commit()
        print("providers + pricing seeded (key 为假值，judge/回放会如实报错——用于查看错误态样式)")


def seed_prompts(db, project) -> str:
    pr = db.query(Prompt).filter(Prompt.project_id == project.id,
                                 Prompt.name == "weather-assistant").first()
    if pr is None:
        pr = Prompt(project_id=project.id, name="weather-assistant")
        db.add(pr)
        db.flush()
        db.add(PromptVersion(prompt_id=pr.id, version=1,
                             content="你是天气助手，可调用工具查询天气。"))
        db.add(PromptVersion(prompt_id=pr.id, version=2,
                             content="你是简洁精准的天气播报员，回答不超过两句话，"
                                     "必要时调用工具查询实时数据。"))
        pr2 = Prompt(project_id=project.id, name="research-agent")
        db.add(pr2)
        db.flush()
        db.add(PromptVersion(prompt_id=pr2.id, version=1,
                             content="你是研究助理，先检索资料再综合回答，引用来源。"))
        db.commit()
        print("prompts seeded (weather-assistant v1/v2, research-agent v1)")
    version1 = db.query(PromptVersion).filter(
        PromptVersion.prompt_id == pr.id, PromptVersion.version == 1).first()
    return version1.id


def _ts(base, offset_s, dur_s):
    return base + timedelta(seconds=offset_s), base + timedelta(seconds=offset_s + dur_s)


def seed_traces(db, project, prompt_v1_id):
    base = utcnow() - timedelta(hours=3)

    # 1. 天气 agent（gpt-4o，两步工具，关联 prompt v1）
    s, e = _ts(base, 0, 4.2)
    ingest(db, project.id, IngestRequest(
        trace=TraceIn(id="demo-trace-weather", name="weather-agent",
                      input={"question": "北京今天适合骑车吗？"},
                      output={"answer": "北京今天晴，32°C，微风，适合骑车，注意防晒。"},
                      started_at=s, ended_at=e, prompt_version_id=prompt_v1_id,
                      metadata={"env": "prod", "user_id": "u_1024"}),
        observations=[
            ObservationIn(id="demo-w-llm1", type="llm", name="plan", seq=0,
                          model="gpt-4o", model_params={"temperature": 0.2},
                          messages=[{"role": "system", "content": "你是天气助手，可调用工具查询天气。"},
                                    {"role": "user", "content": "北京今天适合骑车吗？"}],
                          tool_definitions=[{"type": "function", "function": {
                              "name": "get_weather", "description": "查询城市实时天气",
                              "parameters": {"type": "object", "properties": {
                                  "city": {"type": "string"}}}}}],
                          tool_calls=[{"id": "c1", "name": "get_weather",
                                       "arguments": {"city": "北京"}}],
                          input_tokens=310, output_tokens=28,
                          started_at=s, ended_at=s + timedelta(seconds=1.1)),
            ObservationIn(id="demo-w-tool1", parent_id="demo-w-llm1", type="tool",
                          name="get_weather", seq=1,
                          tool_input={"city": "北京"},
                          tool_output={"weather": "晴", "temp_c": 32, "wind": "微风 2 级"},
                          started_at=s + timedelta(seconds=1.1),
                          ended_at=s + timedelta(seconds=1.6)),
            ObservationIn(id="demo-w-llm2", type="llm", name="answer", seq=2,
                          model="gpt-4o",
                          messages=[{"role": "system", "content": "你是天气助手。"},
                                    {"role": "tool",
                                     "content": '{"weather": "晴", "temp_c": 32}'}],
                          completion="北京今天晴，32°C，微风，适合骑车，注意防晒。",
                          input_tokens=402, output_tokens=41,
                          started_at=s + timedelta(seconds=1.6), ended_at=e),
        ]))

    # 2. 同任务的 deepseek 版本（便于对比工作台演示成本差）
    s, e = _ts(base, 300, 6.8)
    ingest(db, project.id, IngestRequest(
        trace=TraceIn(id="demo-trace-weather-cheap", name="weather-agent",
                      input={"question": "北京今天适合骑车吗？"},
                      output={"answer": "适合。今天北京晴，气温 32 度，风不大。"},
                      started_at=s, ended_at=e,
                      metadata={"env": "prod", "candidate": "cheap-model"}),
        observations=[
            ObservationIn(id="demo-wc-llm1", type="llm", name="plan", seq=0,
                          model="deepseek-chat", model_params={"temperature": 0.2},
                          messages=[{"role": "system", "content": "你是天气助手，可调用工具查询天气。"},
                                    {"role": "user", "content": "北京今天适合骑车吗？"}],
                          tool_definitions=[{"type": "function", "function": {
                              "name": "get_weather", "parameters": {}}}],
                          tool_calls=[{"id": "c1", "name": "get_weather",
                                       "arguments": {"city": "北京市"}}],
                          input_tokens=305, output_tokens=35,
                          started_at=s, ended_at=s + timedelta(seconds=2.4)),
            ObservationIn(id="demo-wc-tool1", parent_id="demo-wc-llm1", type="tool",
                          name="get_weather", seq=1,
                          tool_input={"city": "北京市"},
                          tool_output={"weather": "晴", "temp_c": 32, "wind": "微风 2 级"},
                          started_at=s + timedelta(seconds=2.4),
                          ended_at=s + timedelta(seconds=2.9)),
            ObservationIn(id="demo-wc-tool2", parent_id="demo-wc-llm1", type="tool",
                          name="get_air_quality", seq=2,
                          tool_input={"city": "北京市"},
                          tool_output={"aqi": 58, "level": "良"},
                          started_at=s + timedelta(seconds=2.9),
                          ended_at=s + timedelta(seconds=3.4)),
            ObservationIn(id="demo-wc-llm2", type="llm", name="answer", seq=3,
                          model="deepseek-chat",
                          messages=[{"role": "tool", "content": '{"weather": "晴"}'}],
                          completion="适合。今天北京晴，气温 32 度，风不大。",
                          input_tokens=520, output_tokens=38,
                          started_at=s + timedelta(seconds=3.4), ended_at=e),
        ]))

    # 3. 研究 agent（多工具长链路）
    s, e = _ts(base, 900, 18.5)
    ingest(db, project.id, IngestRequest(
        trace=TraceIn(id="demo-trace-research", name="research-agent",
                      input={"topic": "2026 上半年国产大模型价格战"},
                      output={"summary": "上半年主要厂商 API 均价下降约 40%…（略）"},
                      started_at=s, ended_at=e),
        observations=[
            ObservationIn(id="demo-r-span", type="span", name="retrieval-phase", seq=0,
                          started_at=s, ended_at=s + timedelta(seconds=9)),
            ObservationIn(id="demo-r-llm1", parent_id="demo-r-span", type="llm",
                          name="query-planner", seq=1, model="gpt-4o-mini",
                          messages=[{"role": "system", "content": "你是研究助理，先检索资料再综合回答，引用来源。"},
                                    {"role": "user", "content": "2026 上半年国产大模型价格战"}],
                          tool_definitions=[{"type": "function", "function": {
                              "name": "web_search", "parameters": {}}}],
                          tool_calls=[{"id": "c1", "name": "web_search",
                                       "arguments": {"q": "国产大模型 API 降价 2026"}}],
                          input_tokens=280, output_tokens=45,
                          started_at=s, ended_at=s + timedelta(seconds=2)),
            ObservationIn(id="demo-r-tool1", parent_id="demo-r-llm1", type="tool",
                          name="web_search", seq=2,
                          tool_input={"q": "国产大模型 API 降价 2026"},
                          tool_output={"hits": [{"title": "…", "url": "https://example.com/1"},
                                                {"title": "…", "url": "https://example.com/2"}]},
                          started_at=s + timedelta(seconds=2),
                          ended_at=s + timedelta(seconds=5)),
            ObservationIn(id="demo-r-tool2", parent_id="demo-r-llm1", type="tool",
                          name="fetch_page", seq=3,
                          tool_input={"url": "https://example.com/1"},
                          tool_output={"text": "……厂商 A 宣布输入价下调至 0.8 元/百万 tokens……"},
                          started_at=s + timedelta(seconds=5),
                          ended_at=s + timedelta(seconds=9)),
            ObservationIn(id="demo-r-llm2", type="llm", name="synthesize", seq=4,
                          model="gpt-4o",
                          messages=[{"role": "user", "content": "根据检索结果综合成报告"}],
                          completion="上半年主要厂商 API 均价下降约 40%…（略）",
                          input_tokens=2100, output_tokens=380,
                          started_at=s + timedelta(seconds=9), ended_at=e),
        ]))

    # 4. 失败的 trace（查看错误态样式）
    s, e = _ts(base, 1500, 2.1)
    ingest(db, project.id, IngestRequest(
        trace=TraceIn(id="demo-trace-failed", name="order-status-bot", status="error",
                      input={"order_id": "SO-99231"},
                      started_at=s, ended_at=e),
        observations=[
            ObservationIn(id="demo-f-llm1", type="llm", name="plan", seq=0,
                          model="gpt-4o-mini",
                          messages=[{"role": "user", "content": "查订单 SO-99231"}],
                          tool_calls=[{"id": "c1", "name": "query_order",
                                       "arguments": {"order_id": "SO-99231"}}],
                          tool_definitions=[{"type": "function", "function": {
                              "name": "query_order", "parameters": {}}}],
                          input_tokens=120, output_tokens=18,
                          started_at=s, ended_at=s + timedelta(seconds=0.9)),
            ObservationIn(id="demo-f-tool1", parent_id="demo-f-llm1", type="tool",
                          name="query_order", seq=1, status="error",
                          tool_input={"order_id": "SO-99231"},
                          error="upstream timeout: order-service 504 after 1200ms",
                          started_at=s + timedelta(seconds=0.9), ended_at=e),
        ]))

    # 5. 无工具的简单 trace（claude 定价无 provider——演示模型汇总与成本）
    s, e = _ts(base, 2100, 3.0)
    ingest(db, project.id, IngestRequest(
        trace=TraceIn(id="demo-trace-summarize", name="doc-summarizer",
                      input={"doc": "《季度舆情报告》全文…"},
                      output={"summary": "本季度品牌声量环比上升 12%…"},
                      started_at=s, ended_at=e),
        observations=[
            ObservationIn(id="demo-s-llm1", type="llm", name="summarize", seq=0,
                          model="claude-3-5-sonnet",
                          messages=[{"role": "user", "content": "总结这份报告：……"}],
                          completion="本季度品牌声量环比上升 12%…",
                          input_tokens=5200, output_tokens=260,
                          started_at=s, ended_at=e),
        ]))

    db.commit()
    print("5 条 live trace 已写入")


def seed_replay(db, project):
    """一条回放产出的 trace + 带 divergence 的 ReplayRun（查看回放历史/徽章样式）。"""
    base = utcnow() - timedelta(hours=1)
    s, e = _ts(base, 0, 5.5)
    ingest(db, project.id, IngestRequest(
        trace=TraceIn(id="demo-trace-weather-replay", name="weather-agent (replay)",
                      origin="replay",
                      input={"question": "北京今天适合骑车吗？"},
                      output={"answer": "北京今日晴朗，32 度，适合骑行。"},
                      started_at=s, ended_at=e,
                      metadata={"replay_run_id": "seeded", "source_trace_id": "demo-trace-weather"}),
        observations=[
            ObservationIn(id="demo-rp-llm1", type="llm", name="llm-step-0", seq=0,
                          model="gpt-4o-mini",
                          messages=[{"role": "system", "content": "你是天气助手，可调用工具查询天气。"},
                                    {"role": "user", "content": "北京今天适合骑车吗？"}],
                          tool_definitions=[{"type": "function", "function": {
                              "name": "get_weather", "parameters": {}}}],
                          tool_calls=[{"id": "c1", "name": "get_weather",
                                       "arguments": {"city": "北京，中国"}}],
                          input_tokens=298, output_tokens=25,
                          started_at=s, ended_at=s + timedelta(seconds=1.8)),
            ObservationIn(id="demo-rp-tool1", parent_id="demo-rp-llm1", type="tool",
                          name="get_weather", seq=1,
                          tool_input={"city": "北京，中国"},
                          tool_output={"weather": "晴", "temp_c": 32, "wind": "微风 2 级"},
                          metadata={"mocked": True, "recorded_input": {"city": "北京"}},
                          started_at=s + timedelta(seconds=1.8),
                          ended_at=s + timedelta(seconds=1.9)),
            ObservationIn(id="demo-rp-llm2", type="llm", name="llm-step-1", seq=2,
                          model="gpt-4o-mini",
                          messages=[{"role": "tool", "content": '{"weather": "晴"}'}],
                          completion="北京今日晴朗，32 度，适合骑行。",
                          input_tokens=390, output_tokens=32,
                          started_at=s + timedelta(seconds=1.9), ended_at=e),
        ]))
    if db.query(ReplayRun).filter(
            ReplayRun.source_trace_id == "demo-trace-weather").count() == 0:
        db.add(ReplayRun(
            project_id=project.id, source_trace_id="demo-trace-weather",
            result_trace_id="demo-trace-weather-replay",
            override_model="gpt-4o-mini", status="success",
            divergences=[{"type": "param_mismatch", "tool": "get_weather", "step": 0,
                          "recorded_input": {"city": "北京"},
                          "actual_input": {"city": "北京，中国"}}],
            finished_at=utcnow() - timedelta(minutes=55)))
        db.commit()
        print("回放 trace + ReplayRun（含 1 条参数偏离）已写入")


def seed_evaluations(db, project):
    if db.query(Evaluation).count() > 0:
        return
    db.add_all([
        Evaluation(project_id=project.id,
                   subject_trace_id="demo-trace-weather",
                   compare_trace_id="demo-trace-weather-cheap",
                   judge_model="gpt-4o", context_mode="output_only",
                   score=8.6, score_b=8.1, verdict="replaceable",
                   reasoning="两者对'是否适合骑车'的核心判断一致且均正确引用了工具返回的天气数据。"
                             "B 答案略简省了防晒提醒，信息完整度稍低，但不影响任务达成，"
                             "结合成本差异建议可替代。",
                   cost=0.00082),
        Evaluation(project_id=project.id,
                   subject_trace_id="demo-trace-weather",
                   compare_trace_id="demo-trace-weather-cheap",
                   judge_model="deepseek-chat", context_mode="output_only",
                   score=9.0, score_b=8.8, verdict="replaceable",
                   reasoning="两个回答语义等价，B 的表述更口语化。判定可替代。",
                   cost=0.00004),
        Evaluation(project_id=project.id,
                   subject_trace_id="demo-trace-research",
                   compare_trace_id=None,
                   judge_model="gpt-4o", context_mode="output_only",
                   score=7.2, verdict="pass",
                   reasoning="综合了检索结果并给出量化结论，但引用来源标注不完整。",
                   cost=0.0011),
    ])
    db.commit()
    print("3 条 evaluation（含一组双 judge 对比评分）已写入")


def main():
    Base.metadata.create_all(bind=engine)
    ensure_columns()
    db = SessionLocal()
    try:
        project = get_or_create_project(db, "demo")
        seed_providers_and_pricing(db, project)
        v1 = seed_prompts(db, project)
        seed_traces(db, project, v1)
        seed_replay(db, project)
        seed_evaluations(db, project)
        print("\n✅ mock 数据就绪。建议动线：/traces → 勾选两条 weather → 对比 → "
              "trace 详情看链路 → /prompts → /settings")
    finally:
        db.close()


if __name__ == "__main__":
    main()
