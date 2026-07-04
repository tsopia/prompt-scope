from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from config import (AUTH_ALLOW_REGISTRATION, SECURE_COOKIES,
                    SESSION_COOKIE_NAME, SESSION_TTL_DAYS)
from db import get_db
from models.entities import User
from schemas.auth import AuthConfigOut, LoginIn, RegisterIn, UserOut
from services.auth_providers import LocalPasswordProvider
from services.authz import get_current_user
from services.passwords import hash_password
from services.sessions import create_session, delete_session

router = APIRouter(prefix="/auth", tags=["auth"])

_MAX_AGE = SESSION_TTL_DAYS * 24 * 3600


def _set_cookie(resp: Response, raw: str) -> None:
    resp.set_cookie(
        SESSION_COOKIE_NAME, raw, max_age=_MAX_AGE, httponly=True,
        samesite="lax", secure=SECURE_COOKIES, path="/")


@router.get("/config", response_model=AuthConfigOut)
def auth_config():
    return AuthConfigOut(allow_registration=AUTH_ALLOW_REGISTRATION)


@router.post("/register", response_model=UserOut)
def register(payload: RegisterIn, response: Response,
             db: Session = Depends(get_db)):
    if not AUTH_ALLOW_REGISTRATION:
        raise HTTPException(status_code=403, detail="registration disabled")
    email = payload.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="email already registered")
    user = User(email=email, display_name=payload.display_name or email,
                auth_source="local", password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    _set_cookie(response, create_session(db, user.id))
    return user


@router.post("/login", response_model=UserOut)
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)):
    identity = LocalPasswordProvider().authenticate(
        db, {"email": payload.email, "password": payload.password})
    if identity is None:
        raise HTTPException(status_code=401, detail="invalid email or password")
    user = db.query(User).filter(
        User.email == identity.email, User.auth_source == "local").first()
    _set_cookie(response, create_session(db, user.id))
    return user


@router.post("/logout")
def logout(response: Response,
           ps_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
           db: Session = Depends(get_db)):
    if ps_session:
        delete_session(db, ps_session)
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"logged_out": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
