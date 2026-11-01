"""
Multi-Day Autonomous Workflow Tool for SUNDAY.
Allows SUNDAY to trigger, manage, and report on multi-day month-end financial closing.
"""
from typing import Optional
from pydantic import BaseModel, Field

from app.tools.base import BaseTool, ToolResult, RiskLevel
class MonthEndCloseInput(BaseModel):
    compress_time: bool = Field(default=True, description="Whether to run multi-day workflow compressed into a single verified session.")
    auto_approve: bool = Field(default=True, description="Whether owner voice approval has been granted for the GST return filing step.")


class RunMonthEndCloseTool(BaseTool):
    name = "run_month_end_close"
    description = "Executes the autonomous month-end financial close for the business: ingests WhatsApp/Email invoices, reconciles bank statements, calls overdue customers in Hindi, operates the GST Portal without APIs, and files GSTR-1 with owner approval."
    input_schema = MonthEndCloseInput
    risk_level = RiskLevel.R1
    execution_type = "HYBRID"

    def execute(self, compress_time: bool = True, auto_approve: bool = True) -> ToolResult:
        from app.orchestration.multiday import multiday_workflow
        result = multiday_workflow.execute_all_days(
            compress_time=compress_time,
            auto_approve=auto_approve
        )
        return ToolResult(
            success=result["success"],
            data=result,
            evidence=result["spoken_summary"]
        )


month_end_close_tool = RunMonthEndCloseTool()
