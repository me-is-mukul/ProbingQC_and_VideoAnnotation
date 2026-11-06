"""Project directory layout and input resolution shared by the CLI scripts."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INPUT_DIR = ROOT / "input"
OUTPUT_DIR = ROOT / "output"
MODELS_DIR = ROOT / "models"


def resolve_video(video: str | Path, input_dir: Path = INPUT_DIR) -> Path | None:
    """Accept a path (absolute or relative to cwd) or a name relative to ``input_dir``."""
    for candidate in (Path(video), input_dir / video):
        if candidate.is_file():
            return candidate.resolve()
    return None
