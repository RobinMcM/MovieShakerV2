"""
Scene Costs API: GET/POST project scene costs, PUT config, PUT scene modifiers, GET summary.
Prefix: /api/scene-costs. Matches legacy client paths.
"""
import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from db import get_session
from models import (
    Budget,
    Character,
    Project,
    ProjectMember,
    Scene,
    SceneCharacter,
    SceneCost,
    SceneCostConfig,
    Script,
)
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scene-costs", tags=["scene-costs"])

# Strategy weights (atl, btl) for allocatable = BTL + 0.5*ATL (legacy budgetStrategy)
STRATEGY_WEIGHTS: dict[str, tuple[float, float]] = {
    "producer-centric": (0.20, 0.65),
    "talent-driven": (0.40, 0.40),
    "director-led": (0.35, 0.50),
    "marketing-heavy": (0.25, 0.40),
    "star-marketing": (0.35, 0.35),
    "genre-optimized": (0.25, 0.55),
    "incentive-maximized": (0.25, 0.60),
    "festival-prestige": (0.35, 0.45),
    "fast-turnaround": (0.30, 0.50),
    "investor-first": (0.25, 0.50),
}
DEFAULT_STRATEGY = "producer-centric"

LOCATION_MODIFIERS: dict[str, float] = {
    "studio": 1.0,
    "local_interior": 1.1,
    "urban_exterior": 1.25,
    "remote": 1.5,
}
CAST_TIER_WEIGHTS: dict[str, float] = {
    "lead": 3.0,
    "supporting": 1.5,
    "day_player": 1.0,
}
NIGHT_SHOOT_MODIFIER = 1.15
STUNTS_MODIFIER = 1.3
VFX_MODIFIER = 1.2
LARGE_EXTRAS_THRESHOLD = 50
LARGE_EXTRAS_MODIFIER = 1.25
UNDER_THRESHOLD = 0.95
OVER_THRESHOLD = 1.05


def _ensure_project_member(db: Session, project_id: str, user_id: str) -> None:
    member = db.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == uuid.UUID(project_id),
            ProjectMember.user_id == user_id,
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this project")


