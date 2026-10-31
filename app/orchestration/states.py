"""
Task and Step states for SUNDAY workflow engine.
"""
from enum import Enum


class TaskState(str, Enum):
    QUEUED = "queued"
    READY = "ready"
    RUNNING = "running"
    WAITING_FOR_OWNER = "waiting_for_owner"
    WAITING_FOR_RESOURCE = "waiting_for_resource"
    FAILED = "failed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


VALID_TRANSITIONS = {
    TaskState.QUEUED: {TaskState.READY, TaskState.CANCELLED},
    TaskState.READY: {TaskState.RUNNING, TaskState.WAITING_FOR_OWNER, TaskState.WAITING_FOR_RESOURCE, TaskState.CANCELLED},
    TaskState.RUNNING: {TaskState.COMPLETED, TaskState.READY, TaskState.WAITING_FOR_OWNER, TaskState.WAITING_FOR_RESOURCE, TaskState.FAILED, TaskState.CANCELLED},
    TaskState.WAITING_FOR_OWNER: {TaskState.READY, TaskState.CANCELLED, TaskState.EXPIRED},
    TaskState.WAITING_FOR_RESOURCE: {TaskState.READY, TaskState.CANCELLED, TaskState.FAILED},
    TaskState.FAILED: {TaskState.READY, TaskState.CANCELLED},
    TaskState.COMPLETED: set(),  # terminal
    TaskState.CANCELLED: set(),  # terminal
    TaskState.EXPIRED: set()     # terminal
}


def can_transition(current: TaskState, target: TaskState) -> bool:
    return target in VALID_TRANSITIONS.get(current, set())

