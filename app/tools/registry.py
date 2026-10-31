"""
Tool Registry for SUNDAY.
Validates parameters with Pydantic, checks risk policies, manages offline boundaries, and records audit evidence.
"""
from typing import Dict, Any, Optional, Type
from pydantic import ValidationError
from app.tools.base import BaseTool, ToolResult
from app.permissions.policy import RiskLevel, get_tool_risk
from app.permissions.approvals import approval_manager
from app.tools.files import (
    ListDirectoryTool, ReadDocumentTool, CreateFolderTool, MoveToArchiveTool
)
from app.tools.documents import (
    CreateInvoiceTool, CreateEmailDraftTool, CreateMessageDraftTool,
    CreateSpreadsheetTool, ReadPdfTool
)
from app.tools.windows import VisualOpenAndTypeTool
from app.tools.laptop import (
    LaunchAppTool, OpenFolderTool, SystemStatusTool, SearchLaptopFilesTool, ScheduleMeetingTool
)
from app.tools.network import requires_internet, is_online
from app.audit.logger import audit_logger
from app.audit.events import AuditEvent
from app.memory.repositories import AuditEventRepository


class ToolRegistry:
    def __init__(self, audit_repo: Optional[AuditEventRepository] = None):
        self.audit_repo = audit_repo or AuditEventRepository()
        self._tools: Dict[str, BaseTool] = {}
        self._register_default_tools()

    def register(self, tool: BaseTool) -> None:
        self._tools[tool.name] = tool
        audit_logger.debug("Registered tool: %s (%s)", tool.name, tool.risk_level)

    def _register_default_tools(self) -> None:
        tools = [
            ListDirectoryTool(),
            ReadDocumentTool(),
            CreateFolderTool(),
            MoveToArchiveTool(),
            CreateInvoiceTool(),
            CreateEmailDraftTool(),
            CreateMessageDraftTool(),
            CreateSpreadsheetTool(),
            ReadPdfTool(),
            VisualOpenAndTypeTool(),
            LaunchAppTool(),
            OpenFolderTool(),
            SystemStatusTool(),
            SearchLaptopFilesTool(),
            ScheduleMeetingTool()
        ]
        for t in tools:
            self.register(t)

    def get_tool(self, name: str) -> Optional[BaseTool]:
        return self._tools.get(name)

    def list_tools(self) -> Dict[str, Dict[str, Any]]:
        return {
            name: {
                "description": tool.description,
                "risk_level": tool.risk_level.value,
                "execution_type": tool.execution_type,
                "schema": tool.input_schema.model_json_schema()
            }
            for name, tool in self._tools.items()
        }

    def execute_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        task_id: Optional[str] = None,
        task_step_id: Optional[str] = None,
        is_approval_confirmed: bool = False
    ) -> Dict[str, Any]:
        """
        Validates, authorizes, and executes a tool.
        Returns execution result dict or approval requirement dict.
        """
        tool = self.get_tool(tool_name)
        if not tool:
            return {
                "success": False,
                "error": f"Tool '{tool_name}' is not registered.",
                "status": "error"
            }

        # 1. Parameter validation via Pydantic
        try:
            validated_model = tool.input_schema(**arguments)
            validated_kwargs = validated_model.model_dump()
        except ValidationError as ve:
            audit_logger.warning("Parameter validation failed for %s: %s", tool_name, ve)
            return {
                "success": False,
                "error": f"Invalid arguments for tool '{tool_name}': {str(ve)}",
                "status": "validation_error"
            }

        # 2. Check Internet Connectivity Requirement
        if requires_internet(tool_name, validated_kwargs):
            if not is_online():
                audit_logger.info("Tool '%s' requires internet, but device is offline.", tool_name)
                return {
                    "success": False,
                    "status": "waiting_for_resource",
                    "resource": "internet_connection",
                    "spoken_message": "This device is currently offline. This action requires internet connectivity. It has been queued and will automatically execute when internet is available."
                }

        # 3. Check Risk Policy and Voice Approval Requirement
        risk = tool.risk_level
        if risk in (RiskLevel.R2, RiskLevel.R3) and not is_approval_confirmed:
            # Generate spoken prompt
            step_id = task_step_id or "adhoc"
            prompt_text = f"Tool {tool_name} requires your authorization to proceed. Do you approve?"
            if tool_name == "move_to_archive":
                target = validated_kwargs.get("source_path", "file")
                prompt_text = f"SUNDAY is about to move '{target}' to archive. Nothing will be permanently deleted. Do you approve?"

            req = approval_manager.create_request(step_id, tool_name, validated_kwargs, prompt_text)
            return {
                "success": False,
                "status": "waiting_for_owner",
                "approval_id": req.id,
                "action_hash": req.action_hash,
                "spoken_prompt": prompt_text,
                "risk_level": risk.value
            }

        # 4. Execute tool
        try:
            result: ToolResult = tool.execute(**validated_kwargs)
            # Log audit event
            event = AuditEvent(
                task_id=task_id,
                tool_name=tool_name,
                action="execute",
                params_redacted=str(validated_kwargs),
                result="success" if result.success else "failed",
                evidence_path=result.output_path or result.evidence
            )
            self.audit_repo.log_event(event)
            return {
                "success": result.success,
                "data": result.data,
                "output_path": result.output_path,
                "evidence": result.evidence,
                "error": result.error,
                "status": "completed" if result.success else "failed"
            }
        except Exception as e:
            audit_logger.exception("Unexpected error executing tool %s: %s", tool_name, e)
            return {
                "success": False,
                "error": str(e),
                "status": "failed"
            }


tool_registry = ToolRegistry()

