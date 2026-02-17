from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List, Optional
from pydantic import BaseModel
from db import get_session
from models import Project, ProjectMember
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

router = APIRouter(prefix="/projects", tags=["projects"])

# Pydantic models for request/response
# Pydantic models for request/response
class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    status: str = "planning"
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    director: Optional[str] = None
    film_type: Optional[str] = None
    series: Optional[str] = None
    episode: Optional[str] = None
    aspect_ratio: str = "16:9"

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    director: Optional[str] = None
    film_type: Optional[str] = None
    series: Optional[str] = None
    episode: Optional[str] = None
    aspect_ratio: Optional[str] = None

class ProjectResponse(BaseModel):
    id: str  # UUID as string
    name: str
    description: Optional[str] = None
    status: str
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    director: Optional[str] = None
    film_type: Optional[str] = None
    series: Optional[str] = None
    episode: Optional[str] = None
    aspect_ratio: str
    role: str # The user's role in this project

@router.post("/", response_model=ProjectResponse)
def create_project(
    project_data: ProjectCreate,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session)
):
    user_id = session.get_user_id()
    
    # 1. Create Project
    new_project = Project(
        name=project_data.name,
        description=project_data.description,
        status=project_data.status,
        start_date=project_data.start_date,
        end_date=project_data.end_date,
        director=project_data.director,
        film_type=project_data.film_type,
        series=project_data.series,
        episode=project_data.episode,
        aspect_ratio=project_data.aspect_ratio,
        owner_id=user_id
    )
    db.add(new_project)
    db.commit()
    db.refresh(new_project)
    
    # 2. Add creator as Owner (MovieMaker)
    member = ProjectMember(
        project_id=new_project.id,
        user_id=user_id,
        role="owner"
    )
    db.add(member)
    db.commit()
    
    return ProjectResponse(
        id=str(new_project.id),
        name=new_project.name,
        description=new_project.description,
        status=new_project.status,
        start_date=new_project.start_date,
        end_date=new_project.end_date,
        director=new_project.director,
        film_type=new_project.film_type,
        series=new_project.series,
        episode=new_project.episode,
        aspect_ratio=new_project.aspect_ratio,
        role="owner"
    )

@router.get("/", response_model=List[ProjectResponse])
def list_projects(
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session)
):
    user_id = session.get_user_id()
    
    # Find all memberships for this user
    statement = select(Project, ProjectMember.role).join(ProjectMember).where(
        ProjectMember.user_id == user_id
    )
    results = db.exec(statement).all()
    
    projects = []
    for project, role in results:
        projects.append(ProjectResponse(
            id=str(project.id),
            name=project.name,
            description=project.description,
            status=project.status,
            start_date=project.start_date,
            end_date=project.end_date,
            director=project.director,
            film_type=project.film_type,
            series=project.series,
            episode=project.episode,
            aspect_ratio=project.aspect_ratio,
            role=role
        ))
        
    return projects

@router.put("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: str,
    project_update: ProjectUpdate,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session)
):
    user_id = session.get_user_id()
    
    # Check if user is a member with owner or editor role
    member_statement = select(ProjectMember).where(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user_id
    )
    member = db.exec(member_statement).first()
    
    if not member or member.role not in ["owner", "editor"]:
        raise HTTPException(status_code=403, detail="Not authorized to edit this project")
        
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    # Update fields
    project_data = project_update.dict(exclude_unset=True)
    for key, value in project_data.items():
        setattr(project, key, value)
        
    db.add(project)
    db.commit()
    db.refresh(project)
    
    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        description=project.description,
        status=project.status,
        start_date=project.start_date,
        end_date=project.end_date,
        director=project.director,
        film_type=project.film_type,
        series=project.series,
        episode=project.episode,
        aspect_ratio=project.aspect_ratio,
        role=member.role
    )

@router.delete("/{project_id}")
def delete_project(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session)
):
    user_id = session.get_user_id()
    
    # Check if user is owner
    member_statement = select(ProjectMember).where(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user_id
    )
    member = db.exec(member_statement).first()
    
    if not member or member.role != "owner":
        raise HTTPException(status_code=403, detail="Not authorized to delete this project")
        
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    db.delete(project) # Cascades should handle members if configured, but for now we might need manual cleanup if not
    # Manual cleanup of members just in case (though we should use cascade in models really)
    # SQLModel doesn't enable cascade by default easily without sa_relationship_kwargs
    
    # Delete members manually to be safe for now
    db.exec(select(ProjectMember).where(ProjectMember.project_id == project_id)).fetchall() 
    # Actually delete:
    members_to_delete = db.exec(select(ProjectMember).where(ProjectMember.project_id == project_id)).all()
    for m in members_to_delete:
        db.delete(m)
        
    db.commit()
    
    return {"success": True, "message": "Project deleted"}
