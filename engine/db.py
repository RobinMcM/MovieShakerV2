from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import text
import os
import logging

logger = logging.getLogger(__name__)

# Database URL from environment or default to local docker service
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@db:5432/movieshaker")

engine = create_engine(DATABASE_URL, echo=True)


def _migrate_user_profile_roles():
    """Add role, producer_tier, blocked to user_profile if missing."""
    with engine.connect() as conn:
        with conn.begin():
            for col, typ in [
                ("role", "VARCHAR NOT NULL DEFAULT 'producer'"),
                ("producer_tier", "VARCHAR NOT NULL DEFAULT 'standard'"),
                ("blocked", "BOOLEAN NOT NULL DEFAULT FALSE"),
                ("ai_credits", "INTEGER NOT NULL DEFAULT 50"),
                ("model_fiab_text", "VARCHAR"),
                ("model_visualize_video", "VARCHAR"),
                ("model_object_image", "VARCHAR"),
                ("model_sound_music", "VARCHAR"),
            ]:
                try:
                    conn.execute(
                        text(f"ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS {col} {typ}")
                    )
                except Exception as e:
                    logger.warning("Migration user_profile %s: %s", col, e)


def _migrate_user_profile_drop_admin():
    """Drop legacy admin column; role is the source of truth."""
    with engine.connect() as conn:
        with conn.begin():
            try:
                conn.execute(text("ALTER TABLE user_profile DROP COLUMN IF EXISTS admin"))
            except Exception as e:
                logger.warning("Migration user_profile drop admin: %s", e)


def _migrate_user_profile_email_verified():
    """Add email_verified_at to user_profile if missing."""
    with engine.connect() as conn:
        with conn.begin():
            try:
                conn.execute(
                    text(
                        "ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP"
                    )
                )
            except Exception as e:
                logger.warning("Migration user_profile email_verified_at: %s", e)


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
        ("creation_method", "VARCHAR NOT NULL DEFAULT 'standard'"),
    ]
    with engine.connect() as conn:
        with conn.begin():
            for col, typ in additions:
                try:
                    conn.execute(text(f"ALTER TABLE project ADD COLUMN IF NOT EXISTS {col} {typ}"))
                except Exception as e:
                    logger.warning("Migration add column %s: %s", col, e)


def _migrate_script_table():
    """Add is_locked, page_count to script table if missing."""
    with engine.connect() as conn:
        with conn.begin():
            for col, typ in [
                ("is_locked", "BOOLEAN NOT NULL DEFAULT FALSE"),
                ("page_count", "INTEGER"),
            ]:
                try:
                    conn.execute(
                        text(f"ALTER TABLE script ADD COLUMN IF NOT EXISTS {col} {typ}")
                    )
                except Exception as e:
                    logger.warning("Migration script %s: %s", col, e)


def _migrate_scenes_table():
    """Add scheduling columns to scenes table if missing."""
    with engine.connect() as conn:
        with conn.begin():
            for col, typ in [
                ("shooting_day", "VARCHAR"),
                ("time_of_day_id", "VARCHAR"),
                ("continuity_day", "INTEGER"),
                ("scene_location", "VARCHAR"),
                ("scene_details", "VARCHAR"),
                ("location_details", "VARCHAR"),
            ]:
                try:
                    conn.execute(
                        text(f"ALTER TABLE scenes ADD COLUMN IF NOT EXISTS {col} {typ}")
                    )
                except Exception as e:
                    logger.warning("Migration scenes %s: %s", col, e)


def _migrate_scene_characters_table():
    """Add status, notes to scene_characters table if missing."""
    with engine.connect() as conn:
        with conn.begin():
            for col, typ in [
                ("status", "VARCHAR"),
                ("notes", "VARCHAR"),
            ]:
                try:
                    conn.execute(
                        text(
                            f"ALTER TABLE scene_characters ADD COLUMN IF NOT EXISTS {col} {typ}"
                        )
                    )
                except Exception as e:
                    logger.warning("Migration scene_characters %s: %s", col, e)


def _migrate_scenes_scene_cost_columns():
    """Add scene cost modifier columns to scenes table if missing."""
    with engine.connect() as conn:
        with conn.begin():
            for col, typ in [
                ("location_type", "VARCHAR"),
                ("is_night_shoot", "BOOLEAN"),
                ("has_stunts", "BOOLEAN"),
                ("has_vfx", "BOOLEAN"),
                ("extras_count", "INTEGER"),
                ("creative_impact", "INTEGER"),
            ]:
                try:
                    conn.execute(
                        text(f"ALTER TABLE scenes ADD COLUMN IF NOT EXISTS {col} {typ}")
                    )
                except Exception as e:
                    logger.warning("Migration scenes %s: %s", col, e)


def _migrate_characters_cast_tier():
    """Add cast_tier to characters table if missing."""
    with engine.connect() as conn:
        with conn.begin():
            try:
                conn.execute(
                    text("ALTER TABLE characters ADD COLUMN IF NOT EXISTS cast_tier VARCHAR")
                )
            except Exception as e:
                logger.warning("Migration characters cast_tier: %s", e)


def _migrate_characters_objects_fields():
    """Add Objects page fields to characters table if missing."""
    with engine.connect() as conn:
        with conn.begin():
            for col, typ in [
                ("type", "VARCHAR NOT NULL DEFAULT 'character'"),
                ("casting_notes", "VARCHAR"),
                ("character_image_url", "VARCHAR"),
                ("hide_from_view", "BOOLEAN NOT NULL DEFAULT FALSE"),
                ("aspect_ratio", "VARCHAR"),
                ("series_group", "VARCHAR"),
            ]:
                try:
                    conn.execute(
                        text(f"ALTER TABLE characters ADD COLUMN IF NOT EXISTS {col} {typ}")
                    )
                except Exception as e:
                    logger.warning("Migration characters %s: %s", col, e)


def init_db():
    # Ensure models are registered (import side-effect)
    from models import (  # noqa: F401
        Project,
        ProjectMember,
        UserProfile,
        Script,
        Scene,
        Character,
        SceneCharacter,
        Budget,
        BudgetLineItem,
        SceneCostConfig,
        SceneCost,
        TramLine,
        MoodBoardComposition,
        MoodBoardImageHistory,
        MoodBoardVideoHistory,
        MoodBoardCompiledVideo,
        GatewayUsageEvent,
        FilmInABoxItem,
        EmailVerificationToken,
        Notification,
        ContactSubmission,
    )
    SQLModel.metadata.create_all(engine)
    _migrate_user_profile_email_verified()
    _migrate_user_profile_roles()
    _migrate_user_profile_drop_admin()
    _migrate_project_table()
    _migrate_script_table()
    _migrate_scenes_table()
    _migrate_scene_characters_table()
    _migrate_scenes_scene_cost_columns()
    _migrate_characters_cast_tier()
    _migrate_characters_objects_fields()


def get_session():
    with Session(engine) as session:
        yield session
