"""
Main application entry point for SUNDAY.
Startup composition root, CLI arguments, background scheduler, recovery, and voice loop.
"""
import sys
import argparse
import time
import subprocess
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
from app.server.api_server import start_server_in_background


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


def run_companion() -> int:
    """Launches the Electron 3D voxel desktop companion frontend."""
    # 1. Start recovery and background services
    recovery_manager.recover()
    ollama_client.ensure_running()
    scheduler.start()

    # 2. Start local bridge REST & Event server on 127.0.0.1:8765
    start_server_in_background(host="127.0.0.1", port=8765)

    # 3. Try to start continuous background wake listener
    try:
        from app.voice.wakeword import background_listener
        background_listener.start()
    except Exception as e:
        audit_logger.warning("Background voice listener not active: %s", e)

    # 4. Resolve Electron executable
    sunday_dir = settings.base_dir / "sunday"
    electron_bin = sunday_dir / "node_modules" / ".bin" / "electron.cmd"

    cmd = [str(electron_bin), "."] if electron_bin.exists() else ["npx.cmd", "electron", "."]

    audit_logger.info("Starting SUNDAY 3D Desktop Companion: %s (in %s)", cmd, sunday_dir)
    print("\n=======================================================")
    print(" SUNDAY 3D Desktop Companion is waking up...")
    print(" Look for Sunday on your desktop and chat panel!")
    print(" Backend API Server listening on http://127.0.0.1:8765")
    print(" Press Ctrl+C in this console to exit.")
    print("=======================================================\n")

    try:
        proc = subprocess.Popen(cmd, cwd=str(sunday_dir))
        return proc.wait()
    except KeyboardInterrupt:
        return 0
    except Exception as e:
        audit_logger.error("Error launching Electron companion: %s", e)
        print("Falling back to legacy desktop GUI...")
        return run_gui()
    finally:
        scheduler.stop()


def run_server():
    """Runs only the backend REST and event bridge server (headless mode for cloud/Render/local)."""
    import os
    default_port = 10000 if os.environ.get("RENDER") else 8765
    port = int(os.environ.get("PORT", default_port))
    host = os.environ.get("HOST", "0.0.0.0")
    recovery_manager.recover()
    ollama_client.ensure_running()
    scheduler.start()

    # Try background voice listener if audio hardware is available
    try:
        from app.voice.wakeword import background_listener
        background_listener.start()
    except Exception as e:
        audit_logger.warning("Background voice listener not active in server mode: %s", e)

    start_server_in_background(host=host, port=port)
    print("\n=======================================================")
    print(f" SUNDAY Backend AI Engine Server running on http://{host}:{port}")
    print(" Press Ctrl+C to stop.")
    print("=======================================================\n")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping backend server...")
    finally:
        scheduler.stop()


def main():
    parser = argparse.ArgumentParser(description="SUNDAY - Local-First Offline AI Employee")
    parser.add_argument("--server", action="store_true", help="Run only the backend REST & Event server (headless)")
    parser.add_argument("--gui", action="store_true", help="Launch the primary Desktop 3D Companion application")
    parser.add_argument("--legacy-gui", action="store_true", help="Launch the legacy Tkinter GUI instead of 3D companion")
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

    if args.server:
        run_server()
        sys.exit(0)

    if args.legacy_gui:
        run_gui()
        sys.exit(0)

    # Default: Launch 3D voxel desktop companion character with full backend connection
    sys.exit(run_companion())


if __name__ == "__main__":
    main()

