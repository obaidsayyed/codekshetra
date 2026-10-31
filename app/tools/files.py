"""
Safe filesystem tools for SUNDAY.
Strict path traversal prevention, allowed root validation, and collision protection.
"""
import os
import shutil
import json
import hashlib
from pathlib import Path
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from app.config.settings import settings
from app.permissions.policy import RiskLevel
from app.tools.base import BaseTool, ToolResult
from app.audit.logger import audit_logger


BLOCKED_SYSTEM_PATHS = [
    Path(r"C:\Windows").resolve(),
    Path(r"C:\Program Files").resolve(),
    Path(r"C:\Program Files (x86)").resolve(),
]


def is_path_allowed(target_path: Path) -> bool:
    """Verifies that the canonical resolved path is within allowed user roots and not in protected system folders."""
    try:
        resolved = target_path.resolve()
        for blocked in BLOCKED_SYSTEM_PATHS:
            if resolved == blocked or blocked in resolved.parents:
                return False
        for root_str in settings.allowed_roots:
            allowed_root = Path(root_str).resolve()
            if resolved == allowed_root or allowed_root in resolved.parents:
                return True
        return False
    except Exception:
        return False


def compute_file_hash(path: Path) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


class ListDirectoryInput(BaseModel):
    directory: str = Field(default="", description="Relative or absolute path under allowed workspace.")


class ListDirectoryTool(BaseTool):
    name = "list_directory"
    description = "List files and folders within an approved directory."
    input_schema = ListDirectoryInput
    risk_level = RiskLevel.R0
    execution_type = "LOCAL"

    def execute(self, directory: str = "") -> ToolResult:
        if not directory:
            target = settings.workspace_root
        else:
            target = Path(directory)
            if not target.is_absolute():
                # Check user profile shortcuts first (e.g. Desktop, Downloads, Documents)
                user_shortcut = Path.home() / directory
                if user_shortcut.exists():
                    target = user_shortcut
                else:
                    target = settings.workspace_root / target
        target = target.resolve()

        if not is_path_allowed(target):
            return ToolResult(
                success=False,
                error=f"Access denied: path '{target}' is outside approved workspace roots."
            )

        if not target.exists() or not target.is_dir():
            return ToolResult(
                success=False,
                error=f"Directory does not exist: '{target}'."
            )

        entries = []
        for item in target.iterdir():
            entries.append({
                "name": item.name,
                "is_dir": item.is_dir(),
                "size_bytes": item.stat().st_size if item.is_file() else 0,
                "path": str(item)
            })

        return ToolResult(
            success=True,
            data={"directory": str(target), "entries": entries, "count": len(entries)},
            evidence=f"Listed {len(entries)} items in {target.name}"
        )


class ReadDocumentInput(BaseModel):
    file_path: str = Field(description="Path to the file to read.")
    max_bytes: int = Field(default=1024 * 1024 * 2, description="Max bytes to read.")


class ReadDocumentTool(BaseTool):
    name = "read_document"
    description = "Read the contents of an approved local text/document file."
    input_schema = ReadDocumentInput
    risk_level = RiskLevel.R0
    execution_type = "LOCAL"

    def execute(self, file_path: str, max_bytes: int = 2097152) -> ToolResult:
        target = Path(file_path)
        if not target.is_absolute():
            user_shortcut = Path.home() / file_path
            if user_shortcut.exists():
                target = user_shortcut
            else:
                target = settings.workspace_root / target
        target = target.resolve()

        if not is_path_allowed(target):
            return ToolResult(
                success=False,
                error=f"Access denied: file '{target}' is outside approved workspace roots."
            )

        if not target.exists() or not target.is_file():
            return ToolResult(
                success=False,
                error=f"File not found: '{target}'."
            )

        file_size = target.stat().st_size
        if file_size > max_bytes:
            return ToolResult(
                success=False,
                error=f"File exceeds max allowed size of {max_bytes} bytes (file size: {file_size} bytes)."
            )

        try:
            content = target.read_text(encoding="utf-8", errors="replace")
            return ToolResult(
                success=True,
                data={"path": str(target), "size_bytes": file_size, "content": content},
                evidence=f"Read {file_size} bytes from {target.name}"
            )
        except Exception as e:
            return ToolResult(success=False, error=f"Error reading file: {str(e)}")


class CreateFolderInput(BaseModel):
    folder_path: str = Field(description="Path of folder to create.")


class CreateFolderTool(BaseTool):
    name = "create_folder"
    description = "Create a new folder inside the approved workspace."
    input_schema = CreateFolderInput
    risk_level = RiskLevel.R1
    execution_type = "LOCAL"

    def execute(self, folder_path: str) -> ToolResult:
        target = Path(folder_path)
        if not target.is_absolute():
            target = settings.workspace_root / target
        target = target.resolve()

        if not is_path_allowed(target):
            return ToolResult(
                success=False,
                error=f"Access denied: destination '{target}' is outside approved roots."
            )

        target.mkdir(parents=True, exist_ok=True)
        return ToolResult(
            success=True,
            output_path=str(target),
            evidence=f"Created folder {target}"
        )


class MoveToArchiveInput(BaseModel):
    source_path: str = Field(description="File to archive.")


class MoveToArchiveTool(BaseTool):
    name = "move_to_archive"
    description = "Move a file to the archive folder with rollback recovery tracking."
    input_schema = MoveToArchiveInput
    risk_level = RiskLevel.R2  # Requires voice approval!
    execution_type = "LOCAL"

    def execute(self, source_path: str) -> ToolResult:
        src = Path(source_path)
        if not src.is_absolute():
            src = settings.workspace_root / src
        src = src.resolve()

        if not is_path_allowed(src):
            return ToolResult(
                success=False,
                error=f"Access denied: file '{src}' is outside approved roots."
            )

        if not src.exists():
            return ToolResult(success=False, error=f"Source file '{src}' does not exist.")

        archive_dir = settings.archive_dir
        archive_dir.mkdir(parents=True, exist_ok=True)
        dest = archive_dir / src.name

        # Prevent collision: add suffix if exists
        counter = 1
        stem = src.stem
        ext = src.suffix
        while dest.exists():
            dest = archive_dir / f"{stem}_v{counter}{ext}"
            counter += 1

        mtime = str(src.stat().st_mtime)
        shutil.move(str(src), str(dest))
        
        # Save recovery mapping
        recovery_log = settings.recovery_dir / "recovery_map.json"
        recovery_log.parent.mkdir(parents=True, exist_ok=True)
        records = []
        if recovery_log.exists():
            try:
                records = json.loads(recovery_log.read_text(encoding="utf-8"))
            except Exception:
                records = []
        records.append({
            "original_path": str(src),
            "archive_path": str(dest),
            "timestamp": mtime
        })
        recovery_log.write_text(json.dumps(records, indent=2), encoding="utf-8")

        audit_logger.info("Moved file %s to archive %s", src, dest)
        return ToolResult(
            success=True,
            output_path=str(dest),
            data={"original_path": str(src), "archive_path": str(dest)},
            evidence=f"Moved {src.name} to {dest.name} with recovery mapping stored."
        )
