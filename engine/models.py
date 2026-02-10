from typing import Optional, List
from sqlmodel import Field, SQLModel, Relationship
from datetime import datetime
import uuid

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
