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
    username: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    admin: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


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
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)
