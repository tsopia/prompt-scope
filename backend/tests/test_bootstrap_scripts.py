from models.entities import User, Project, ProjectMember
from scripts.create_user import create_user
from scripts.backfill_owner import backfill_owner


def test_create_user_idempotent(db_session):
    u1 = create_user(db_session, "boot@x.com", "pw123456", "Boot")
    u2 = create_user(db_session, "boot@x.com", "pw123456", "Boot")
    assert u1.id == u2.id
    assert db_session.query(User).count() == 1


def test_backfill_owner_assigns_ownerless_projects(db_session):
    db_session.add_all([Project(name="legacy-a"), Project(name="legacy-b")])
    db_session.commit()
    u = create_user(db_session, "boot@x.com", "pw123456", "Boot")
    n = backfill_owner(db_session, "boot@x.com")
    assert n == 2
    assert db_session.query(Project).filter(
        Project.owner_id == u.id).count() == 2
    assert db_session.query(ProjectMember).filter(
        ProjectMember.role == "owner").count() == 2
