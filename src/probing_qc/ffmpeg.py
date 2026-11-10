"""Thin wrappers around the FFmpeg command-line tools.

All calls to ``ffprobe``/``ffmpeg`` that return data go through this module.
The parsing code elsewhere takes plain dicts and bytes, so it can be unit-tested
without FFmpeg. The streaming decoder in ``qc/frames.py`` builds its command
with ``require_tool`` too.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path


def require_tool(tool: str) -> str:
    """Absolute path of ``tool`` on ``PATH``; raises ``RuntimeError`` when missing."""
    path = shutil.which(tool)
    if path is None:
        raise RuntimeError(f"'{tool}' not found on PATH. Install FFmpeg and retry.")
    return path


def ffprobe_json(video: str | Path) -> dict:
    """ffprobe's ``-show_format -show_streams`` output for ``video`` as a dict."""
    result = subprocess.run(
        [require_tool("ffprobe"), "-v", "error", "-show_format", "-show_streams",
         "-of", "json", str(video)],
        capture_output=True, text=True, encoding="utf-8", check=True,
    )
    return json.loads(result.stdout)


def ffprobe_video_packets(video: str | Path) -> str:
    """``pts,flags`` of every packet of the first video stream, one CSV line each.

    Demuxes the whole file (no decoding): about 5 s for a 3.3 GB GoPro file on an SSD.
    """
    result = subprocess.run(
        [require_tool("ffprobe"), "-v", "error", "-select_streams", "v:0",
         "-show_entries", "packet=pts,flags", "-of", "csv=p=0", str(video)],
        capture_output=True, text=True, encoding="utf-8", check=True,
    )
    return result.stdout


def copy_stream(video: str | Path, stream_index: int) -> bytes:
    """Raw bytes of stream ``stream_index``, copied without re-encoding.

    ``-f data`` is required: FFmpeg cannot guess a container for a data track.
    """
    result = subprocess.run(
        [require_tool("ffmpeg"), "-v", "error", "-i", str(video),
         "-map", f"0:{stream_index}", "-c", "copy", "-f", "data", "-"],
        capture_output=True, check=True,
    )
    return result.stdout


def parse_ffmpeg_version(banner: str) -> str | None:
    """Version from the first line of ``ffmpeg -version`` ("ffmpeg version X ...")."""
    parts = banner.split()
    if len(parts) >= 3 and parts[0] == "ffmpeg" and parts[1] == "version":
        return parts[2]
    return None


def ffmpeg_version() -> str | None:
    """Installed FFmpeg version, or ``None`` when FFmpeg is unavailable."""
    try:
        out = subprocess.run([require_tool("ffmpeg"), "-version"], capture_output=True,
                             text=True, encoding="utf-8", check=True).stdout
    except (RuntimeError, OSError, subprocess.CalledProcessError):
        return None
    return parse_ffmpeg_version(out.splitlines()[0]) if out else None
