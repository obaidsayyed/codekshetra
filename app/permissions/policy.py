"""
Risk policy and classification for SUNDAY.
"""
from enum import Enum
from typing import Dict, Any


class RiskLevel(str, Enum):
    R0 = "R0"  # Read-only
    R1 = "R1"  # Reversible creation in approved workspace
    R2 = "R2"  # Modify / move / overwrite / state-changing
    R3 = "R3"  # Destructive / privileged
    R4 = "R4"  # Financial / live external network (blocked in offline v1)


TOOL_RISK_MAP: Dict[str, RiskLevel] = {
    # Filesystem
    "list_directory": RiskLevel.R0,
    "search_files": RiskLevel.R0,
    "read_document": RiskLevel.R0,
    "copy_file": RiskLevel.R1,
    "create_folder": RiskLevel.R1,
    "move_to_archive": RiskLevel.R2,
    "delete_file": RiskLevel.R3,
    
    # Documents
    "create_invoice": RiskLevel.R1,
    "create_email_draft": RiskLevel.R1,
    "create_message_draft": RiskLevel.R1,
    "create_spreadsheet": RiskLevel.R1,
    "read_pdf": RiskLevel.R0,
    
    # Desktop automation
    "visual_open_and_type": RiskLevel.R1,
    "launch_application": RiskLevel.R1,
    
    # Memory
    "save_memory_note": RiskLevel.R1,
    "search_memory": RiskLevel.R0,
    
    # Network / External
    "check_network_status": RiskLevel.R0,
    "send_email_live": RiskLevel.R4,
    "external_web_request": RiskLevel.R4,
}


def get_tool_risk(tool_name: str) -> RiskLevel:
    return TOOL_RISK_MAP.get(tool_name, RiskLevel.R2)

