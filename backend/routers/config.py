from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ModelPricing, ModelProvider, User
from schemas.config import JudgeModelOut, PricingIn, PricingOut, ProviderIn, ProviderOut
from services.authz import assert_member, assert_resource_manager, get_current_user
from services.crypto import encrypt_secret

router = APIRouter(tags=["config"])


def _creator_names(db: Session, created_by_ids: set[str]) -> dict[str, str]:
    """Batched creator-id -> display_name lookup, one `in_` query regardless
    of how many rows are being rendered (avoids N+1 in list endpoints)."""
    ids = {cid for cid in created_by_ids if cid}
    if not ids:
        return {}
    return dict(db.query(User.id, User.display_name).filter(User.id.in_(ids)).all())


def _provider_out(p: ModelProvider, creator_names: dict[str, str]) -> ProviderOut:
    return ProviderOut(id=p.id, project_id=p.project_id, name=p.name,
                       base_url=p.base_url, provider_type=p.provider_type,
                       kind=p.kind, note=p.note,
                       api_key_set=bool(p.api_key), created_at=p.created_at,
                       created_by=p.created_by,
                       created_by_name=creator_names.get(p.created_by))


def _pricing_out(r: ModelPricing, creator_names: dict[str, str]) -> PricingOut:
    return PricingOut(id=r.id, project_id=r.project_id, model=r.model,
                      input_price_per_1k=r.input_price_per_1k,
                      output_price_per_1k=r.output_price_per_1k,
                      provider_id=r.provider_id,
                      created_by=r.created_by,
                      created_by_name=creator_names.get(r.created_by))


@router.get("/providers", response_model=list[ProviderOut])
def list_providers(project_id: str, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    assert_member(db, user, project_id)
    rows = (db.query(ModelProvider).filter(ModelProvider.project_id == project_id)
            .order_by(ModelProvider.created_at).all())
    names = _creator_names(db, {p.created_by for p in rows})
    return [_provider_out(p, names) for p in rows]


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
                      kind=payload.kind, note=payload.note,
                      created_by=user.id)
    db.add(p)
    db.commit()
    return _provider_out(p, _creator_names(db, {user.id}))


@router.put("/providers/{provider_id}", response_model=ProviderOut)
def update_provider(provider_id: str, payload: ProviderIn,
                    db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    p = db.get(ModelProvider, provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail="provider not found")
    assert_resource_manager(db, user, p.project_id, p.created_by)
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
    return _provider_out(p, _creator_names(db, {p.created_by}))


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: str, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    p = db.get(ModelProvider, provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail="provider not found")
    assert_resource_manager(db, user, p.project_id, p.created_by)
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
    rows = (db.query(ModelPricing).filter(ModelPricing.project_id == project_id)
            .order_by(ModelPricing.model).all())
    names = _creator_names(db, {r.created_by for r in rows})
    return [_pricing_out(r, names) for r in rows]


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
                     provider_id=payload.provider_id,
                     created_by=user.id)
    db.add(r)
    db.commit()
    return _pricing_out(r, _creator_names(db, {user.id}))


@router.put("/pricing/{pricing_id}", response_model=PricingOut)
def update_pricing(pricing_id: str, payload: PricingIn,
                   db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    r = db.get(ModelPricing, pricing_id)
    if r is None:
        raise HTTPException(status_code=404, detail="pricing not found")
    assert_resource_manager(db, user, r.project_id, r.created_by)
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
    return _pricing_out(r, _creator_names(db, {r.created_by}))


@router.delete("/pricing/{pricing_id}")
def delete_pricing(pricing_id: str, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    r = db.get(ModelPricing, pricing_id)
    if r is None:
        raise HTTPException(status_code=404, detail="pricing not found")
    assert_resource_manager(db, user, r.project_id, r.created_by)
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
