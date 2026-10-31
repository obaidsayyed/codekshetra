"""
Persistent Orchestrator and Workflow Engine for SUNDAY.
State machine enforcement, dependency execution, SQLite checkpoints, and emergency stop.
"""
import uuid
import json
import time
import threading
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from app.memory.models import TaskRecord, TaskStepRecord, ApprovalRecord
from app.memory.repositories import TaskRepository, ApprovalRepository
from app.orchestration.states import TaskState, can_transition
from app.brain.planner import planner, Planner, ExecutionPlan
from app.tools.registry import tool_registry, ToolRegistry
from app.tools.network import is_online
from app.permissions.approvals import approval_manager
from app.audit.logger import audit_logger


class WorkflowEngine:
    def __init__(
        self,
        task_repo: Optional[TaskRepository] = None,
        approval_repo: Optional[ApprovalRepository] = None,
        registry: Optional[ToolRegistry] = None,
        plan_module: Optional[Planner] = None
    ):
        self.task_repo = task_repo or TaskRepository()
        self.approval_repo = approval_repo or ApprovalRepository()
        self.registry = registry or tool_registry
        self.planner = plan_module or planner
        self.is_stopped: bool = False
        self.is_busy: bool = False
        self._busy_lock = threading.Lock()
        self._last_objective: str = ""
        self._last_objective_ts: float = 0.0

    def emergency_stop(self) -> str:
        """Immediately halts future tool calls and marks running tasks."""
        self.is_stopped = True
        self.is_busy = False
        audit_logger.warning("Emergency stop triggered. Halting all workflow execution.")
        return "SUNDAY execution stopped immediately by owner."

    def reset_stop(self) -> None:
        self.is_stopped = False
        self.is_busy = False

    def handle_objective(self, objective: str) -> Dict[str, Any]:
        """
        Receives an objective, generates plan, commits to SQLite, and begins execution.
        Locks execution to prevent duplicate tasks or audio inputs while processing.
        """
        if self.is_stopped:
            return {
                "success": False,
                "status": "stopped",
                "message": "SUNDAY is currently stopped. Please issue a reset or new request."
            }

        # Concurrency & Deduplication Guard
        with self._busy_lock:
            if self.is_busy:
                audit_logger.warning("Rejecting command '%s': SUNDAY is currently executing a task.", objective)
                return {
                    "success": False,
                    "status": "busy",
                    "spoken_message": "I am currently executing a task. Please wait until it completes."
                }
            now_ts = time.time()
            clean_obj = objective.strip().lower()
            if clean_obj and clean_obj == self._last_objective and (now_ts - self._last_objective_ts) < 3.0:
                audit_logger.info("Ignoring duplicate command received within 3.0s: '%s'", clean_obj)
                return {
                    "success": False,
                    "status": "duplicate",
                    "spoken_message": ""
                }
            self._last_objective = clean_obj
            self._last_objective_ts = now_ts
            self.is_busy = True

        try:
            # 1. Plan objective with conversation context from previous turns
            plan: ExecutionPlan = self.planner.plan(objective)

            # Record user message in conversation memory
            from app.memory.conversation import conversation_manager
            conversation_manager.add_turn("user", objective)

            # Check conversational response
            if plan.is_conversational:
                conversation_manager.add_turn("assistant", plan.spoken_summary)
                return {
                    "success": True,
                    "status": "conversational",
                    "spoken_message": plan.spoken_summary
                }

            if plan.is_ambiguous:
                msg = plan.clarifying_question or plan.spoken_summary
                conversation_manager.add_turn("assistant", msg)
                return {
                    "success": False,
                    "status": "clarification_needed",
                    "spoken_message": msg,
                    "question": plan.clarifying_question
                }

            # 2. Persist parent task to SQLite before ANY side effects
            task_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc).isoformat()
            task = TaskRecord(
                id=task_id,
                title=objective,
                state=TaskState.READY.value,
                risk=plan.steps[0].risk_level if plan.steps else "R0",
                created_at=now,
                updated_at=now
            )
            self.task_repo.save_task(task)

            # 3. Persist steps
            steps: List[TaskStepRecord] = []
            for p_step in plan.steps:
                step_record = TaskStepRecord(
                    id=str(uuid.uuid4()),
                    task_id=task_id,
                    step_order=p_step.step_order,
                    tool_name=p_step.tool_name,
                    arguments_json=json.dumps(p_step.arguments),
                    state=TaskState.READY.value,
                    risk_level=p_step.risk_level
                )
                self.task_repo.save_step(step_record)
                steps.append(step_record)

            audit_logger.info("Persisted task %s with %d steps to SQLite.", task_id, len(steps))

            # 4. Execute steps sequentially and silently on desktop
            return self.execute_task(task_id)
        finally:
            with self._busy_lock:
                self.is_busy = False

    def execute_task(self, task_id: str) -> Dict[str, Any]:
        task = self.task_repo.get_task(task_id)
        if not task:
            return {"success": False, "error": f"Task {task_id} not found."}

        steps = self.task_repo.get_steps_for_task(task_id)
        overall_results = []

        for step in steps:
            if self.is_stopped:
                task.state = TaskState.CANCELLED.value
                self.task_repo.save_task(task)
                return {
                    "success": False,
                    "status": "stopped",
                    "spoken_message": "Execution halted by emergency stop."
                }

            if step.state == TaskState.COMPLETED.value:
                continue

            # Load step arguments
            args = json.loads(step.arguments_json)

            # Check if step has a pending approval
            pending_apprv = self.approval_repo.get_pending_by_step(step.id)
            is_confirmed = pending_apprv and pending_apprv.status == "confirmed"

            # Execute tool through registry
            step.state = TaskState.RUNNING.value
            self.task_repo.save_step(step)

            exec_out = self.registry.execute_tool(
                tool_name=step.tool_name,
                arguments=args,
                task_id=task.id,
                task_step_id=step.id,
                is_approval_confirmed=is_confirmed
            )

            status = exec_out.get("status")

            # Check if waiting for voice approval
            if status == "waiting_for_owner":
                step.state = TaskState.WAITING_FOR_OWNER.value
                task.state = TaskState.WAITING_FOR_OWNER.value
                self.task_repo.save_step(step)
                self.task_repo.save_task(task)
                return {
                    "success": False,
                    "status": "waiting_for_owner",
                    "task_id": task_id,
                    "step_id": step.id,
                    "approval_id": exec_out.get("approval_id"),
                    "spoken_prompt": exec_out.get("spoken_prompt")
                }

            # Check if waiting for internet connection
            if status == "waiting_for_resource":
                step.state = TaskState.WAITING_FOR_RESOURCE.value
                task.state = TaskState.WAITING_FOR_RESOURCE.value
                task.waiting_resource = exec_out.get("resource", "internet_connection")
                self.task_repo.save_step(step)
                self.task_repo.save_task(task)
                return {
                    "success": False,
                    "status": "waiting_for_resource",
                    "task_id": task_id,
                    "resource": task.waiting_resource,
                    "spoken_message": exec_out.get("spoken_message")
                }

            if exec_out.get("success"):
                step.state = TaskState.COMPLETED.value
                step.result_json = json.dumps(exec_out)
                self.task_repo.save_step(step)
                overall_results.append(exec_out)
            else:
                step.state = TaskState.FAILED.value
                step.result_json = json.dumps(exec_out)
                task.state = TaskState.FAILED.value
                self.task_repo.save_step(step)
                self.task_repo.save_task(task)
                return {
                    "success": False,
                    "status": "failed",
                    "error": exec_out.get("error", "Step execution failed."),
                    "task_id": task_id
                }

        # All steps completed successfully
        task.state = TaskState.COMPLETED.value
        task.updated_at = datetime.now(timezone.utc).isoformat()
        self.task_repo.save_task(task)

        # Formulate voice-first summary
        summary_lines = [r.get("evidence", "Task completed.") for r in overall_results if r.get("evidence")]
        spoken = " ".join(summary_lines) if summary_lines else f"Task '{task.title}' completed successfully."

        from app.memory.conversation import conversation_manager
        conversation_manager.add_turn("assistant", spoken)

        return {
            "success": True,
            "status": "completed",
            "task_id": task_id,
            "results": overall_results,
            "spoken_message": spoken
        }

    def process_voice_approval(self, approval_id: str, spoken_text: str) -> Dict[str, Any]:
        """Processes owner's spoken confirmation/rejection for an approval."""
        apprv = self.approval_repo.get_approval(approval_id)
        if not apprv:
            return {"success": False, "error": "Approval not found."}

        step = self.task_repo.get_step(apprv.task_step_id)
        if not step:
            return {"success": False, "error": "Associated task step not found."}

        args = json.loads(step.arguments_json)
        is_ok, reason = approval_manager.evaluate_voice_response(
            approval_id=approval_id,
            spoken_text=spoken_text,
            current_tool_name=step.tool_name,
            current_arguments=args
        )

        if not is_ok:
            return {
                "success": False,
                "status": "approval_rejected",
                "spoken_message": f"Action was not approved: {reason}"
            }

        # Approved! Re-execute task
        return self.execute_task(step.task_id)

    def check_and_resume_pending(self) -> List[Dict[str, Any]]:
        """
        Scans for tasks waiting for internet connection.
        If internet is now online, automatically resumes and completes them!
        """
        resumed = []
        waiting_tasks = self.task_repo.get_tasks_by_states([TaskState.WAITING_FOR_RESOURCE.value])
        if not waiting_tasks:
            return resumed

        online = is_online()
        if not online:
            return resumed

        audit_logger.info("Internet connection detected. Resuming %d queued online tasks.", len(waiting_tasks))
        for task in waiting_tasks:
            if task.waiting_resource == "internet_connection":
                task.state = TaskState.READY.value
                task.waiting_resource = None
                self.task_repo.save_task(task)
                res = self.execute_task(task.id)
                resumed.append(res)

        return resumed


workflow_engine = WorkflowEngine()

