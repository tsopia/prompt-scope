"""把所有无 owner 的历史项目归给指定用户。用法：python -m scripts.backfill_owner <email>"""
import sys

from sqlalchemy.orm import Session

from db import Base, SessionLocal, engine
from models.entities import Project, ProjectMember, User


def backfill_owner(db: Session, email: str) -> int:
    user = db.query(User).filter(User.email == email.strip().lower()).first()
    if user is None:
        raise SystemExit(f"no user with email {email}; create it first")
    projects = db.query(Project).filter(Project.owner_id.is_(None)).all()
    for p in projects:
        p.owner_id = user.id
        already = db.query(ProjectMember).filter(
            ProjectMember.project_id == p.id,
            ProjectMember.user_id == user.id).first()
        if already is None:
            db.add(ProjectMember(project_id=p.id, user_id=user.id, role="owner"))
    db.commit()
    return len(projects)


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python -m scripts.backfill_owner <email>")
        sys.exit(1)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        n = backfill_owner(db, sys.argv[1])
        print(f"assigned {n} ownerless project(s) to {sys.argv[1]}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
