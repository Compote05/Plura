from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters: dict


@dataclass
class ToolResult:
    text: str
    result_type: str  # "chart" | "news" | "market_overview" | "text"
    data: dict = field(default_factory=dict)


class CapabilityBase:
    id: str = ""
    name: str = ""
    description: str = ""
    icon: str = ""
    color: str = ""

    @property
    def tools(self) -> list[ToolDefinition]:
        raise NotImplementedError

    async def execute(self, tool_name: str, args: dict) -> ToolResult:
        raise NotImplementedError

    def to_ollama_tools(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
            }
            for t in self.tools
        ]
