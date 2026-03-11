from __future__ import annotations
import importlib
import pkgutil
import logging
from app.capabilities.base import CapabilityBase

logger = logging.getLogger(__name__)


class CapabilityRegistry:
    def __init__(self) -> None:
        self._capabilities: dict[str, CapabilityBase] = {}

    def register(self, cap: CapabilityBase) -> None:
        self._capabilities[cap.id] = cap

    def get(self, cap_id: str) -> CapabilityBase | None:
        return self._capabilities.get(cap_id)

    def find_tool(self, tool_name: str) -> tuple[CapabilityBase, str] | None:
        for cap in self._capabilities.values():
            for tool in cap.tools:
                if tool.name == tool_name:
                    return (cap, tool_name)
        return None

    def all(self) -> list[CapabilityBase]:
        return list(self._capabilities.values())

    def get_tools_for(self, capability_ids: list[str]) -> list[dict]:
        tools = []
        for cap_id in capability_ids:
            cap = self.get(cap_id)
            if cap:
                tools.extend(cap.to_ollama_tools())
        return tools

    def autodiscover(self) -> None:
        import app.capabilities as pkg
        for finder, name, _ in pkgutil.iter_modules(pkg.__path__):
            if name in ("base", "registry"):
                continue
            try:
                mod = importlib.import_module(f"app.capabilities.{name}")
                if hasattr(mod, "capability"):
                    self.register(mod.capability)
                    logger.info("Registered capability: %s", mod.capability.id)
            except Exception as e:
                logger.warning("Failed to load capability '%s': %s", name, e)


registry = CapabilityRegistry()
