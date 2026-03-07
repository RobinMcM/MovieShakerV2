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
    created_at: datetime = Field(default_factory=datetime.utcnow)
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


class Character(SQLModel, table=True):
    """Parsed character for a script."""
    __tablename__ = "characters"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    script_id: uuid.UUID = Field(foreign_key="script.id", index=True)
    user_id: str = Field(index=True)
    name: str = Field()


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


class ContactSubmission(SQLModel, table=True):
    """Public contact form submissions (no auth required)."""
    __tablename__ = "contact_submission"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(max_length=100)
    email: str = Field(max_length=255)
    message: str = Field()
    honeypot: Optional[str] = Field(default=None, max_length=500)  # spam check
    created_at: datetime = Field(default_factory=datetime.utcnow)
