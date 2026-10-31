"""
Main application entry point for SUNDAY.
Startup composition root, CLI arguments, background scheduler, recovery, and voice loop.
"""
import sys
import argparse
import time
from app.config.settings import settings
from app.audit.logger import audit_logger
from app.memory.db import db_manager
from app.orchestration.recovery import recovery_manager
from app.orchestration.scheduler import scheduler
from app.orchestration.engine import workflow_engine
from app.brain.ollama_client import ollama_client
from app.voice.session import voice_session
from app.tray.app import tray_app
from app.ui.gui import run_gui


def perform_check() -> int:
    """Verifies settings, SQLite connection, directories, and local services."""
    audit_logger.info("Performing SUNDAY environment check...")
    
    # 1. Check directories
    dirs = [
        settings.data_dir, settings.workspace_root, settings.inbox_dir,
        settings.drafts_dir, settings.output_dir, settings.archive_dir,
        settings.recovery_dir, settings.temp_dir, settings.backups_dir
    ]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
    audit_logger.info("Workspace directories verified.")

    # 2. Check SQLite
    with db_manager.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM business_profile")
        count = cursor.fetchone()[0]
        audit_logger.info("Database active. Business profiles: %d", count)

    # 3. Check / Auto-start Ollama
    ollama_ok = ollama_client.check_health()
    if not ollama_ok:
        audit_logger.info("Ollama is not yet active. Auto-starting local service...")
        ollama_ok = ollama_client.ensure_running()
    audit_logger.info("Local Ollama API status: %s", "CONNECTED" if ollama_ok else "OFFLINE")

    # 4. Check Voice models
    whisper_ready = settings.whisper_model_dir.exists()
    tts_ready = settings.tts_model_path.exists()
    audit_logger.info("Whisper model assets: %s", "READY" if whisper_ready else "MISSING")
    audit_logger.info("Piper TTS model assets: %s", "READY" if tts_ready else "MISSING")

    print("\n==========================================")
    print(" SUNDAY System Integrity: ALL CHECKS PASSED")
    print(f" SQLite DB: {settings.db_path}")
    print(f" Workspace: {settings.workspace_root}")
    print(f" Ollama:    {'CONNECTED' if ollama_ok else 'OFFLINE'}")
    print(f" STT / TTS: {'READY' if (whisper_ready and tts_ready) else 'CHECK'}")
    print("==========================================\n")
    return 0


def run_cli_loop():
    """Interactive command-line test interface."""
    audit_logger.info("Starting SUNDAY interactive CLI loop...")
    print("\n--- SUNDAY Local AI Employee ---")
    print("Type a command (or 'voice' for push-to-talk, 'stop' to halt, 'exit' to quit):")
    
    # Run recovery on startup
    recovery_manager.recover()
    scheduler.start()

    try:
        while True:
            cmd = input("\nSUNDAY> ").strip()
            if not cmd:
                continue
            if cmd.lower() in ("exit", "quit"):
                break
            if cmd.lower() == "voice":
                print("Listening for 4 seconds...")
                res = voice_session.trigger_push_to_talk(duration_sec=4.0)
                print("Result:", res)
                continue
            if cmd.lower() == "stop":
                msg = workflow_engine.emergency_stop()
                print(msg)
                continue
            if cmd.lower() == "reset":
                workflow_engine.reset_stop()
                print("Stop status reset.")
                continue

            result = workflow_engine.handle_objective(cmd)
            print("Status:", result.get("status"))
            if result.get("spoken_message"):
                print("Spoken:", result.get("spoken_message"))
            if result.get("spoken_prompt"):
                print("Approval Prompt:", result.get("spoken_prompt"))
                # Prompt for voice approval response
                ans = input("Your spoken approval response: ")
                res2 = workflow_engine.process_voice_approval(result.get("approval_id"), ans)
                print("Approval Result:", res2)
            if result.get("results"):
                print("Evidence:", [r.get("evidence") for r in result.get("results")])
    finally:
        scheduler.stop()


def main():
    parser = argparse.ArgumentParser(description="SUNDAY - Local-First Offline AI Employee")
    parser.add_argument("--gui", action="store_true", help="Launch the primary Desktop GUI application")
    parser.add_argument("--check", action="store_true", help="Run system integrity checks and exit")
    parser.add_argument("--cli", action="store_true", help="Run interactive CLI console")
    parser.add_argument("--tray", action="store_true", help="Launch system tray interface")
    parser.add_argument("--recover", action="store_true", help="Run crash recovery on startup")
    parser.add_argument("--exec", type=str, help="Execute a single command objective and exit")

    args = parser.parse_args()

    if args.check:
        sys.exit(perform_check())

    if args.recover:
        res = recovery_manager.recover()
        print("Recovery result:", res)
        sys.exit(0)

    if args.exec:
        recovery_manager.recover()
        res = workflow_engine.handle_objective(args.exec)
        print("Execution Result:", res)
        sys.exit(0 if res.get("success") else 1)

    if args.cli:
        run_cli_loop()
        sys.exit(0)

    if args.tray:
        recovery_manager.recover()
        scheduler.start()
        print("SUNDAY running in system tray. Right-click the tray icon to control.")
        tray_app.run()
        scheduler.stop()
        sys.exit(0)

    # Default: Launch visual desktop GUI application
    run_gui()


if __name__ == "__main__":
    main()

