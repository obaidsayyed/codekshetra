# SUNDAY - Local-First Offline AI Employee for Windows 11

**SUNDAY** is a voice-first, locally-running AI employee designed according to the PRD and Hardware-Targeted Build Guide specifications. It operates **100% offline** without any cloud LLM, cloud STT, or cloud TTS dependencies.

---

## 🌟 Key Features

1. **100% Offline-First Architecture**:
   - **Reasoning**: Local quantized Ollama model (`qwen2.5:3b` / `qwen3:8b`) on localhost:11434 with 4K context cap.
   - **Speech-to-Text (STT)**: Offline `faster-whisper` tiny model with INT8 quantization running on CPU.
   - **Text-to-Speech (TTS)**: Offline `Piper` ONNX neural speech synthesis.
   - **Wake-Word**: `openWakeWord` detector with push-to-talk (PTT) fallback.
   - **Turn-Taking**: Half-duplex turn-taking pauses microphone capture while SUNDAY speaks.

2. **Strictly Voice-Based Permissions (Zero Typing Required)**:
   - Protected actions (R2/R3 like moving files to archive, modifying state) generate a cryptographic SHA-256 action hash.
   - SUNDAY speaks the exact action aloud and listens for the owner's spoken confirmation (`"I approve"`, `"yes"`, `"proceed"`, etc.) or revocation (`"no"`, `"cancel"`, `"stop"`).
   - Any parameter alteration invalidates the approval automatically.
   - Emergency voice stop: saying `"SUNDAY stop"` halts all actions immediately.

3. **Visual Desktop Action ("Desktop Sees It Getting Done")**:
   - When drafting documents or writing notes, SUNDAY visually opens Notepad (`notepad.exe`) or WordPad (`write.exe`) on the Windows desktop and types the content character-by-character live on screen using UI automation so you watch it happen live.

4. **Network-Aware Task Queuing & Auto-Resumption**:
   - SUNDAY never prompts for internet connectivity unless a task strictly requires remote access.
   - If a requested task requires internet and the laptop is offline, SUNDAY safely pauses the task in state `waiting_for_resource` (`internet_connection`) and informs the owner via speech.
   - If the laptop is shut down, rebooted, or later reconnected to Wi-Fi, SUNDAY's background scheduler and startup recovery detect the connection and automatically resume and complete the pending task.

5. **Deterministic Business Document Generation**:
   - Invoices are computed using Python `Decimal` arithmetic for exact subtotals, GST/taxes, and grand totals (never LLM hallucination).
   - Generates and verifies both `.docx` and `.pdf` files.
   - Email drafts (`.eml` and `.txt`) and messaging drafts are created locally and explicitly marked `STATUS: DRAFT - NOT SENT`.

6. **Durable Persistence & Crash Recovery**:
   - SQLite with WAL mode and FTS5 full-text search.
   - Unfinished workflows survive process termination and laptop restarts, resuming from the last valid checkpoint without duplicating completed side effects.

---

## 📁 Repository Layout

```
SUNDAY/
├── app/
│   ├── config/          # Pydantic settings & path configuration
│   ├── audit/           # Audit logger with secret redaction & event tracking
│   ├── memory/          # SQLite schema, repositories, & FTS5 search
│   ├── permissions/     # R0-R4 risk policies & voice approval manager
│   ├── tools/           # Safe filesystem, documents, visual windows, network
│   ├── brain/           # Ollama client, system prompts, & plan generator
│   ├── orchestration/   # State machine, engine, recovery, & scheduler
│   ├── voice/           # Audio I/O, wake word, faster-whisper STT, Piper TTS
│   ├── tray/            # Minimal pystray system tray interface
│   └── main.py          # Application entry point & composition root
├── data/
│   ├── sunday.db        # SQLite database (WAL mode)
│   ├── models/          # Offline Whisper & Piper ONNX model weights
│   └── workspace/       # inbox, drafts, output, archive, recovery
├── tests/               # Acceptance test matrix (AT-01 to AT-15)
├── requirements-lock.txt
└── README.md
```

---

## 🚀 Quick Start

### 1. Run System Health Check
Verifies Ollama connectivity, SQLite database integrity, and staged voice assets:
```powershell
.\.venv\Scripts\Activate.ps1
python -m app.main --check
```

### 2. Run Interactive Console
Supports push-to-talk (`voice`), typed commands, and emergency voice stop:
```powershell
python -m app.main --cli
```

### 3. Run in System Tray (Always-On Background Mode)
Runs with tray status icon (Green = Active, Red = Muted, Yellow = Stopped):
```powershell
python -m app.main --tray
```

### 4. Execute a Single Command
```powershell
python -m app.main --exec "Create an invoice for ABC Traders for 5 consulting hours at 1500"
```

---

## 🧪 Running Acceptance Tests

Run the full automated test suite verifying all 15 acceptance criteria:
```powershell
python -m pytest tests/ -v
```

