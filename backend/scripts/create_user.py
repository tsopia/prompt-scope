"""创建本地登录用户。用法：python -m scripts.create_user <email> <password> [display_name]"""
import sys

from sqlalchemy.orm import Session

from db import Base, SessionLocal, engine
from models.entities import User
from services.passwords import hash_password


def create_user(db: Session, email: str, password: str,
                display_name: str = "") -> User:
    email = email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(email=email, display_name=display_name or email,
                    auth_source="local", password_hash=hash_password(password))
        db.add(user)
        db.commit()
    return user


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: python -m scripts.create_user <email> <password> [display_name]")
        sys.exit(1)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        u = create_user(db, sys.argv[1], sys.argv[2],
                        sys.argv[3] if len(sys.argv) > 3 else "")
        print(f"user: {u.email} ({u.id})")
    finally:
        db.close()


if __name__ == "__main__":
    main()
