import pytest
from fastapi import HTTPException

from models.entities import ModelPricing, ModelProvider, Project
from services.providers import resolve_provider


def test_resolve_provider_success(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    provider = ModelProvider(project_id=p.id, name="oai", base_url="u",
                             api_key="k", provider_type="openai")
    db_session.add(provider)
    db_session.flush()
    db_session.add(ModelPricing(project_id=p.id, model="m1", input_price_per_1k=1,
                                output_price_per_1k=1, provider_id=provider.id))
    db_session.commit()
    assert resolve_provider(db_session, "m1", p.id).id == provider.id


def test_resolve_provider_unconfigured_400(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.commit()
    with pytest.raises(HTTPException) as exc:
        resolve_provider(db_session, "nope", p.id)
    assert exc.value.status_code == 400


def test_resolve_provider_scoped_to_project(db_session):
    """A pricing row in project A must not resolve for project B, even with
    the same model name."""
    a = Project(name="a")
    b = Project(name="b")
    db_session.add_all([a, b])
    db_session.flush()
    provider = ModelProvider(project_id=a.id, name="oai", base_url="u",
                             api_key="k", provider_type="openai")
    db_session.add(provider)
    db_session.flush()
    db_session.add(ModelPricing(project_id=a.id, model="shared-model",
                                input_price_per_1k=1, output_price_per_1k=1,
                                provider_id=provider.id))
    db_session.commit()

    assert resolve_provider(db_session, "shared-model", a.id).id == provider.id
    with pytest.raises(HTTPException) as exc:
        resolve_provider(db_session, "shared-model", b.id)
    assert exc.value.status_code == 400
