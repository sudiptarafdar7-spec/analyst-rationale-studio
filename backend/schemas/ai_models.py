"""Pydantic schemas for AI model management + tool configs."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from db.enums import AiTask, ApiProvider


class AiModelMapping(BaseModel):
    task: AiTask
    provider: ApiProvider
    model_name: str
    tool: str  # backing pipeline tool


class ModelSettingsOut(BaseModel):
    global_model: str
    advanced_model: str | None = None


class ModelOption(BaseModel):
    value: str
    label: str


class AiModelsOut(BaseModel):
    models: list[AiModelMapping]
    settings: ModelSettingsOut
    catalog: dict[str, list[ModelOption]]


class AiModelUpdate(BaseModel):
    provider: ApiProvider
    model_name: str = Field(min_length=1, max_length=200)


class ModelSettingsUpdate(BaseModel):
    global_model: str = Field(min_length=1, max_length=200)
    advanced_model: str | None = Field(default=None, max_length=200)


class ToolConfigOut(BaseModel):
    tool: str
    label: str
    task: str
    fields: list[dict[str, Any]]   # CONFIG_JSON_SCHEMA field descriptors
    config: dict[str, Any]         # effective config (defaults ⊕ saved overrides)


class ToolConfigUpdate(BaseModel):
    config: dict[str, Any]
