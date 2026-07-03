from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.entities import ModelPricing, ModelProvider


def resolve_provider(db: Session, model: str) -> ModelProvider:
    pricing = db.query(ModelPricing).filter(
        ModelPricing.model == model).first()
    if pricing is None or pricing.provider_id is None:
        raise HTTPException(status_code=400,
                            detail=f"model 未配置 provider: {model}")
    provider = db.get(ModelProvider, pricing.provider_id)
    if provider is None:
        raise HTTPException(status_code=400,
                            detail=f"model 的 provider 不存在: {model}")
    return provider
