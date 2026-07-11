from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ModelPricing, ModelProvider, User
from schemas.config import JudgeModelOut, PricingIn, PricingOut, ProviderIn, ProviderOut
from services.authz import assert_member, get_current_user
from services.crypto import encrypt_secret

router = APIRouter(tags=["config"])


def _provider_out(p: ModelProvider) -> ProviderOut:
    return ProviderOut(id=p.id, project_id=p.project_id, name=p.name,
                       base_url=p.base_url, provider_type=p.provider_type,
                       kind=p.kind, note=p.note,
                       api_key_set=bool(p.api_key), created_at=p.created_at)


def _pricing_out(r: ModelPricing) -> PricingOut:
    return PricingOut(id=r.id, project_id=r.project_id, model=r.model,
                      input_price_per_1k=r.input_price_per_1k,
                      output_price_per_1k=r.output_price_per_1k,
                      provider_id=r.provider_id)


@router.get("/providers", response_model=list[ProviderOut])
def list_providers(project_id: str, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    assert_member(db, user, project_id)
    return [_provider_out(p) for p in
            db.query(ModelProvider).filter(ModelProvider.project_id == project_id)
            .order_by(ModelProvider.created_at).all()]


@router.post("/providers", response_model=ProviderOut)
def create_provider(payload: ProviderIn, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    assert_member(db, user, payload.project_id)
    if db.query(ModelProvider).filter(
            ModelProvider.project_id == payload.project_id,
            ModelProvider.name == payload.name).first():
        raise HTTPException(status_code=409, detail="provider name already exists")
    p = ModelProvider(project_id=payload.project_id, name=payload.name,
                      base_url=payload.base_url,
                      api_key=encrypt_secret(payload.api_key or ""),
                      provider_type=payload.provider_type,
                      kind=payload.kind, note=payload.note)
    db.add(p)
    db.commit()
    return _provider_out(p)


@router.put("/providers/{provider_id}", response_model=ProviderOut)
def update_provider(provider_id: str, payload: ProviderIn,
                    db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    p = db.get(ModelProvider, provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail="provider not found")
    assert_member(db, user, p.project_id)
    if payload.name != p.name and db.query(ModelProvider).filter(
            ModelProvider.project_id == p.project_id,
            ModelProvider.name == payload.name).first():
        raise HTTPException(status_code=409, detail="provider name already exists")
    p.name = payload.name
    p.base_url = payload.base_url
    p.provider_type = payload.provider_type
    p.kind = payload.kind
    p.note = payload.note
    if payload.api_key:
        p.api_key = encrypt_secret(payload.api_key)
    db.commit()
    return _provider_out(p)


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: str, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    p = db.get(ModelProvider, provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail="provider not found")
    assert_member(db, user, p.project_id)
    for pricing in db.query(ModelPricing).filter(
            ModelPricing.provider_id == provider_id,
            ModelPricing.project_id == p.project_id).all():
        pricing.provider_id = None
    db.delete(p)
    db.commit()
    return {"deleted": True}


@router.get("/pricing", response_model=list[PricingOut])
def list_pricing(project_id: str, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    assert_member(db, user, project_id)
    return [_pricing_out(r) for r in
            db.query(ModelPricing).filter(ModelPricing.project_id == project_id)
            .order_by(ModelPricing.model).all()]


@router.post("/pricing", response_model=PricingOut)
def create_pricing(payload: PricingIn, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    assert_member(db, user, payload.project_id)
    if db.query(ModelPricing).filter(
            ModelPricing.project_id == payload.project_id,
            ModelPricing.model == payload.model).first():
        raise HTTPException(status_code=409, detail="model pricing already exists")
    if payload.provider_id is not None:
        prov = db.get(ModelProvider, payload.provider_id)
        if prov is None or prov.project_id != payload.project_id:
            raise HTTPException(status_code=400, detail="provider_id 不属于该 project")
    r = ModelPricing(project_id=payload.project_id, model=payload.model,
                     input_price_per_1k=payload.input_price_per_1k,
                     output_price_per_1k=payload.output_price_per_1k,
                     provider_id=payload.provider_id)
    db.add(r)
    db.commit()
    return _pricing_out(r)


@router.put("/pricing/{pricing_id}", response_model=PricingOut)
def update_pricing(pricing_id: str, payload: PricingIn,
                   db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    r = db.get(ModelPricing, pricing_id)
    if r is None:
        raise HTTPException(status_code=404, detail="pricing not found")
    assert_member(db, user, r.project_id)
    if payload.model != r.model and db.query(ModelPricing).filter(
            ModelPricing.project_id == r.project_id,
            ModelPricing.model == payload.model).first():
        raise HTTPException(status_code=409, detail="model pricing already exists")
    if payload.provider_id is not None:
        prov = db.get(ModelProvider, payload.provider_id)
        if prov is None or prov.project_id != r.project_id:
            raise HTTPException(status_code=400, detail="provider_id 不属于该 project")
    r.model = payload.model
    r.input_price_per_1k = payload.input_price_per_1k
    r.output_price_per_1k = payload.output_price_per_1k
    r.provider_id = payload.provider_id
    db.commit()
    return _pricing_out(r)


@router.delete("/pricing/{pricing_id}")
def delete_pricing(pricing_id: str, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    r = db.get(ModelPricing, pricing_id)
    if r is None:
        raise HTTPException(status_code=404, detail="pricing not found")
    assert_member(db, user, r.project_id)
    db.delete(r)
    db.commit()
    return {"deleted": True}


@router.get("/judge-models", response_model=list[JudgeModelOut])
def list_judge_models(project_id: str, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    assert_member(db, user, project_id)
    rows = (db.query(ModelPricing, ModelProvider)
            .join(ModelProvider, ModelPricing.provider_id == ModelProvider.id)
            .filter(ModelPricing.project_id == project_id)
            .order_by(ModelPricing.model).all())
    return [JudgeModelOut(model=pricing.model, provider_name=provider.name)
            for pricing, provider in rows]
