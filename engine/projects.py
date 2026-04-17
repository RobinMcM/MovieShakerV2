import json
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List, Optional
from pydantic import BaseModel
from db import get_session
from models import Project, ProjectMember, UserProfile, Script, Scene, TramLine
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer
from cache import cache_get, cache_set, cache_delete, PROJECTS_LIST_TTL

# Producer tier project limits (owned projects)
PRODUCER_TIER_LIMITS = {"standard": 5, "indie": 25, "production_company": 999}

router = APIRouter(prefix="/projects", tags=["projects"])


def _projects_cache_key(user_id: str) -> str:
    return f"projects:list:{user_id}"

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
    creation_method: str = "standard"
    role: str # The user's role in this project

@router.post("/", response_model=ProjectResponse)
def create_project(
    project_data: ProjectCreate,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session)
):
    user_id = session.get_user_id()
    profile = db.get(UserProfile, user_id)
    if not profile:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    if profile.blocked:
        raise HTTPException(status_code=403, detail="Account is blocked")
    if profile.role != "admin":
        limit = PRODUCER_TIER_LIMITS.get(profile.producer_tier, 5)
        count = db.exec(select(Project).where(Project.owner_id == user_id)).all()
        if len(count) >= limit:
            raise HTTPException(
                status_code=403,
                detail=f"Project limit reached for your plan ({limit} projects). Contact support to upgrade."
            )

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
        creation_method="standard",
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
    
    cache_delete(_projects_cache_key(user_id))
    
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
        creation_method=new_project.creation_method,
        role="owner"
    )

@router.get("/", response_model=List[ProjectResponse])
@router.get("", response_model=List[ProjectResponse], include_in_schema=False)
def list_projects(
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session)
):
    try:
        user_id = session.get_user_id()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"session.get_user_id: {e!s}") from e
    profile = db.get(UserProfile, user_id)
    if profile and profile.blocked:
        raise HTTPException(status_code=403, detail="Account is blocked")

    cache_key = _projects_cache_key(user_id)
    cached = cache_get(cache_key)
    if cached is not None:
        try:
            data = json.loads(cached)
            out = []
            for raw in data:
                item = dict(raw)
                for field in ("start_date", "end_date"):
                    if isinstance(item.get(field), str) and item[field]:
                        item[field] = datetime.fromisoformat(item[field].replace("Z", "+00:00"))
                out.append(ProjectResponse(**item))
            return out
        except Exception:
            pass

    try:
        statement = (
            select(Project, ProjectMember.role)
            .join(ProjectMember, Project.id == ProjectMember.project_id)
            .where(ProjectMember.user_id == user_id)
        )
        results = db.exec(statement).all()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"db query: {e!s}") from e

    projects = []
    for project, role in results:
        try:
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
                creation_method=getattr(project, "creation_method", "standard"),
                role=role
            ))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"build ProjectResponse: {e!s}") from e

    try:
        payload = [
            getattr(p, "model_dump", lambda: p.dict())() for p in projects
        ]
        cache_set(cache_key, json.dumps(payload, default=str), PROJECTS_LIST_TTL)
    except Exception:
        pass

    return projects

