from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import text
import os
import logging

logger = logging.getLogger(__name__)

# Database URL from environment or default to local docker service
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@db:5432/movieshaker")

engine = create_engine(DATABASE_URL, echo=True)


def _migrate_project_table():
    """Add any missing columns to project table (idempotent). Run after create_all."""
    # Columns that may have been added to the model after the table was first created
    additions = [
        ("status", "VARCHAR NOT NULL DEFAULT 'planning'"),
        ("start_date", "TIMESTAMP"),
        ("end_date", "TIMESTAMP"),
        ("director", "VARCHAR"),
        ("film_type", "VARCHAR"),
        ("series", "VARCHAR"),
        ("episode", "VARCHAR"),
        ("aspect_ratio", "VARCHAR NOT NULL DEFAULT '16:9'"),
    ]
    with engine.connect() as conn:
        with conn.begin():
            for col, typ in additions:
                try:
                    conn.execute(text(f"ALTER TABLE project ADD COLUMN IF NOT EXISTS {col} {typ}"))
                except Exception as e:
                    logger.warning("Migration add column %s: %s", col, e)


def init_db():
    # Ensure models are registered (import side-effect)
    from models import Project, ProjectMember, UserProfile, Script  # noqa: F401
    SQLModel.metadata.create_all(engine)
    _migrate_project_table()


def get_session():
    with Session(engine) as session:
        yield session
