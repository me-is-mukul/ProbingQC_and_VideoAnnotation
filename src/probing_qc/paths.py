"""Project folder layout, input resolution and output naming."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INPUT_DIR = ROOT / "input"
OUTPUT_DIR = ROOT / "output"
MODELS_DIR = ROOT / "models"

VIDEO_SUFFIXES = {".mp4", ".mov"}

# Output file name suffixes, appended to the video's stem.
IMU_SUFFIX = "_imu.csv"
QC_SUFFIX = "_qc.json"
QC_FRAMES_SUFFIX = "_qc_frames.csv"


def resolve_video(video: str | Path, input_dir: Path = INPUT_DIR) -> Path | None:
    """Accept a path (absolute or relative to cwd) or a name relative to ``input_dir``.

    A path that exists as given wins over the same name inside ``input_dir``.
    """
    for candidate in (Path(video), Path(input_dir) / video):
        if candidate.is_file():
            return candidate.resolve()
    return None


def output_path(video: str | Path, output_dir: Path, suffix: str) -> Path:
    """``output_dir / <video stem><suffix>``, e.g. ``output/GX010140_qc.json``."""
    return Path(output_dir) / f"{Path(video).stem}{suffix}"


def list_videos(folder: Path) -> list[Path]:
    """Video files directly inside ``folder`` (case-insensitive suffix), sorted by name."""
    folder = Path(folder)
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in VIDEO_SUFFIXES)
