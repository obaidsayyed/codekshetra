"""
Base classes and contracts for SUNDAY tools.
"""
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, Type
from pydantic import BaseModel
from app.permissions.policy import RiskLevel


@dataclass
class ToolResult:
    success: bool
    data: Dict[str, Any] = field(default_factory=dict)
    output_path: Optional[str] = None
    evidence: str = ""
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "data": self.data,
            "output_path": self.output_path,
            "evidence": self.evidence,
            "error": self.error
        }


class EmptyInput(BaseModel):
    pass


class BaseTool:
    name: str = ""
    description: str = ""
    input_schema: Type[BaseModel] = EmptyInput
    risk_level: RiskLevel = RiskLevel.R0
    execution_type: str = "LOCAL"  # LOCAL or NETWORK
    
    def execute(self, **kwargs) -> ToolResult:
        raise NotImplementedError("Subclasses must implement execute()")
