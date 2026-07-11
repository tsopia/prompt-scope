import json
import logging

import httpx
import pytest

from models.entities import ModelPricing, ModelProvider, Project, Trace
from services.summary_service import generate_trace_summary


@pytest.fixture()
def seeded(db_session):
    p = Project(name="demo", summary_model="summary-model")
    db_session.add(p)
    db_session.flush()
    provider = ModelProvider(project_id=p.id, name="oai",
                             base_url="https://api.test.com/v1",
                             api_key="sk-x", provider_type="openai")
    db_session.add(provider)
    db_session.flush()
    db_session.add(ModelPricing(project_id=p.id, model="summary-model",
                                input_price_per_1k=0.001,
                                output_price_per_1k=0.002,
                                provider_id=provider.id))
    t = Trace(id="tr-1", project_id=p.id, name="run",
              input={"query": "北京天气如何"}, output={"answer": "晴，32度"})
    db_session.add(t)
    db_session.commit()
    return p, t


def _client(content: str):
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": content}}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 10}})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_generate_trace_summary_writes_summary(db_session, seeded, monkeypatch):
    import services.summary_service as summary_service

    def fake_chat_completion(provider, model, messages, model_params=None, client=None):
        assert model_params == {"max_tokens": 80}
        return {"content": "  查询了北京天气并回答晴天32度。  ", "input_tokens": 20,
                "output_tokens": 10}

    monkeypatch.setattr(summary_service, "chat_completion", fake_chat_completion)
    generate_trace_summary(db_session, "tr-1")
    trace = db_session.get(Trace, "tr-1")
    assert trace.summary == "查询了北京天气并回答晴天32度。"


def test_generate_trace_summary_no_model_configured_skips(db_session, monkeypatch):
    p = Project(name="no-summary")
    db_session.add(p)
    db_session.flush()
    t = Trace(id="tr-2", project_id=p.id, name="run", input={"q": "x"}, output={"a": "y"})
    db_session.add(t)
    db_session.commit()

    called = {"n": 0}
    import services.summary_service as summary_service

    def fake_chat_completion(*a, **kw):
        called["n"] += 1
        return {"content": "x", "input_tokens": 1, "output_tokens": 1}

    monkeypatch.setattr(summary_service, "chat_completion", fake_chat_completion)
    generate_trace_summary(db_session, "tr-2")
    assert called["n"] == 0
    assert db_session.get(Trace, "tr-2").summary is None


def test_generate_trace_summary_idempotent_skips_existing(db_session, seeded, monkeypatch):
    project, trace = seeded
    trace.summary = "已经有摘要了"
    db_session.commit()

    called = {"n": 0}
    import services.summary_service as summary_service

    def fake_chat_completion(*a, **kw):
        called["n"] += 1
        return {"content": "new summary", "input_tokens": 1, "output_tokens": 1}

    monkeypatch.setattr(summary_service, "chat_completion", fake_chat_completion)
    generate_trace_summary(db_session, "tr-1")
    assert called["n"] == 0
    assert db_session.get(Trace, "tr-1").summary == "已经有摘要了"


def test_generate_trace_summary_provider_error_logs_warning_no_raise(
        db_session, seeded, caplog):
    import services.summary_service as summary_service

    def raising_chat_completion(*a, **kw):
        raise RuntimeError("provider boom")

    with caplog.at_level(logging.WARNING):
        original = summary_service.chat_completion
        summary_service.chat_completion = raising_chat_completion
        try:
            generate_trace_summary(db_session, "tr-1")
        finally:
            summary_service.chat_completion = original

    trace = db_session.get(Trace, "tr-1")
    assert trace.summary is None
    assert any("tr-1" in r.message and "provider boom" in r.message
              for r in caplog.records)


def test_generate_trace_summary_unknown_trace_is_noop(db_session):
    generate_trace_summary(db_session, "does-not-exist")  # should not raise
