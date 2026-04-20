"""
Tests for POST /scripts/{script_id}/ingest-json
Run from engine dir: pytest tests/test_ingest_json.py -v
"""
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, select

from models import Project, ProjectMember, Scene, Script


_ENGINE = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@pytest.fixture(scope="session", autouse=True)
def _create_tables():
    SQLModel.metadata.create_all(_ENGINE)


@pytest.fixture
def db():
    with Session(_ENGINE) as session:
        yield session
        session.rollback()


def _mock_auth(user_id="test-user"):
    m = MagicMock()
    m.get_user_id.return_value = user_id
    return m


def _seed_script(db: Session, user_id="test-user") -> Script:
    project = Project(name="Test Project", owner_id=user_id)
    db.add(project)
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=user_id, role="owner"))
    db.flush()
    script = Script(
        project_id=project.id,
        user_id=user_id,
        name="Test Script",
        file_path=f"{user_id}/{project.id}/test/script.json",
    )
    db.add(script)
    db.commit()
    db.refresh(script)
    return script


def _two_scene_elements():
    return [
        {
            "type": "scene_heading",
            "text": "INT. OFFICE - DAY",
            "scene_number": 1,
            "page": 1,
            "eighths": 4,
            "int_ext": "INT",
            "location": "OFFICE",
            "sub_location": None,
            "time_of_day": "day",
            "characters": ["ALICE", "BOB"],
        },
        {"type": "action", "text": "Desks everywhere."},
        {
            "type": "scene_heading",
            "text": "EXT. PARK - NIGHT",
            "scene_number": 2,
            "page": 2,
            "eighths": 3,
            "int_ext": "EXT",
            "location": "PARK",
            "sub_location": "South Entrance",
            "time_of_day": "night",
            "characters": ["CAROL"],
        },
    ]


# ─── (c) schema_version validation ───────────────────────────────────────────

def test_wrong_schema_version_returns_400():
    import scripts as scripts_module

    body = scripts_module.IngestJsonBody(schema_version="1.0", elements=[])
    with pytest.raises(HTTPException) as exc_info:
        scripts_module.ingest_script_json(
            script_id=str(uuid.uuid4()),
            body=body,
            session=_mock_auth(),
            db=MagicMock(),
        )
    assert exc_info.value.status_code == 400


def test_empty_schema_version_returns_400():
    import scripts as scripts_module

    body = scripts_module.IngestJsonBody(schema_version="", elements=[])
    with pytest.raises(HTTPException) as exc_info:
        scripts_module.ingest_script_json(
            script_id=str(uuid.uuid4()),
            body=body,
            session=_mock_auth(),
            db=MagicMock(),
        )
    assert exc_info.value.status_code == 400


# ─── (a) valid ingest with 2 scene headings ──────────────────────────────────

def test_ingest_two_scenes_populates_correctly(db):
    import scripts as scripts_module

    script = _seed_script(db)
    body = scripts_module.IngestJsonBody(
        schema_version="2.0",
        elements=_two_scene_elements(),
    )

    with patch("scripts._get_or_create_chat", return_value="test-chat-id"):
        result = scripts_module.ingest_script_json(
            script_id=str(script.id),
            body=body,
            session=_mock_auth(script.user_id),
            db=db,
        )

    assert result.scenes_upserted == 2
    assert result.script_id == str(script.id)
    assert result.chat_id == "test-chat-id"

    scenes = list(
        db.exec(
            select(Scene)
            .where(Scene.script_id == script.id)
            .order_by(Scene.scene_number.asc())
        ).all()
    )
    assert len(scenes) == 2

    s1 = scenes[0]
    assert s1.heading == "INT. OFFICE - DAY"
    assert s1.scene_number == 1
    assert s1.scene_location == "OFFICE"
    assert s1.location_type == "INT"
    assert s1.is_night_shoot is False
    assert s1.time_of_day_id == "day"
    assert s1.length_in_eighths == 4

    s2 = scenes[1]
    assert s2.heading == "EXT. PARK - NIGHT"
    assert s2.scene_number == 2
    assert s2.is_night_shoot is True
    assert s2.scene_location == "PARK"
    assert s2.location_details == "South Entrance"
    assert s2.time_of_day_id == "night"


# ─── (b) re-ingest is idempotent; protected fields unchanged ─────────────────

def test_reingest_idempotent_protected_fields_unchanged(db):
    import scripts as scripts_module

    script = _seed_script(db)
    body = scripts_module.IngestJsonBody(
        schema_version="2.0",
        elements=_two_scene_elements(),
    )

    with patch("scripts._get_or_create_chat", return_value="chat-1"):
        scripts_module.ingest_script_json(
            script_id=str(script.id),
            body=body,
            session=_mock_auth(script.user_id),
            db=db,
        )

    # Set protected fields on scene 1
    scene1 = db.exec(
        select(Scene).where(Scene.script_id == script.id, Scene.scene_number == 1)
    ).first()
    scene1.shooting_day = "Day 3"
    scene1.continuity_day = 7
    scene1.has_stunts = True
    scene1.has_vfx = False
    scene1.extras_count = 15
    scene1.creative_impact = 4
    db.add(scene1)
    db.commit()

    # Second ingest with changed non-protected fields
    body2 = scripts_module.IngestJsonBody(
        schema_version="2.0",
        elements=[
            {
                "type": "scene_heading",
                "text": "INT. OFFICE UPDATED - DAY",
                "scene_number": 1,
                "page": 1,
                "eighths": 8,
                "int_ext": "INT",
                "location": "NEW OFFICE",
                "sub_location": "Floor 2",
                "time_of_day": "day",
                "characters": ["ALICE"],
            },
        ],
    )

    with patch("scripts._get_or_create_chat", return_value="chat-1"):
        result = scripts_module.ingest_script_json(
            script_id=str(script.id),
            body=body2,
            session=_mock_auth(script.user_id),
            db=db,
        )

    assert result.scenes_upserted == 1

    db.expire_all()
    scene1_after = db.exec(
        select(Scene).where(Scene.script_id == script.id, Scene.scene_number == 1)
    ).first()

    # Non-protected fields updated
    assert scene1_after.heading == "INT. OFFICE UPDATED - DAY"
    assert scene1_after.length_in_eighths == 8
    assert scene1_after.scene_location == "NEW OFFICE"
    assert scene1_after.location_details == "Floor 2"

    # Protected fields unchanged
    assert scene1_after.shooting_day == "Day 3"
    assert scene1_after.continuity_day == 7
    assert scene1_after.has_stunts is True
    assert scene1_after.has_vfx is False
    assert scene1_after.extras_count == 15
    assert scene1_after.creative_impact == 4
