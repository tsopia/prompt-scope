"""一次性迁移：把全局的 ModelProvider / ModelPricing 归到某个 project 下。
用法：python -m scripts.migrate_provider_project <owner_email>

背景：ModelProvider / ModelPricing 原本是全局表（登录用户共享一份），现在改为
按 project 隔离（project_id + UniqueConstraint("project_id", "name"/"model")）。
`create_all` 不会修改已存在表的 UNIQUE 约束，所以已经跑起来的库（dev/prod）需要
这个脚本手动迁移一次；全新的库直接由 create_all 建出新 schema，不需要跑这个脚本。

做法：读出所有旧数据 -> 整表 drop -> create_all 用新 schema 重建 -> 写回，
project_id 取该用户最早创建/加入的项目。sqlite 和 postgres 通用。
"""
import sys

from sqlalchemy.orm import Session

from db import Base, SessionLocal, engine
from models.entities import ModelPricing, ModelProvider, Project, ProjectMember, User


def _resolve_project_id(db: Session, email: str) -> str:
    user = db.query(User).filter(User.email == email.strip().lower()).first()
    if user is None:
        raise ValueError(f"no user with email {email}; create it first")
    project = (db.query(Project)
              .join(ProjectMember, ProjectMember.project_id == Project.id)
              .filter(ProjectMember.user_id == user.id)
              .order_by(Project.created_at)
              .first())
    if project is None:
        raise ValueError(f"user {email} is not a member of any project")
    return project.id


def _row_to_dict(row, columns) -> dict:
    return {col.name: getattr(row, col.name) for col in columns}


def migrate_provider_project(db: Session, owner_email: str) -> int:
    project_id = _resolve_project_id(db, owner_email)

    provider_cols = ModelProvider.__table__.columns
    pricing_cols = ModelPricing.__table__.columns
    providers = [_row_to_dict(p, provider_cols)
                for p in db.query(ModelProvider).all()]
    pricings = [_row_to_dict(r, pricing_cols)
               for r in db.query(ModelPricing).all()]
    # 读出来之后立刻把这些行从 session 的 identity map 中摘除——
    # 否则 drop+create_all 后用相同主键重新 add() 会和陈旧的持久化实例冲突。
    db.expunge_all()

    bind = db.get_bind()
    # pricing 先 drop（FK 指向 provider），provider 后 drop；
    # create_all 用新 schema（含 project_id + 新 UniqueConstraint）重建两张表。
    ModelPricing.__table__.drop(bind=bind, checkfirst=True)
    ModelProvider.__table__.drop(bind=bind, checkfirst=True)
    Base.metadata.create_all(bind=bind)

    for row in providers:
        if row.get("project_id") is None:
            row["project_id"] = project_id
        db.add(ModelProvider(**row))
    db.flush()
    for row in pricings:
        if row.get("project_id") is None:
            row["project_id"] = project_id
        db.add(ModelPricing(**row))
    db.commit()

    return len(providers) + len(pricings)


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python -m scripts.migrate_provider_project <owner_email>")
        sys.exit(1)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        try:
            n = migrate_provider_project(db, sys.argv[1])
        except ValueError as e:
            print(e)
            sys.exit(1)
        else:
            print(f"migrated {n} row(s) (providers + pricing) to project owned by {sys.argv[1]}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