def _ensure_project_exists(db: Session, project_id: str) -> None:
    project = db.get(Project, uuid.UUID(project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")


def _get_current_script_for_project(db: Session, project_id: str) -> Optional[Script]:
    stmt = (
        select(Script)
        .where(Script.project_id == uuid.UUID(project_id))
        .order_by(Script.uploaded_at.desc())
    )
    scripts = list(db.exec(stmt).all())
    for s in scripts:
        if getattr(s, "is_current", False):
            return s
    return scripts[0] if scripts else None


def _calculate_allocatable_budget(total_budget: float, strategy_id: str) -> float:
    atl, btl = STRATEGY_WEIGHTS.get(strategy_id, STRATEGY_WEIGHTS[DEFAULT_STRATEGY])
    atl_amount = total_budget * atl
    btl_amount = total_budget * btl
    return btl_amount + 0.5 * atl_amount


def _calculate_base_cost_per_eighth(allocatable_budget: float, shoot_days: int) -> float:
    total_units = shoot_days * 8
    return allocatable_budget / total_units if total_units else 0.0


def _infer_location_type(heading: str) -> str:
    upper = (heading or "").upper()
    if "STUDIO" in upper or "SOUNDSTAGE" in upper:
        return "studio"
    if upper.startswith("INT.") or "INTERIOR" in upper:
        if any(x in upper for x in ["CABIN", "MOUNTAIN", "ISLAND", "DESERT"]):
            return "remote"
        return "local_interior"
    if upper.startswith("EXT.") or "EXTERIOR" in upper:
        if any(x in upper for x in ["STREET", "CITY", "DOWNTOWN", "BUILDING"]):
            return "urban_exterior"
        if any(x in upper for x in ["FOREST", "BEACH", "MOUNTAIN", "DESERT", "ISLAND"]):
            return "remote"
        return "urban_exterior"
    return "studio"


def _infer_scene_complexity(heading: str, description: Optional[str] = None) -> dict[str, Any]:
    text = f"{heading or ''} {description or ''}".upper()
    return {
        "is_night_shoot": "NIGHT" in text or "EVENING" in text,
        "location_type": _infer_location_type(heading),
        "has_stunts": any(
            x in text for x in ["STUNT", "FIGHT", "CRASH", "EXPLOSION"]
        ),
        "has_vfx": any(
            x in text for x in ["VFX", "CGI", "GREEN SCREEN", "EFFECT"]
        ),
    }


def _infer_cast_tier(appearance_count: int, total_scenes: int) -> str:
    if total_scenes == 0:
        return "day_player"
    ratio = appearance_count / total_scenes
    if ratio >= 0.4:
        return "lead"
    if ratio >= 0.15:
        return "supporting"
    return "day_player"


def _calculate_cast_modifier(cast_tiers: list[str]) -> float:
    if not cast_tiers:
        return 1.0
    total = sum(CAST_TIER_WEIGHTS.get(t, 1.0) for t in cast_tiers)
    avg = total / len(cast_tiers)
    return round(min(3.0, max(1.0, avg)), 2)


def _calculate_location_modifier(location_type: Optional[str]) -> float:
    return LOCATION_MODIFIERS.get(location_type or "studio", 1.0)


def _calculate_complexity_modifier(
    is_night_shoot: bool,
    has_stunts: bool,
    has_vfx: bool,
    extras_count: int,
) -> float:
    mod = 1.0
    if is_night_shoot:
        mod *= NIGHT_SHOOT_MODIFIER
    if has_stunts:
        mod *= STUNTS_MODIFIER
    if has_vfx:
        mod *= VFX_MODIFIER
    if (extras_count or 0) >= LARGE_EXTRAS_THRESHOLD:
        mod *= LARGE_EXTRAS_MODIFIER
    return round(min(2.0, mod), 2)


def _calculate_cost_breakdown(
    cast_mod: float, location_mod: float, complexity_mod: float
) -> dict[str, float]:
    cast_pct, crew_pct = 30, 40
    location_pct, art_pct, logistics_pct = 15, 10, 5
    if cast_mod > 2.0:
        cast_pct, crew_pct = 35, 35
    elif cast_mod < 1.5:
        cast_pct, crew_pct = 25, 45
    if location_mod > 1.2:
        location_pct, logistics_pct = 20, 8
        crew_pct -= 8
    if complexity_mod > 1.5:
        crew_pct += 5
        art_pct -= 3
        logistics_pct -= 2
    total = cast_pct + crew_pct + location_pct + art_pct + logistics_pct
    f = 100.0 / total
    return {
        "cast_percentage": round(cast_pct * f, 1),
        "crew_percentage": round(crew_pct * f, 1),
        "location_percentage": round(location_pct * f, 1),
        "art_percentage": round(art_pct * f, 1),
        "logistics_percentage": round(logistics_pct * f, 1),
    }


def _determine_status(final_cost: float, target_budget: float) -> str:
    if target_budget <= 0:
        return "on-target"
    ratio = final_cost / target_budget
    if ratio <= UNDER_THRESHOLD:
        return "under"
    if ratio > OVER_THRESHOLD:
        return "over"
    return "on-target"


def _calculate_one_scene(
    scene_id: str,
    eighths: int,
    cast_modifier: float,
    location_modifier: float,
    complexity_modifier: float,
    base_cost_per_eighth: float,
) -> dict[str, Any]:
    base_cost = base_cost_per_eighth * eighths
    final_cost = base_cost * cast_modifier * location_modifier * complexity_modifier
    target_budget = base_cost
    status = _determine_status(final_cost, target_budget)
    breakdown = _calculate_cost_breakdown(
        cast_modifier, location_modifier, complexity_modifier
    )
    return {
        "sceneId": scene_id,
        "baseCost": round(base_cost),
        "castModifier": cast_modifier,
        "locationModifier": location_modifier,
        "complexityModifier": complexity_modifier,
        "finalCost": round(final_cost),
        "targetBudget": round(target_budget),
        "status": status,
        "castPercentage": breakdown["cast_percentage"],
        "crewPercentage": breakdown["crew_percentage"],
        "locationPercentage": breakdown["location_percentage"],
        "artPercentage": breakdown["art_percentage"],
        "logisticsPercentage": breakdown["logistics_percentage"],
    }


# --- Request/Response schemas ---

class ConfigUpdateBody(BaseModel):
    shootDays: int


class SceneModifiersBody(BaseModel):
    locationType: Optional[str] = None  # studio | local_interior | urban_exterior | remote
    isNightShoot: Optional[bool] = None
    hasStunts: Optional[bool] = None
    hasVfx: Optional[bool] = None
    extrasCount: Optional[int] = None
    creativeImpact: Optional[int] = None


# --- Routes ---

@router.get("/projects/{project_id}")
def get_scene_costs(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Return config and cached scene costs (or empty) for the project."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    _ensure_project_exists(db, project_id)

    budget = db.exec(
        select(Budget).where(Budget.project_id == uuid.UUID(project_id))
    ).first()
    total_budget = float(budget.total_budget) if budget else 0.0
    strategy_id = (budget.template_id or DEFAULT_STRATEGY) if budget else DEFAULT_STRATEGY

    config_row = db.exec(
        select(SceneCostConfig).where(
            SceneCostConfig.project_id == uuid.UUID(project_id)
        )
    ).first()

    if not config_row:
        config_row = SceneCostConfig(
            project_id=uuid.UUID(project_id),
            shoot_days=30,
            strategy_id=strategy_id,
        )
        db.add(config_row)
        db.commit()
        db.refresh(config_row)

    config_response = {
        "shootDays": config_row.shoot_days,
        "strategyId": strategy_id,
        "totalBudget": total_budget,
    }
    if config_row.base_cost_per_eighth is not None:
        config_response["baseCostPerEighth"] = config_row.base_cost_per_eighth
    if config_row.allocatable_budget is not None:
        config_response["allocatableBudget"] = config_row.allocatable_budget

    cached = db.exec(
        select(SceneCost, Scene)
        .join(Scene, SceneCost.scene_id == Scene.id)
        .where(SceneCost.config_id == config_row.id)
        .order_by(Scene.page_number, Scene.id)
    ).all()

    if not cached:
        return {
            "success": True,
            "config": config_response,
            "sceneCosts": [],
            "message": "No costs calculated yet. Use POST /calculate to generate.",
        }

    scene_costs_out = []
    for sc, scene in cached:
        scene_costs_out.append({
            "sceneId": str(sc.scene_id),
            "heading": scene.heading,
            "pageNumber": scene.page_number or "",
            "eighths": scene.length_in_eighths or 1,
            "baseCost": sc.base_cost,
            "castModifier": sc.cast_modifier,
            "locationModifier": sc.location_modifier,
            "complexityModifier": sc.complexity_modifier,
            "finalCost": sc.final_cost,
            "targetBudget": sc.target_budget,
            "status": sc.status,
            "castPercentage": sc.cast_percentage,
            "crewPercentage": sc.crew_percentage,
            "locationPercentage": sc.location_percentage,
            "artPercentage": sc.art_percentage,
            "logisticsPercentage": sc.logistics_percentage,
        })

    allocatable = config_row.allocatable_budget or 0.0
    total_scene_cost = sum(c["finalCost"] for c in scene_costs_out)
    variance = total_scene_cost - allocatable if allocatable else 0
    variance_pct = (variance / allocatable * 100) if allocatable else 0.0
    summary = {
        "totalScenes": len(scene_costs_out),
        "totalShootUnits": config_row.shoot_days * 8,
        "baseCostPerEighth": config_row.base_cost_per_eighth or 0,
        "allocatableBudget": allocatable,
        "totalSceneCost": round(total_scene_cost),
        "scenesUnderBudget": sum(1 for c in scene_costs_out if c["status"] == "under"),
        "scenesOnTarget": sum(1 for c in scene_costs_out if c["status"] == "on-target"),
        "scenesOverBudget": sum(1 for c in scene_costs_out if c["status"] == "over"),
        "budgetVariance": round(variance),
        "budgetVariancePercentage": round(variance_pct, 1),
    }

    return {
        "success": True,
        "config": config_response,
        "sceneCosts": scene_costs_out,
        "summary": summary,
    }


@router.post("/projects/{project_id}/calculate")
def calculate_scene_costs(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Load budget and scenes, run calculation, cache results, return full response."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    _ensure_project_exists(db, project_id)

    budget = db.exec(
        select(Budget).where(Budget.project_id == uuid.UUID(project_id))
    ).first()
    if not budget or budget.total_budget <= 0:
        raise HTTPException(
            status_code=400,
            detail="No budget set for this project. Please set a budget first.",
        )
    total_budget = float(budget.total_budget)
    strategy_id = budget.template_id or DEFAULT_STRATEGY

    script = _get_current_script_for_project(db, project_id)
    if not script:
        raise HTTPException(
            status_code=400,
            detail="No script found for this project.",
        )

    config_row = db.exec(
        select(SceneCostConfig).where(
            SceneCostConfig.project_id == uuid.UUID(project_id)
        )
    ).first()
    if not config_row:
        config_row = SceneCostConfig(
            project_id=uuid.UUID(project_id),
            shoot_days=30,
            strategy_id=strategy_id,
        )
        db.add(config_row)
        db.commit()
        db.refresh(config_row)

    shoot_days = config_row.shoot_days
    allocatable = _calculate_allocatable_budget(total_budget, strategy_id)
    base_cost_per_eighth = _calculate_base_cost_per_eighth(allocatable, shoot_days)

    scenes = list(
        db.exec(
            select(Scene)
            .where(Scene.script_id == script.id)
            .order_by(Scene.scene_number, Scene.id)
        ).all()
    )
    if not scenes:
        raise HTTPException(
            status_code=400,
            detail="No scenes found for this project.",
        )

    scene_characters = list(
        db.exec(
            select(SceneCharacter, Character)
            .join(Character, SceneCharacter.character_id == Character.id)
            .join(Scene, SceneCharacter.scene_id == Scene.id)
            .where(Scene.script_id == script.id)
        ).all()
    )
    char_appearances: dict[uuid.UUID, int] = {}
    for sc, _ in scene_characters:
        char_appearances[sc.character_id] = char_appearances.get(sc.character_id, 0) + 1
    total_scenes = len(scenes)
    scene_to_cast_tiers: dict[uuid.UUID, list[str]] = {}
    for sc, char in scene_characters:
        tier = getattr(char, "cast_tier", None) or _infer_cast_tier(
            char_appearances.get(char.id, 0), total_scenes
        )
        scene_to_cast_tiers.setdefault(sc.scene_id, []).append(tier)

    scene_headings: dict[uuid.UUID, tuple[str, str]] = {}
    results = []
    for scene in scenes:
        location_type = getattr(scene, "location_type", None)
        is_night = getattr(scene, "is_night_shoot", None)
        has_stunts = getattr(scene, "has_stunts", None)
        has_vfx = getattr(scene, "has_vfx", None)
        extras = getattr(scene, "extras_count", None) or 0
        if location_type is None and is_night is None and has_stunts is None and has_vfx is None:
            inferred = _infer_scene_complexity(
                scene.heading,
                getattr(scene, "scene_details", None) or getattr(scene, "location_details", None),
            )
            location_type = inferred["location_type"]
            is_night = inferred["is_night_shoot"]
            has_stunts = inferred["has_stunts"]
            has_vfx = inferred["has_vfx"]
            # Optionally persist (legacy does)
            scene.location_type = location_type
            scene.is_night_shoot = is_night
            scene.has_stunts = has_stunts
            scene.has_vfx = has_vfx
            db.add(scene)
        cast_tiers = scene_to_cast_tiers.get(scene.id, [])
        cast_mod = _calculate_cast_modifier(cast_tiers)
        loc_mod = _calculate_location_modifier(location_type)
        comp_mod = _calculate_complexity_modifier(
            is_night or False, has_stunts or False, has_vfx or False, extras
        )
        eighths = scene.length_in_eighths or 1
        one = _calculate_one_scene(
            str(scene.id),
            eighths,
            cast_mod,
            loc_mod,
            comp_mod,
            base_cost_per_eighth,
        )
        one["heading"] = scene.heading
        one["pageNumber"] = scene.page_number or ""
        one["eighths"] = eighths
        scene_headings[scene.id] = (scene.heading, scene.page_number or "")
        results.append(one)

    db.commit()

    # Update config cache fields
    config_row.base_cost_per_eighth = base_cost_per_eighth
    config_row.allocatable_budget = allocatable
    db.add(config_row)

    # Delete old cached costs and insert new
    to_delete = list(
        db.exec(select(SceneCost).where(SceneCost.config_id == config_row.id)).all()
    )
    for row in to_delete:
        db.delete(row)
    for r in results:
        db.add(
            SceneCost(
                scene_id=uuid.UUID(r["sceneId"]),
                config_id=config_row.id,
                base_cost=r["baseCost"],
                cast_modifier=r["castModifier"],
                location_modifier=r["locationModifier"],
                complexity_modifier=r["complexityModifier"],
                final_cost=r["finalCost"],
                target_budget=r["targetBudget"],
                status=r["status"],
                cast_percentage=r["castPercentage"],
                crew_percentage=r["crewPercentage"],
                location_percentage=r["locationPercentage"],
                art_percentage=r["artPercentage"],
                logistics_percentage=r["logisticsPercentage"],
            )
        )
    db.commit()

    total_scene_cost = sum(r["finalCost"] for r in results)
    variance = total_scene_cost - allocatable
    variance_pct = (variance / allocatable * 100) if allocatable else 0.0
    summary = {
        "totalScenes": len(results),
        "totalShootUnits": shoot_days * 8,
        "baseCostPerEighth": round(base_cost_per_eighth),
        "allocatableBudget": round(allocatable),
        "totalSceneCost": round(total_scene_cost),
        "scenesUnderBudget": sum(1 for r in results if r["status"] == "under"),
        "scenesOnTarget": sum(1 for r in results if r["status"] == "on-target"),
        "scenesOverBudget": sum(1 for r in results if r["status"] == "over"),
        "budgetVariance": round(variance),
        "budgetVariancePercentage": round(variance_pct, 1),
    }

    config_out = {
        "shootDays": shoot_days,
        "strategyId": config_row.strategy_id,
        "totalBudget": total_budget,
        "baseCostPerEighth": round(base_cost_per_eighth),
        "allocatableBudget": round(allocatable),
    }
    return {
        "success": True,
        "config": config_out,
        "sceneCosts": results,
        "summary": summary,
    }


@router.put("/projects/{project_id}/config")
def update_scene_cost_config(
    project_id: str,
    body: ConfigUpdateBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Update shoot days and strategy; clear cached costs."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    config_row = db.exec(
        select(SceneCostConfig).where(
            SceneCostConfig.project_id == uuid.UUID(project_id)
        )
    ).first()
    if not config_row:
        config_row = SceneCostConfig(
            project_id=uuid.UUID(project_id),
            shoot_days=body.shootDays,
        )
        db.add(config_row)
    else:
        config_row.shoot_days = body.shootDays
        db.add(config_row)
        for row in db.exec(select(SceneCost).where(SceneCost.config_id == config_row.id)).all():
            db.delete(row)
    db.commit()
    db.refresh(config_row)

    budget = db.exec(
        select(Budget).where(Budget.project_id == uuid.UUID(project_id))
    ).first()
    total_budget = float(budget.total_budget) if budget else 0.0
    strategy_id = (budget.template_id or DEFAULT_STRATEGY) if budget else DEFAULT_STRATEGY
    return {
        "success": True,
        "config": {
            "shootDays": config_row.shoot_days,
            "strategyId": strategy_id,
            "totalBudget": total_budget,
        },
        "message": "Config updated. Costs will be recalculated on next request.",
    }


@router.put("/scenes/{scene_id}/modifiers")
def update_scene_modifiers(
    scene_id: str,
    body: SceneModifiersBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Update scene modifier fields; invalidate cached costs for this scene."""
    user_id = session.get_user_id()
    scene = db.get(Scene, uuid.UUID(scene_id))
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    script = db.get(Script, scene.script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    _ensure_project_member(db, str(script.project_id), user_id)

    updates = body.model_dump(exclude_unset=True)
    name_map = {
        "locationType": "location_type",
        "isNightShoot": "is_night_shoot",
        "hasStunts": "has_stunts",
        "hasVfx": "has_vfx",
        "extrasCount": "extras_count",
        "creativeImpact": "creative_impact",
    }
    for k, v in updates.items():
        col = name_map.get(k, k)
        if hasattr(scene, col):
            setattr(scene, col, v)
    db.add(scene)
    # Delete cached scene costs for this scene (any config)
    for row in db.exec(select(SceneCost).where(SceneCost.scene_id == scene.id)).all():
        db.delete(row)
    db.commit()
    return {"success": True, "message": "Scene modifiers updated. Costs will be recalculated."}


@router.get("/projects/{project_id}/summary")
def get_scene_cost_summary(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Return aggregated summary from cached scene costs."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    config_row = db.exec(
        select(SceneCostConfig).where(
            SceneCostConfig.project_id == uuid.UUID(project_id)
        )
    ).first()
    if not config_row:
        return {
            "success": True,
            "summary": None,
            "message": "No costs calculated yet.",
        }

    rows = list(db.exec(select(SceneCost).where(SceneCost.config_id == config_row.id)).all())
    if not rows:
        return {
            "success": True,
            "summary": None,
            "message": "No costs calculated yet.",
        }

    total_scene_cost = sum(r.final_cost for r in rows)
    allocatable = config_row.allocatable_budget or 0
    variance = total_scene_cost - allocatable
    variance_pct = (variance / allocatable * 100) if allocatable else 0
    summary = {
        "totalScenes": len(rows),
        "totalShootUnits": config_row.shoot_days * 8,
        "baseCostPerEighth": config_row.base_cost_per_eighth or 0,
        "allocatableBudget": allocatable,
        "totalSceneCost": round(total_scene_cost),
        "scenesUnderBudget": sum(1 for r in rows if r.status == "under"),
        "scenesOnTarget": sum(1 for r in rows if r.status == "on-target"),
        "scenesOverBudget": sum(1 for r in rows if r.status == "over"),
        "budgetVariance": round(variance),
        "budgetVariancePercentage": round(variance_pct, 1),
    }
    return {"success": True, "summary": summary}
