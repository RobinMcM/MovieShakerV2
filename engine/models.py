from typing import Optional, List
from sqlmodel import Field, SQLModel, Relationship
from datetime import datetime
import uuid


class UserProfile(SQLModel, table=True):
    """App-owned profile: name, company, communication email, etc. Keyed by SuperTokens user_id."""
    __tablename__ = "user_profile"
    user_id: str = Field(primary_key=True)  # SuperTokens User ID
    name: Optional[str] = None
    company: Optional[str] = None
    communication_email: Optional[str] = None  # For display/notifications; auth email stays in SuperTokens
    email_verified_at: Optional[datetime] = None  # When communication_email was verified
    username: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    role: str = Field(default="producer")  # "admin" | "producer"
    producer_tier: str = Field(default="standard")  # "standard" | "indie" | "production_company"
    blocked: bool = Field(default=False)
    notifications_opt_in: bool = Field(default=True)
    ai_credits: int = Field(default=50)
    model_fiab_text: Optional[str] = None
    model_visualize_video: Optional[str] = None
    model_object_image: Optional[str] = None
    model_sound_music: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AuthConfig(SQLModel, table=True):
    """Singleton auth + email template settings managed by admin."""
    __tablename__ = "auth_config"
    id: int = Field(default=1, primary_key=True)
    email_password_enabled: bool = Field(default=True)
    allow_sign_up: bool = Field(default=True)
    password_min_length: int = Field(default=8)
    password_require_uppercase: bool = Field(default=False)
    password_require_lowercase: bool = Field(default=False)
    password_require_number: bool = Field(default=False)
    password_require_special: bool = Field(default=False)
    registration_subject: str = Field(default="Registration confirmed")
    registration_body: str = Field(default="Your MovieShaker registration was successful.")
    welcome_subject: str = Field(default="Welcome to MovieShaker")
    welcome_body: str = Field(default="Welcome aboard. Your account is ready to use.")
    reset_confirmation_subject: str = Field(default="Password reset confirmed")
    reset_confirmation_body: str = Field(default="Your password was reset successfully.")
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class EmailVerificationToken(SQLModel, table=True):
    """One-time token for verifying communication_email. Expires after use or TTL."""
    __tablename__ = "email_verification_token"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(index=True)
    email: str = Field(index=True)
    token: str = Field(unique=True, index=True)
    expires_at: datetime = Field()
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Notification(SQLModel, table=True):
    """In-app notification record; email may also be sent via send_notification_email."""
    __tablename__ = "notification"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(index=True)
    type: str = Field(index=True)
    title: str = Field()
    body: Optional[str] = None
    payload: Optional[str] = None  # JSON for extra data / CTA URL
    read_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ProjectMember(SQLModel, table=True):
    project_id: uuid.UUID = Field(foreign_key="project.id", primary_key=True)
    user_id: str = Field(primary_key=True) # SuperTokens User ID
    role: str = Field(default="viewer") # "owner", "editor", "viewer" -> "MovieShaker" role
    joined_at: datetime = Field(default_factory=datetime.utcnow)

class Project(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str
    description: Optional[str] = None
    
    # Metadata
    status: str = Field(default="planning")
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    director: Optional[str] = None
    film_type: Optional[str] = None
    series: Optional[str] = None
    episode: Optional[str] = None
    aspect_ratio: str = Field(default="16:9")
    creation_method: str = Field(default="standard")  # "standard" | "film_in_a_box"
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    owner_id: str = Field(index=True) # SuperTokens User ID of the creator ("MovieMaker")


class Script(SQLModel, table=True):
    """Script PDF (and optional JSON) per project. Files at STORAGE_ROOT/{user_id}/{project_id}/{script_id}/."""
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    project_id: uuid.UUID = Field(foreign_key="project.id", index=True)
    user_id: str = Field(index=True)  # SuperTokens user who uploaded
    name: str = Field()
    description: Optional[str] = None
    series: Optional[str] = None
    episode: Optional[str] = None
    file_path: str = Field()  # relative: {user_id}/{project_id}/{script_id}/script.pdf
    is_current: bool = Field(default=False)
    is_locked: bool = Field(default=False)
    page_count: Optional[int] = None
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)


