import pytest
from fastapi import HTTPException

from models.entities import ModelPricing, ModelProvider
from services.providers import resolve_provider


def test_resolve_provider_success(db_session):
    p = ModelProvider(name="oai", base_url="u", api_key="k", provider_type="openai")
    db_session.add(p)
    db_session.flush()
    db_session.add(ModelPricing(model="m1", input_price_per_1k=1,
                                output_price_per_1k=1, provider_id=p.id))
    db_session.commit()
    assert resolve_provider(db_session, "m1").id == p.id


def test_resolve_provider_unconfigured_400(db_session):
    with pytest.raises(HTTPException) as exc:
        resolve_provider(db_session, "nope")
    assert exc.value.status_code == 400
