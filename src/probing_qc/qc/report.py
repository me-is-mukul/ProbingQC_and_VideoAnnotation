"""Builders for each section of the QC JSON report. Pure except ``environment()``.

Bump ``SCHEMA_VERSION`` when report fields are renamed or removed (major) or
added (minor).
"""

from __future__ import annotations

import platform
from datetime import datetime
from importlib.metadata import PackageNotFoundError, version

from ..ffmpeg import ffmpeg_version
from .config import SamplingConfig
from .metadata import VideoInfo

# 1.2: hands.hoi, and left/right now name the wearer's hands correctly (1.1 and older
#      reports from MediaPipe Tasks have them swapped; see hands/detector.py).
SCHEMA_VERSION = "1.2"


def _kbps(bits_per_s: int | None) -> float | None:
    return round(bits_per_s / 1000, 1) if bits_per_s else None


def video_section(info: VideoInfo, file_name: str) -> dict:
    return {"file": file_name, "size_bytes": info.size_bytes,
            "frame_count": info.frame_count, "has_gpmf": info.has_gpmf}


def sampling_section(s: SamplingConfig, fps: float, frames_analyzed: int) -> dict:
    return {"frame_stride": s.frame_stride, "analysis_fps": round(fps / s.frame_stride, 3),
            "start_s": s.start_s, "max_seconds": s.max_seconds,
            "frames_analyzed": frames_analyzed}


def technical_section(info: VideoInfo) -> dict:
    """The container-derived part of the report's ``technical`` section."""
    w, h = info.display_size
    return {
        "duration": round(info.duration_s, 3),
        "fps": round(info.fps, 3),
        "bitrate": {"video_kbps": _kbps(info.video_bitrate), "total_kbps": _kbps(info.total_bitrate)},
        "codec": {"name": info.codec, "profile": info.profile, "pix_fmt": info.pix_fmt},
        "orientation": {
            "rotation_deg": info.rotation_deg,
            "display": "landscape" if w >= h else "portrait",
            "width": w,
            "height": h,
        },
    }


def decode_section(errors: list[str], returncode: int | None, frames_expected: int,
                   frames_decoded: int, max_messages: int) -> dict:
    return {
        "count": len(errors),
        "ffmpeg_exit_code": returncode,
        "frames_expected": frames_expected,
        "frames_decoded": frames_decoded,
        "messages": errors[:max_messages],
    }


def package_version(name: str = "probing-qc") -> str:
    try:
        return version(name)
    except PackageNotFoundError:
        return "unknown"


def environment() -> dict:
    """Versions of everything that can change the numbers, for reproducibility."""
    import cv2
    import numpy
    import pandas

    return {
        "probing_qc_version": package_version(),
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "numpy_version": numpy.__version__,
        "pandas_version": pandas.__version__,
        "opencv_version": cv2.__version__,
        "ffmpeg_version": ffmpeg_version(),
    }


def runtime_section(started: datetime, elapsed_s: float, provenance: dict[str, dict],
                    env: dict | None = None) -> dict:
    """Start time, elapsed time, environment versions and each analyzer's ``info()``, flattened."""
    return {
        "started_at": started.isoformat(timespec="seconds"),
        "elapsed_s": round(elapsed_s, 1),
        **(env if env is not None else environment()),
        **{k: v for p in provenance.values() for k, v in p.items()},
    }