class Scene(SQLModel, table=True):
    """Parsed scene for a script (heading, page, length in eighths). Scheduling fields optional."""
    __tablename__ = "scenes"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    script_id: uuid.UUID = Field(foreign_key="script.id", index=True)
    user_id: str = Field(index=True)
    heading: str = Field()
    page_number: str = Field(default="")
    length_in_eighths: Optional[int] = None
    scene_number: Optional[int] = None
    # Scheduling (nullable; add columns if missing: see migrations or ALTER TABLE)
    shooting_day: Optional[str] = Field(default=None)
    time_of_day_id: Optional[str] = Field(default=None)
    continuity_day: Optional[int] = Field(default=None)
    scene_location: Optional[str] = Field(default=None)
    scene_details: Optional[str] = Field(default=None)
    location_details: Optional[str] = Field(default=None)
    # Scene cost modifiers (nullable; migrated in db.py)
    location_type: Optional[str] = Field(default=None)  # studio | local_interior | urban_exterior | remote
    is_night_shoot: Optional[bool] = Field(default=None)
    has_stunts: Optional[bool] = Field(default=None)
    has_vfx: Optional[bool] = Field(default=None)
    extras_count: Optional[int] = Field(default=None)
    creative_impact: Optional[int] = Field(default=None)


class Character(SQLModel, table=True):
    """Parsed character for a script; also used for objects/scenes (type=object|scene)."""
    __tablename__ = "characters"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    script_id: uuid.UUID = Field(foreign_key="script.id", index=True)
    user_id: str = Field(index=True)
    name: str = Field()
    cast_tier: Optional[str] = Field(default=None)  # lead | supporting | day_player
    # Objects page / mood board
    type: str = Field(default="character")  # "character" | "object" | "scene"
    casting_notes: Optional[str] = Field(default=None)
    character_image_url: Optional[str] = Field(default=None)
    hide_from_view: bool = Field(default=False)
    aspect_ratio: Optional[str] = Field(default=None)
    series_group: Optional[str] = Field(default=None)


class SceneCharacter(SQLModel, table=True):
    """Link between scene and character (character appears in scene)."""
    __tablename__ = "scene_characters"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    scene_id: uuid.UUID = Field(foreign_key="scenes.id", index=True)
    character_id: uuid.UUID = Field(foreign_key="characters.id", index=True)
    user_id: str = Field(index=True)
    status: Optional[str] = Field(default=None)
    notes: Optional[str] = Field(default=None)


class Budget(SQLModel, table=True):
    """One budget per project. total_budget and template_id (strategy) set on generate."""
    __tablename__ = "budget"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    project_id: uuid.UUID = Field(foreign_key="project.id", index=True, unique=True)
    total_budget: float = Field()
    template_id: Optional[str] = Field(default=None)  # strategy key e.g. producer-centric
    currency: Optional[str] = Field(default="GBP")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class BudgetLineItem(SQLModel, table=True):
    """Line items for a budget. view_type: template | timeline | budget | marketing."""
    __tablename__ = "budget_line_item"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    budget_id: uuid.UUID = Field(foreign_key="budget.id", index=True)
    view_type: str = Field(index=True)  # template | timeline | budget | marketing
    category: Optional[str] = Field(default=None)
    phase: Optional[str] = Field(default=None)
    account_code: Optional[str] = Field(default=None)
    item_name: str = Field()
    notes: Optional[str] = Field(default=None)
    estimated_amount: Optional[float] = Field(default=None)
    percentage: Optional[float] = Field(default=None)
    sort_order: Optional[int] = Field(default=None)


class SceneCostConfig(SQLModel, table=True):
    """Scene cost configuration per project (shoot days, strategy). One per project."""
    __tablename__ = "scene_cost_config"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    project_id: uuid.UUID = Field(foreign_key="project.id", index=True, unique=True)
    shoot_days: int = Field(default=30)
    strategy_id: str = Field(default="producer-centric")
    base_cost_per_eighth: Optional[float] = Field(default=None)
    allocatable_budget: Optional[float] = Field(default=None)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SceneCost(SQLModel, table=True):
    """Cached scene cost row (one per scene per config). Recalculated on POST calculate or config/modifier change."""
    __tablename__ = "scene_cost"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    scene_id: uuid.UUID = Field(foreign_key="scenes.id", index=True)
    config_id: uuid.UUID = Field(foreign_key="scene_cost_config.id", index=True)
    base_cost: float = Field()
    cast_modifier: float = Field()
    location_modifier: float = Field()
    complexity_modifier: float = Field()
    final_cost: float = Field()
    target_budget: float = Field()
    status: str = Field()  # under | on-target | over
    cast_percentage: float = Field()
    crew_percentage: float = Field()
    location_percentage: float = Field()
    art_percentage: float = Field()
    logistics_percentage: float = Field()