@router.get("/{project_id}/tram-lines")
def list_project_tram_lines(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """List all tram lines for a project (current script's scenes), with scene info for moodboard."""
    user_id = session.get_user_id()
    member = db.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this project")
    scripts = list(
        db.exec(
            select(Script).where(Script.project_id == project_id).order_by(Script.uploaded_at.desc())
        ).all()
    )
    if not scripts:
        return {"success": True, "tramLines": []}
    current = next((s for s in scripts if s.is_current), scripts[0])
    scenes = list(
        db.exec(
            select(Scene).where(Scene.script_id == current.id).order_by(Scene.scene_number.asc(), Scene.id.asc())
        ).all()
    )
    scene_ids = [s.id for s in scenes]
    if not scene_ids:
        return {"success": True, "tramLines": []}
    from tram_lines import _row_to_response
    tram_lines = list(
        db.exec(select(TramLine).where(TramLine.scene_id.in_(scene_ids))).all()
    )
    scene_by_id = {s.id: s for s in scenes}
    scene_order = {s.id: i for i, s in enumerate(scenes)}
    # Order by scene number then line_number
    def order_key(tl):
        return (scene_order.get(tl.scene_id, 999), (tl.line_number or ""))
    tram_lines.sort(key=order_key)
    out = []
    for tl in tram_lines:
        scene = scene_by_id.get(tl.scene_id)
        out.append(_row_to_response(tl, scene))
    return {"success": True, "tramLines": out}


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
        
    # Update fields (Pydantic v1 .dict() or v2 .model_dump())
    project_data = getattr(
        project_update, "model_dump", lambda **kw: project_update.dict(**kw)
    )(exclude_unset=True)
    for key, value in project_data.items():
        setattr(project, key, value)
        
    db.add(project)
    db.commit()
    db.refresh(project)
    
    cache_delete(_projects_cache_key(user_id))
    
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
        creation_method=getattr(project, "creation_method", "standard"),
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
        
    from models import (
        Script, Scene, SceneCharacter, SceneCost, Character,
        TramLine, Budget, BudgetLineItem, SceneCostConfig,
        MoodBoardComposition, MoodBoardImageHistory,
        MoodBoardVideoHistory, MoodBoardCompiledVideo,
        FilmInABoxItem,
    )
    from storage import delete_script_dir

    project_uuid = uuid.UUID(project_id)

    # Scripts → scenes → scene dependents (deepest FK level first)
    scripts = db.exec(select(Script).where(Script.project_id == project_uuid)).all()
    for script in scripts:
        scenes = db.exec(select(Scene).where(Scene.script_id == script.id)).all()
        for scene in scenes:
            for row in db.exec(select(SceneCharacter).where(SceneCharacter.scene_id == scene.id)).all():
                db.delete(row)
            for row in db.exec(select(SceneCost).where(SceneCost.scene_id == scene.id)).all():
                db.delete(row)
            for row in db.exec(select(TramLine).where(TramLine.scene_id == scene.id)).all():
                db.delete(row)
            db.delete(scene)
        for row in db.exec(select(Character).where(Character.script_id == script.id)).all():
            db.delete(row)
        db.delete(script)
        try:
            delete_script_dir(user_id, project_id, str(script.id))
        except Exception:
            pass
    db.flush()

    # Budget → line items
    budgets = db.exec(select(Budget).where(Budget.project_id == project_uuid)).all()
    for budget in budgets:
        for row in db.exec(select(BudgetLineItem).where(BudgetLineItem.budget_id == budget.id)).all():
            db.delete(row)
        db.delete(budget)

    # Scene cost config (unique per project)
    for row in db.exec(select(SceneCostConfig).where(SceneCostConfig.project_id == project_uuid)).all():
        db.delete(row)

    # Moodboard
    for row in db.exec(select(MoodBoardComposition).where(MoodBoardComposition.project_id == project_uuid)).all():
        db.delete(row)
    for row in db.exec(select(MoodBoardImageHistory).where(MoodBoardImageHistory.project_id == project_uuid)).all():
        db.delete(row)
    for row in db.exec(select(MoodBoardVideoHistory).where(MoodBoardVideoHistory.project_id == project_uuid)).all():
        db.delete(row)
    for row in db.exec(select(MoodBoardCompiledVideo).where(MoodBoardCompiledVideo.project_id == project_uuid)).all():
        db.delete(row)

    # Film in a Box items
    for row in db.exec(select(FilmInABoxItem).where(FilmInABoxItem.project_id == project_uuid)).all():
        db.delete(row)

    # Members and project (last)
    for row in db.exec(select(ProjectMember).where(ProjectMember.project_id == project_uuid)).all():
        db.delete(row)
    db.delete(project)
    db.commit()

    cache_delete(_projects_cache_key(user_id))
    return {"success": True, "message": "Project deleted"}
