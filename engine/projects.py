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
class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None

class ProjectResponse(BaseModel):
    id: str  # UUID as string
    name: str
    description: Optional[str] = None
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
            role=role
        ))
        
    return projects
