"""
Startup crash recovery for SUNDAY.
Restores unfinished workflows without duplicating completed side effects.
"""
from typing import List, Dict, Any
from app.memory.models import TaskRecord
from app.memory.repositories import TaskRepository
from app.orchestration.states import TaskState
from app.orchestration.engine import workflow_engine, WorkflowEngine
from app.tools.network import is_online
from app.audit.logger import audit_logger


class CrashRecoveryManager:
    def __init__(self, task_repo: TaskRepository = None, engine: WorkflowEngine = None):
        self.repo = task_repo or TaskRepository()
        self.engine = engine or workflow_engine

    def recover(self) -> Dict[str, Any]:
        """
        Scans SQLite on startup for interrupted tasks.
        Resumes safe pending steps; avoids duplicating completed side effects.
        """
        audit_logger.info("Running startup recovery scan...")
        interrupted_states = [TaskState.RUNNING.value, TaskState.READY.value, TaskState.WAITING_FOR_RESOURCE.value]
        tasks = self.repo.get_tasks_by_states(interrupted_states)
        
        recovered_count = 0
        details = []

        online_now = is_online()

        for t in tasks:
            audit_logger.info("Recovering task %s ('%s', state: %s)", t.id, t.title, t.state)
            
            # If waiting for internet and now online, resume!
            if t.state == TaskState.WAITING_FOR_RESOURCE.value:
                if t.waiting_resource == "internet_connection" and online_now:
                    audit_logger.info("Task %s was waiting for internet, which is now available. Resuming.", t.id)
                    t.state = TaskState.READY.value
                    t.waiting_resource = None
                    self.repo.save_task(t)
                    res = self.engine.execute_task(t.id)
                    recovered_count += 1
                    details.append({"task_id": t.id, "title": t.title, "action": "resumed_online", "result": res})
                else:
                    details.append({"task_id": t.id, "title": t.title, "action": "still_waiting_for_resource"})
                continue

            # For RUNNING or READY tasks, re-execute only pending steps
            res = self.engine.execute_task(t.id)
            recovered_count += 1
            details.append({"task_id": t.id, "title": t.title, "action": "resumed_from_checkpoint", "result": res})

        audit_logger.info("Recovery completed. %d unfinished tasks handled.", recovered_count)
        return {
            "recovered_count": recovered_count,
            "tasks": details
        }


recovery_manager = CrashRecoveryManager()

