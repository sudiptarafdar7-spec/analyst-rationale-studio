"""Admin AI model management: per-task provider/model, global fallback, tool configs."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.deps import require_admin
from db.enums import AiTask, ApiProvider
from db.models import AiModel, ModelSettings, ToolConfig, User
from db.session import get_db
from schemas.ai_models import (
    AiModelMapping,
    AiModelsOut,
    AiModelUpdate,
    ModelSettingsOut,
    ModelSettingsUpdate,
    ToolConfigOut,
    ToolConfigUpdate,
)
from tools.config_registry import (
    AI_PROVIDERS,
    TASK_TOOL,
    TOOL_SCHEMAS,
    default_config,
    get_effective_config,
    is_known_tool,
)

router = APIRouter(prefix="/admin", tags=["admin:ai-models"])

GLOBAL_MODEL_SENTINEL = "__global__"


def _settings_row(db: Session) -> ModelSettings:
    row = db.get(ModelSettings, 1)
    if row is None:
        row = ModelSettings(id=1, global_model="gpt-4o")
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


# --- AI model mappings ------------------------------------------------------
@router.get("/ai-models", response_model=AiModelsOut)
def get_ai_models(db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> AiModelsOut:
    rows = {r.task: r for r in db.scalars(select(AiModel)).all()}
    models = []
    for task in AiTask:
        r = rows.get(task)
        models.append(
            AiModelMapping(
                task=task,
                provider=r.provider if r else ApiProvider.openai,
                model_name=r.model_name if r else GLOBAL_MODEL_SENTINEL,
                tool=TASK_TOOL[task.value],
            )
        )
    s = _settings_row(db)
    return AiModelsOut(
        models=models,
        settings=ModelSettingsOut(global_model=s.global_model, advanced_model=s.advanced_model),
    )


@router.put("/ai-models/{task}", response_model=AiModelMapping)
def update_ai_model(
    task: AiTask,
    body: AiModelUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AiModelMapping:
    if body.provider.value not in AI_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"provider must be one of {AI_PROVIDERS}",
        )
    row = db.scalar(select(AiModel).where(AiModel.task == task))
    if row is None:
        row = AiModel(task=task, provider=body.provider, model_name=body.model_name)
        db.add(row)
    else:
        row.provider = body.provider
        row.model_name = body.model_name
    db.commit()
    db.refresh(row)
    return AiModelMapping(task=row.task, provider=row.provider, model_name=row.model_name, tool=TASK_TOOL[task.value])


# --- global / advanced fallback model --------------------------------------
@router.get("/model-settings", response_model=ModelSettingsOut)
def get_model_settings(db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> ModelSettingsOut:
    s = _settings_row(db)
    return ModelSettingsOut(global_model=s.global_model, advanced_model=s.advanced_model)


@router.put("/model-settings", response_model=ModelSettingsOut)
def update_model_settings(
    body: ModelSettingsUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ModelSettingsOut:
    s = _settings_row(db)
    s.global_model = body.global_model.strip()
    s.advanced_model = (body.advanced_model or None)
    db.commit()
    db.refresh(s)
    return ModelSettingsOut(global_model=s.global_model, advanced_model=s.advanced_model)


# --- per-tool advanced config ----------------------------------------------
def _coerce(tool: str, raw: dict) -> dict:
    """Keep only known fields and coerce values to the field's declared type."""
    out: dict = {}
    for field in TOOL_SCHEMAS[tool]["fields"]:
        name, ftype = field["name"], field["type"]
        if name not in raw:
            continue
        val = raw[name]
        if ftype == "number":
            try:
                num = float(val)
            except (TypeError, ValueError):
                continue
            # integer field if its default/step are integers
            if float(field.get("step", 1)).is_integer() and float(field.get("default", 0)).is_integer():
                num = int(round(num))
            out[name] = num
        else:
            out[name] = "" if val is None else str(val)
    return out


@router.get("/tool-configs/{tool}", response_model=ToolConfigOut)
def get_tool_config(tool: str, db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> ToolConfigOut:
    if not is_known_tool(tool):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown tool")
    row = db.scalar(select(ToolConfig).where(ToolConfig.tool == tool))
    meta = TOOL_SCHEMAS[tool]
    return ToolConfigOut(
        tool=tool,
        label=meta["label"],
        task=meta["task"],
        fields=meta["fields"],
        config=get_effective_config(tool, row.config if row else None),
    )


@router.put("/tool-configs/{tool}", response_model=ToolConfigOut)
def update_tool_config(
    tool: str,
    body: ToolConfigUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ToolConfigOut:
    if not is_known_tool(tool):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown tool")
    cleaned = _coerce(tool, body.config)
    row = db.scalar(select(ToolConfig).where(ToolConfig.tool == tool))
    if row is None:
        row = ToolConfig(tool=tool, config=cleaned, updated_by=admin.id)
        db.add(row)
    else:
        row.config = cleaned
        row.updated_by = admin.id
    db.commit()
    db.refresh(row)
    meta = TOOL_SCHEMAS[tool]
    return ToolConfigOut(
        tool=tool,
        label=meta["label"],
        task=meta["task"],
        fields=meta["fields"],
        config=get_effective_config(tool, row.config),
    )
