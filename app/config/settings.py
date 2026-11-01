"""
SUNDAY configuration module.
Loads settings from environment variables or defaults according to PRD specifications.
"""
import os
from pathlib import Path
from typing import List
from pydantic import BaseModel, Field


class Settings(BaseModel):
    app_name: str = "SUNDAY"
    version: str = "1.0.0"
    
    # Project paths (Dynamically resolves on Windows host or Linux Docker/Render)
    base_dir: Path = Field(
        default_factory=lambda: Path(os.environ.get("SUNDAY_BASE_DIR") or Path(__file__).resolve().parent.parent.parent)
    )
    
    @property
    def data_dir(self) -> Path:
        return self.base_dir / "data"
        
    @property
    def db_path(self) -> Path:
        return self.data_dir / "sunday.db"
        
    @property
    def workspace_root(self) -> Path:
        return self.data_dir / "workspace"
        
    @property
    def inbox_dir(self) -> Path:
        return self.workspace_root / "inbox"
        
    @property
    def drafts_dir(self) -> Path:
        return self.workspace_root / "drafts"
        
    @property
    def output_dir(self) -> Path:
        return self.workspace_root / "output"
        
    @property
    def archive_dir(self) -> Path:
        return self.workspace_root / "archive"
        
    @property
    def recovery_dir(self) -> Path:
        return self.workspace_root / "recovery"
        
    @property
    def temp_dir(self) -> Path:
        return self.data_dir / "temp"
        
    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"
        
    # Model and inference configuration (qwen2.5:3b for ultra-fast near-zero latency local execution)
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:3b"
    ollama_num_ctx: int = 4096
    
    # STT & TTS paths (ultra-fast base.en model for near-zero latency vocal recognition)
    whisper_model_name: str = "base.en"
    stt_model_name: str = "qwen3-asr-1.7b"

    @property
    def user_desktop_dir(self) -> Path:
        p = Path.home() / "Desktop"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def whisper_model_dir(self) -> Path:
        return self.data_dir / "models" / "whisper"
        
    @property
    def tts_model_path(self) -> Path:
        return self.data_dir / "models" / "tts" / "en_US-lessac-medium.onnx"
        
    @property
    def tts_config_path(self) -> Path:
        return self.data_dir / "models" / "tts" / "en_US-lessac-medium.onnx.json"
        
    wake_threshold: float = 0.5
    wake_words: List[str] = Field(default_factory=lambda: ["sunday", "hey sunday"])
    
    # Allowed filesystem roots for laptop access (User Profile + Workspace)
    allowed_roots: List[str] = Field(default_factory=lambda: [
        str(Path.home().resolve()),
        str(Path(__file__).resolve().parent.parent.parent),
        str(Path(__file__).resolve().parent.parent.parent / "data" / "workspace")
    ])
    
    # Network policy
    offline_mode: bool = True
    
    # Visual desktop typing effect speed in seconds
    visual_typing_delay: float = 0.02

    # Device & Mobile Mode Configuration ('desktop' or 'mobile')
    device_mode: str = "desktop"
    llm_provider: str = "auto"  # 'auto', 'ollama', or 'pocketpal'

    # PocketPal AI mobile local server configuration (runs locally on mobile devices at localhost:8080/v1)
    pocketpal_url: str = "http://127.0.0.1:8080"
    pocketpal_model: str = "qwen2.5-1.5b"

    def is_mobile(self) -> bool:
        """Determines if SUNDAY is operating in mobile mode (Android/iOS/PocketPal)."""
        import os
        env_mode = os.environ.get("SUNDAY_DEVICE_MODE", "").lower()
        if env_mode in ("mobile", "android", "ios", "phone"):
            return True
        if "ANDROID_ROOT" in os.environ or "TERMUX_VERSION" in os.environ:
            return True
        return self.device_mode.lower() in ("mobile", "android", "ios", "phone")


settings = Settings()

