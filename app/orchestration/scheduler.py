"""
Scheduler loop for SUNDAY.
Monitors periodic reminders, resource readiness, and resumes queued tasks.
"""
import time
import threading
from typing import Optional
from app.orchestration.engine import workflow_engine, WorkflowEngine
from app.audit.logger import audit_logger


class LocalScheduler:
    def __init__(self, engine: WorkflowEngine = workflow_engine, poll_interval_sec: float = 5.0):
        self.engine = engine
        self.poll_interval = poll_interval_sec
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        audit_logger.info("Local scheduler loop started.")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)
        audit_logger.info("Local scheduler loop stopped.")

    def _run_loop(self):
        while self._running:
            try:
                # Check for network reconnection and resume waiting tasks
                self.engine.check_and_resume_pending()
            except Exception as e:
                audit_logger.error("Error in scheduler loop: %s", e)
            time.sleep(self.poll_interval)


scheduler = LocalScheduler()

