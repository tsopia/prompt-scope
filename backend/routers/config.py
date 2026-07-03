from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ModelPricing, ModelProvider
from schemas.config import JudgeModelOut, PricingIn, PricingOut, ProviderIn, ProviderOut

router = APIRouter(tags=["config"])


def _provider_out(p: ModelProvider) -> ProviderOut:
    return ProviderOut(id=p.id, name=p.name, base_url=p.base_url,
                       provider_type=p.provider_type,
                       api_key_set=bool(p.api_key), created_at=p.created_at)


def _pricing_out(r: ModelPricing) -> PricingOut:
    return PricingOut(id=r.id, model=r.model,
                      input_price_per_1k=r.input_price_per_1k,
                      output_price_per_1k=r.output_price_per_1k,
                      provider_id=r.provider_id)


@router.get("/providers", response_model=list[ProviderOut])
def list_providers(db: Session = Depends(get_db)):
    return [_provider_out(p) for p in
            db.query(ModelProvider).order_by(ModelProvider.created_at).all()]


@router.post("/providers", response_model=ProviderOut)
def create_provider(payload: ProviderIn, db: Session = Depends(get_db)):
    if db.query(ModelProvider).filter(ModelProvider.name == payload.name).first():
        raise HTTPException(status_code=409, detail="provider name already exists")
    p = ModelProvider(name=payload.name, base_url=payload.base_url,
                      api_key=payload.api_key or "",
                      provider_type=payload.provider_type)
    db.add(p)
    db.commit()
    return _provider_out(p)


@router.put("/providers/{provider_id}", response_model=ProviderOut)
def update_provider(provider_id: str, payload: ProviderIn,
                    db: Session = Depends(get_db)):
    p = db.get(ModelProvider, provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail="provider not found")
    p.name = payload.name
    p.base_url = payload.base_url
    p.provider_type = payload.provider_type
    if payload.api_key:
        p.api_key = payload.api_key
    db.commit()
    return _provider_out(p)


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: str, db: Session = Depends(get_db)):
    p = db.get(ModelProvider, provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail="provider not found")
    for pricing in db.query(ModelPricing).filter(
            ModelPricing.provider_id == provider_id).all():
        pricing.provider_id = None
    db.delete(p)
    db.commit()
    return {"deleted": True}


@router.get("/pricing", response_model=list[PricingOut])
def list_pricing(db: Session = Depends(get_db)):
    return [_pricing_out(r) for r in
            db.query(ModelPricing).order_by(ModelPricing.model).all()]


@router.post("/pricing", response_model=PricingOut)
def create_pricing(payload: PricingIn, db: Session = Depends(get_db)):
    if db.query(ModelPricing).filter(ModelPricing.model == payload.model).first():
        raise HTTPException(status_code=409, detail="model pricing already exists")
    r = ModelPricing(model=payload.model,
                     input_price_per_1k=payload.input_price_per_1k,
                     output_price_per_1k=payload.output_price_per_1k,
                     provider_id=payload.provider_id)
    db.add(r)
    db.commit()
    return _pricing_out(r)


@router.put("/pricing/{pricing_id}", response_model=PricingOut)
def update_pricing(pricing_id: str, payload: PricingIn,
                   db: Session = Depends(get_db)):
    r = db.get(ModelPricing, pricing_id)
    if r is None:
        raise HTTPException(status_code=404, detail="pricing not found")
    r.model = payload.model
    r.input_price_per_1k = payload.input_price_per_1k
    r.output_price_per_1k = payload.output_price_per_1k
    r.provider_id = payload.provider_id
    db.commit()
    return _pricing_out(r)


@router.delete("/pricing/{pricing_id}")
def delete_pricing(pricing_id: str, db: Session = Depends(get_db)):
    r = db.get(ModelPricing, pricing_id)
    if r is None:
        raise HTTPException(status_code=404, detail="pricing not found")
    db.delete(r)
    db.commit()
    return {"deleted": True}


@router.get("/judge-models", response_model=list[JudgeModelOut])
def list_judge_models(db: Session = Depends(get_db)):
    rows = (db.query(ModelPricing, ModelProvider)
            .join(ModelProvider, ModelPricing.provider_id == ModelProvider.id)
            .order_by(ModelPricing.model).all())
    return [JudgeModelOut(model=pricing.model, provider_name=provider.name)
            for pricing, provider in rows]
