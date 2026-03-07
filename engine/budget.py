"""
Budget API: GET/POST budget by project, PUT line items.
Paths: /api/budget/projects/{project_id}/budget, .../generate, .../line-items/{id}
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from db import get_session
from models import Budget, BudgetLineItem, Project, ProjectMember
from supertokens_python.recipe.session.framework.fastapi import verify_session
from supertokens_python.recipe.session import SessionContainer

router = APIRouter(prefix="/api/budget", tags=["budget"])


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


# --- Response / Request schemas (match web types) ---

class BudgetResponse(BaseModel):
    total_budget: float
    template_id: Optional[str] = None
    currency: Optional[str] = None


class BudgetLineItemResponse(BaseModel):
    id: str
    view_type: str
    category: Optional[str] = None
    phase: Optional[str] = None
    account_code: Optional[str] = None
    item_name: str
    notes: Optional[str] = None
    estimated_amount: Optional[float] = None
    percentage: Optional[float] = None

    class Config:
        from_attributes = True


class BudgetDataResponse(BaseModel):
    budget: Optional[BudgetResponse] = None
    lineItems: Optional[List[BudgetLineItemResponse]] = None


class GenerateBody(BaseModel):
    totalBudget: float
    currency: str = "GBP"
    strategy: str = "producer-centric"


def _line_item_to_response(item: BudgetLineItem) -> BudgetLineItemResponse:
    return BudgetLineItemResponse(
        id=str(item.id),
        view_type=item.view_type,
        category=item.category,
        phase=item.phase,
        account_code=item.account_code,
        item_name=item.item_name,
        notes=item.notes,
        estimated_amount=item.estimated_amount,
        percentage=item.percentage,
    )


# Template: allocation of total_budget across categories/phases for generate.
def _build_template_line_items(budget_id: uuid.UUID, total_budget: float, strategy: str) -> List[BudgetLineItem]:
    """Build a default set of line items (template, timeline, marketing) that sum to total_budget."""
    items: List[BudgetLineItem] = []
    so = 0

    # Template tab: categories with account codes (production-style)
    template_alloc = [
        ("Above the Line", "1000", "Script & Development", 15.0),
        ("Above the Line", "1100", "Director", 12.0),
        ("Above the Line", "1200", "Cast", 25.0),
        ("Below the Line", "2000", "Production", 18.0),
        ("Below the Line", "2100", "Art Department", 8.0),
        ("Below the Line", "2200", "Camera & Grip", 7.0),
        ("Post-Production", "3000", "Picture Edit", 5.0),
        ("Post-Production", "3100", "Sound & Music", 5.0),
        ("Other", "4000", "Contingency", 5.0),
    ]
    for category, code, name, pct in template_alloc:
        amt = round(total_budget * (pct / 100.0), 2)
        items.append(BudgetLineItem(
            budget_id=budget_id,
            view_type="template",
            category=category,
            account_code=code,
            item_name=name,
            estimated_amount=amt,
            percentage=pct,
            sort_order=so,
        ))
        so += 1

    # Timeline tab: same logical items spread across phases
    phases = ["Pre-Production", "Production", "Post-Production"]
    phase_pcts = [20.0, 55.0, 25.0]
    for phase, phase_pct in zip(phases, phase_pcts):
        for category, code, name, pct in template_alloc[:6]:  # subset
            amt = round(total_budget * (pct / 100.0) * (phase_pct / 100.0), 2)
            if amt <= 0:
                continue
            items.append(BudgetLineItem(
                budget_id=budget_id,
                view_type="timeline",
                category=category,
                phase=phase,
                account_code=code,
                item_name=name,
                estimated_amount=amt,
                sort_order=so,
            ))
            so += 1

    # Marketing tab
    marketing_alloc = [
        ("Festival & Markets", "Festival Submissions", 3.0),
        ("Festival & Markets", "Travel & Accommodation", 2.0),
        ("Publicity", "PR & Press", 2.0),
        ("Publicity", "Social & Digital", 1.5),
        ("Distribution", "Trailer & Materials", 1.5),
    ]
    for category, name, pct in marketing_alloc:
        amt = round(total_budget * (pct / 100.0), 2)
        items.append(BudgetLineItem(
            budget_id=budget_id,
            view_type="marketing",
            category=category,
            item_name=name,
            estimated_amount=amt,
            sort_order=so,
        ))
        so += 1

    return items


@router.get("/projects/{project_id}/budget", response_model=BudgetDataResponse)
def get_budget(
    project_id: str,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Return budget and line items for the project. 404 if no budget yet."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    _ensure_project_exists(db, project_id)

    budget = db.exec(
        select(Budget).where(Budget.project_id == uuid.UUID(project_id))
    ).first()
    if not budget:
        return BudgetDataResponse(budget=None, lineItems=[])

    line_items = db.exec(
        select(BudgetLineItem).where(BudgetLineItem.budget_id == budget.id).order_by(BudgetLineItem.sort_order)
    ).all()

    return BudgetDataResponse(
        budget=BudgetResponse(
            total_budget=budget.total_budget,
            template_id=budget.template_id,
            currency=budget.currency,
        ),
        lineItems=[_line_item_to_response(li) for li in line_items],
    )


@router.post("/projects/{project_id}/budget/generate", response_model=BudgetDataResponse)
def generate_budget(
    project_id: str,
    body: GenerateBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Create or replace budget and line items for the project."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)
    _ensure_project_exists(db, project_id)

    if body.totalBudget <= 0:
        raise HTTPException(status_code=400, detail="totalBudget must be positive")

    project_uuid = uuid.UUID(project_id)
    budget = db.exec(select(Budget).where(Budget.project_id == project_uuid)).first()

    if budget:
        # Delete existing line items
        existing = db.exec(select(BudgetLineItem).where(BudgetLineItem.budget_id == budget.id)).all()
        for li in existing:
            db.delete(li)
        budget.total_budget = body.totalBudget
        budget.template_id = body.strategy
        budget.currency = body.currency or "GBP"
        db.add(budget)
        db.commit()
        db.refresh(budget)
        budget_id = budget.id
    else:
        budget = Budget(
            project_id=project_uuid,
            total_budget=body.totalBudget,
            template_id=body.strategy,
            currency=body.currency or "GBP",
        )
        db.add(budget)
        db.commit()
        db.refresh(budget)
        budget_id = budget.id

    line_items = _build_template_line_items(budget_id, float(body.totalBudget), body.strategy)
    for li in line_items:
        db.add(li)
    db.commit()

    # Reload for response
    line_items = db.exec(
        select(BudgetLineItem).where(BudgetLineItem.budget_id == budget_id).order_by(BudgetLineItem.sort_order)
    ).all()

    return BudgetDataResponse(
        budget=BudgetResponse(
            total_budget=budget.total_budget,
            template_id=budget.template_id,
            currency=budget.currency,
        ),
        lineItems=[_line_item_to_response(li) for li in line_items],
    )


class LineItemUpdateBody(BaseModel):
    category: Optional[str] = None
    phase: Optional[str] = None
    account_code: Optional[str] = None
    item_name: Optional[str] = None
    notes: Optional[str] = None
    estimated_amount: Optional[float] = None
    percentage: Optional[float] = None


@router.put("/projects/{project_id}/budget/line-items/{line_item_id}", response_model=BudgetLineItemResponse)
def update_line_item(
    project_id: str,
    line_item_id: str,
    body: LineItemUpdateBody,
    session: SessionContainer = Depends(verify_session()),
    db: Session = Depends(get_session),
):
    """Update a single line item. Line item must belong to this project's budget."""
    user_id = session.get_user_id()
    _ensure_project_member(db, project_id, user_id)

    budget = db.exec(
        select(Budget).where(Budget.project_id == uuid.UUID(project_id))
    ).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    item = db.get(BudgetLineItem, uuid.UUID(line_item_id))
    if not item or item.budget_id != budget.id:
        raise HTTPException(status_code=404, detail="Line item not found")

    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(item, key, value)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _line_item_to_response(item)
