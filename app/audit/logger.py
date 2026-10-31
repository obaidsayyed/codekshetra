"""
Audit logger for SUNDAY.
Structured logging with automatic secret redaction.
"""
import logging
import re
import sys
from pathlib import Path
from typing import Any, Dict
from app.config.settings import settings

REDACTION_PATTERNS = [
    re.compile(r'(password\s*[:=]\s*)([^\s,]+)', re.IGNORECASE),
    re.compile(r'(token\s*[:=]\s*)([^\s,]+)', re.IGNORECASE),
    re.compile(r'(secret\s*[:=]\s*)([^\s,]+)', re.IGNORECASE),
    re.compile(r'(pin\s*[:=]\s*)([^\s,]+)', re.IGNORECASE),
    re.compile(r'(api[_-]?key\s*[:=]\s*)([^\s,]+)', re.IGNORECASE),
]


def redact_secrets(text: str) -> str:
    """Redacts potential secrets, passwords, or tokens from log text."""
    if not isinstance(text, str):
        text = str(text)
    for pattern in REDACTION_PATTERNS:
        text = pattern.sub(r'\1[REDACTED]', text)
    return text


class AuditFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        msg = super().format(record)
        return redact_secrets(msg)


def setup_logger(name: str = "SUNDAY") -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
        
    logger.setLevel(logging.INFO)
    formatter = AuditFormatter(
        "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    # Console handler
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(formatter)
    logger.addHandler(ch)
    
    # File handler in data/
    log_file = settings.data_dir / "sunday.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setLevel(logging.INFO)
    fh.setFormatter(formatter)
    logger.addHandler(fh)
    
    return logger


audit_logger = setup_logger()

