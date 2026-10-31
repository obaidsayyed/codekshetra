"""
SUNDAY configuration module.
Loads settings from environment variables or defaults according to PRD specifications.
"""
from pathlib import Path
from typing import List
from pydantic import BaseModel, Field


class Settings(BaseModel):
    app_name: str = "SUNDAY"
    version: str = "1.0.0"
    
    # Project paths
    base_dir: Path = Field(default_factory=lambda: Path(r"C:\Users\omban\.gemini\antigravity\scratch\SUNDAY"))
    
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
        
    # Model and inference configuration
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "gemma2:9b"
    ollama_num_ctx: int = 4096
    
    # STT & TTS paths (highest quality medium.en model for crisp English voice capture)
    whisper_model_name: str = "medium.en"

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
    wake_words: List[str] = Field(default_factory=lambda: ["hey jarvis", "hey sunday", "sunday"])
    
    # Allowed filesystem roots for laptop access (User Profile + Workspace)
    allowed_roots: List[str] = Field(default_factory=lambda: [
        str(Path.home().resolve()),
        r"C:\Users\omban",
        r"C:\Users\omban\.gemini\antigravity\scratch\SUNDAY\data\workspace"
    ])
    
    # Network policy
    offline_mode: bool = True
    
    # Visual desktop typing effect speed in seconds
    visual_typing_delay: float = 0.02


settings = Settings()

