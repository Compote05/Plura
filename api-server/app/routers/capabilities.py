from __future__ import annotations
import logging

from fastapi import APIRouter, Depends, HTTPException

from app.auth import AuthenticatedUser, get_current_user
from app.capabilities.registry import registry

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/capabilities", tags=["capabilities"])


@router.get("")
async def list_capabilities(_user: AuthenticatedUser = Depends(get_current_user)) -> list[dict]:
    return [
        {
            "id": cap.id,
            "name": cap.name,
            "description": cap.description,
            "icon": cap.icon,
            "color": cap.color,
            "tools": [{"name": t.name, "description": t.description} for t in cap.tools],
        }
        for cap in registry.all()
    ]


@router.get("/tools")
async def get_ollama_tools(
    ids: str,
    _user: AuthenticatedUser = Depends(get_current_user),
) -> list[dict]:
    capability_ids = [i.strip() for i in ids.split(",") if i.strip()]
    return registry.get_tools_for(capability_ids)


@router.post("/execute")
async def execute_tool(
    body: dict,
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict:
    capability_id: str = body.get("capability_id", "")
    tool_name: str = body.get("tool_name", "")
    args: dict = body.get("args", {})

    if capability_id:
        cap = registry.get(capability_id)
        if not cap:
            raise HTTPException(status_code=404, detail=f"Capability '{capability_id}' not found")
        result = await cap.execute(tool_name, args)
    else:
        found = registry.find_tool(tool_name)
        if not found:
            raise HTTPException(status_code=404, detail=f"No capability found for tool '{tool_name}'")
        cap, _ = found
        result = await cap.execute(tool_name, args)

    return {"text": result.text, "result_type": result.result_type, "data": result.data}
