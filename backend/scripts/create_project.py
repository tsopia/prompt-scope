"""创建项目并签发 API Key。用法：python -m scripts.create_project <项目名>"""
import sys

from db import Base, SessionLocal, engine
from models.entities import ApiKey, Project
from services.auth import generate_api_key


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python -m scripts.create_project <name>")
        sys.exit(1)
    name = sys.argv[1]
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.name == name).first()
        if project is None:
            project = Project(name=name)
            db.add(project)
            db.flush()
        raw, key_hash, prefix = generate_api_key()
        db.add(ApiKey(project_id=project.id, key_hash=key_hash, prefix=prefix))
        db.commit()
        print(f"project: {project.name} ({project.id})")
        print(f"api key (save it now, shown only once): {raw}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
