import pytest
from fastapi import HTTPException

from models.entities import User, Project, ProjectMember, Trace
from services.authz import (
    member_project_ids, assert_member, assert_owner, assert_trace_access)


def _seed(db):
    owner = User(email="o@x.com", display_name="O", auth_source="local")
    other = User(email="e@x.com", display_name="E", auth_source="local")
    db.add_all([owner, other])
    db.flush()
    p = Project(name="grp", owner_id=owner.id)
    db.add(p)
    db.flush()
    db.add(ProjectMember(project_id=p.id, user_id=owner.id, role="owner"))
    db.commit()
    return owner, other, p


def test_member_project_ids(db_session):
    owner, other, p = _seed(db_session)
    assert member_project_ids(db_session, owner) == [p.id]
    assert member_project_ids(db_session, other) == []


def test_assert_member_and_owner(db_session):
    owner, other, p = _seed(db_session)
    assert assert_member(db_session, owner, p.id).role == "owner"
    with pytest.raises(HTTPException) as e1:
        assert_member(db_session, other, p.id)
    assert e1.value.status_code == 403
    with pytest.raises(HTTPException) as e2:
        assert_member(db_session, owner, "missing")
    assert e2.value.status_code == 404
    assert assert_owner(db_session, owner, p.id).role == "owner"


def test_assert_trace_access(db_session):
    owner, other, p = _seed(db_session)
    db_session.add(Trace(id="t1", project_id=p.id, name="t"))
    db_session.commit()
    assert assert_trace_access(db_session, owner, "t1").id == "t1"
    with pytest.raises(HTTPException) as e1:
        assert_trace_access(db_session, other, "t1")
    assert e1.value.status_code == 403
    with pytest.raises(HTTPException) as e2:
        assert_trace_access(db_session, owner, "missing")
    assert e2.value.status_code == 404
