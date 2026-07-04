from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.orm import Session

from models.entities import User
from services.passwords import verify_password


@dataclass
class UserIdentity:
    email: str
    display_name: str
    auth_source: str
    external_id: str | None


class AuthProvider(Protocol):
    def authenticate(self, db: Session, credentials: dict) -> UserIdentity | None:
        ...


class LocalPasswordProvider:
    """Verifies email+password against local users. Future SSO providers
    (OIDCProvider, LDAPProvider) implement the same authenticate() signature
    and return a UserIdentity; get_or_create_user() JIT-provisions them."""

    def authenticate(self, db: Session, credentials: dict) -> UserIdentity | None:
        email = (credentials.get("email") or "").strip().lower()
        password = credentials.get("password") or ""
        user = db.query(User).filter(
            User.email == email, User.auth_source == "local").first()
        if user is None or not user.password_hash or not user.is_active:
            return None
        if not verify_password(password, user.password_hash):
            return None
        return UserIdentity(email=user.email, display_name=user.display_name,
                            auth_source="local", external_id=None)


def get_or_create_user(db: Session, identity: UserIdentity) -> User | None:
    """Resolve a UserIdentity to a persisted User.

    - local: look up by (email, auth_source); NEVER create here (registration
      owns local user creation). Returns None if not found.
    - sso (oidc/ldap): look up by (auth_source, external_id); JIT-create if
      absent. Returns the User.
    """
    if identity.auth_source == "local":
        return db.query(User).filter(
            User.email == identity.email,
            User.auth_source == "local").first()

    user = db.query(User).filter(
        User.auth_source == identity.auth_source,
        User.external_id == identity.external_id).first()
    if user is None:
        user = User(email=identity.email, display_name=identity.display_name,
                    auth_source=identity.auth_source,
                    external_id=identity.external_id, password_hash=None)
        db.add(user)
        db.commit()
    return user