class TramLine(SQLModel, table=True):
    """Shot coverage marker (tramline) on a scene: vertical bar with start/end %, x position, optional shot type and camera direction."""
    __tablename__ = "tram_lines"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    scene_id: uuid.UUID = Field(foreign_key="scenes.id", index=True)
    user_id: str = Field(index=True)
    line_number: str = Field()  # A, B, C, ... AA, AB
    shot_type: Optional[str] = Field(default=None)
    camera_direction: Optional[str] = Field(default=None)
    action_text: Optional[str] = Field(default=None)
    character_names: Optional[str] = Field(default=None)
    script_elements: Optional[str] = Field(default=None)  # JSONB stored as string in SQLModel
    scene_mood: Optional[str] = Field(default=None)
    scene_visual: Optional[str] = Field(default=None)
    color: Optional[str] = Field(default=None)
    start_y: float = Field()
    end_y: float = Field()
    x_position: float = Field()
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class MoodBoardComposition(SQLModel, table=True):
    """Mood board canvas composition per tram line (drawing data + note). Multiple per tram line allowed."""
    __tablename__ = "mood_board_canvas_compositions"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tram_line_id: uuid.UUID = Field(foreign_key="tram_lines.id", index=True)
    user_id: str = Field(index=True)
    composition_data: Optional[str] = Field(default=None)  # JSON
    canvas_number: int = Field(default=1)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class MoodBoardImageHistory(SQLModel, table=True):
    """Mood board image history (uploaded/generated images per tram line)."""
    __tablename__ = "mood_board_image_history"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tram_line_id: uuid.UUID = Field(foreign_key="tram_lines.id", index=True)
    user_id: str = Field(index=True)
    image_path: str = Field()
    generation_method: str = Field(default="upload")
    prompt: Optional[str] = Field(default=None)
    aspect_ratio: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MoodBoardVideoHistory(SQLModel, table=True):
    """Video history per tram line (AI-generated or continuation videos)."""
    __tablename__ = "mood_board_video_history"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tram_line_id: uuid.UUID = Field(foreign_key="tram_lines.id", index=True)
    user_id: str = Field(index=True)
    video_path: str = Field()  # URL or storage path
    task_id: Optional[str] = Field(default=None)
    generation_method: str = Field(default="gateway_fal")
    prompt: Optional[str] = Field(default=None)
    aspect_ratio: Optional[str] = Field(default=None)
    duration: Optional[int] = Field(default=None)
    take_number: Optional[int] = Field(default=None)
    channel: Optional[int] = Field(default=None)
    source_type: Optional[str] = Field(default=None)
    source_image_path: Optional[str] = Field(default=None)
    source_video_id: Optional[str] = Field(default=None)
    is_print: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MoodBoardCompiledVideo(SQLModel, table=True):
    """Stitched (compiled) video per tram line / channel."""
    __tablename__ = "mood_board_compiled_videos"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tram_line_id: uuid.UUID = Field(foreign_key="tram_lines.id", index=True)
    project_id: uuid.UUID = Field(foreign_key="project.id", index=True)
    user_id: str = Field(index=True)
    compiled_video_path: str = Field()  # URL or storage path
    source_video_ids: Optional[str] = Field(default=None)  # JSON array of UUIDs
    status: str = Field(default="pending")  # pending | completed | failed
    completed_at: Optional[datetime] = Field(default=None)
    error_message: Optional[str] = Field(default=None)
    is_main_print: Optional[bool] = Field(default=None)
    youtube_upload_status: Optional[str] = Field(default=None)
    channel_number: Optional[int] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class GatewayUsageEvent(SQLModel, table=True):
    """Usage/cost ledger for gateway-backed generation requests."""
    __tablename__ = "gateway_usage_events"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(index=True)
    project_id: uuid.UUID = Field(foreign_key="project.id", index=True)
    tram_line_id: uuid.UUID = Field(foreign_key="tram_lines.id", index=True)
    video_history_id: Optional[uuid.UUID] = Field(default=None, foreign_key="mood_board_video_history.id", index=True)
    gateway_job_id: Optional[str] = Field(default=None, index=True)
    provider: str = Field(default="fal")
    model: Optional[str] = Field(default=None)
    media_type: Optional[str] = Field(default=None)
    status: str = Field(default="submitted")
    estimate_json: Optional[str] = Field(default=None)
    actual_usage_json: Optional[str] = Field(default=None)
    raw_response_json: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class FilmInABoxItem(SQLModel, table=True):
    """Saved Film in a Box generations (project-scoped or standalone history)."""
    __tablename__ = "film_in_a_box_item"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(index=True)
    project_id: Optional[uuid.UUID] = Field(default=None, foreign_key="project.id", index=True)
    name: str = Field()
    content_type: str = Field(default="FILM")  # FILM | DOC
    content_json: str = Field()  # Serialized generation output
    prompt: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ContactSubmission(SQLModel, table=True):
    """Public contact form submissions (no auth required)."""
    __tablename__ = "contact_submission"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=100)
    email: str = Field(max_length=255)
    message: str = Field()
    honeypot: Optional[str] = Field(default=None, max_length=500)  # spam check
    created_at: datetime = Field(default_factory=datetime.utcnow)
