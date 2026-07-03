from models.entities import (
    ApiKey, Evaluation, ModelPricing, ModelProvider, Observation,
    Project, Prompt, PromptVersion, ReplayRun, Trace,
)


def test_create_project_with_api_key(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    k = ApiKey(project_id=p.id, key_hash="h" * 64, prefix="ps-abcd")
    db_session.add(k)
    db_session.commit()
    assert p.id and len(p.id) == 32
    assert k.project.name == "demo"


def test_trace_observation_tree(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    t = Trace(id="tr1", project_id=p.id, name="run", origin="live")
    root = Observation(id="ob1", trace_id="tr1", type="llm", name="agent-loop",
                       model="gpt-4o", messages=[{"role": "user", "content": "hi"}], seq=0)
    child = Observation(id="ob2", trace_id="tr1", parent_id="ob1", type="tool",
                        name="search", tool_input={"q": "x"}, tool_output={"r": 1}, seq=1)
    db_session.add_all([t, root, child])
    db_session.commit()
    assert t.observations[0].id == "ob1"
    assert t.observations[1].parent_id == "ob1"
    assert t.observations[0].messages[0]["role"] == "user"


def test_replay_and_evaluation_tables(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    t = Trace(id="tr1", project_id=p.id, name="run")
    db_session.add(t)
    db_session.flush()
    r = ReplayRun(project_id=p.id, source_trace_id="tr1", override_model="deepseek-chat",
                  status="pending", divergences=[])
    e = Evaluation(project_id=p.id, subject_trace_id="tr1", judge_model="gpt-4o",
                   context_mode="output_only", score=8.5, verdict="pass", reasoning="ok")
    db_session.add_all([r, e])
    db_session.commit()
    assert r.id and e.id


def test_prompt_versions_and_pricing(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    pr = Prompt(project_id=p.id, name="qa-bot")
    db_session.add(pr)
    db_session.flush()
    v = PromptVersion(prompt_id=pr.id, version=1, content="You are a bot.")
    provider = ModelProvider(name="openai", base_url="https://api.openai.com/v1",
                             api_key="sk-x", provider_type="openai")
    db_session.add_all([v, provider])
    db_session.flush()
    price = ModelPricing(model="gpt-4o", input_price_per_1k=0.005,
                         output_price_per_1k=0.015, provider_id=provider.id)
    db_session.add(price)
    db_session.commit()
    assert v.prompt.name == "qa-bot"
    assert price.input_price_per_1k == 0.005
