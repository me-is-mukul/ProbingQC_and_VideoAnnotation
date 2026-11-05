"""Locate and extract the raw GPMF telemetry track from a GoPro MP4 using FFmpeg."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

GPMF_CODEC_TAG = "gpmd"


def _require(tool: str) -> str:
    path = shutil.which(tool)
    if path is None:
        raise RuntimeError(f"'{tool}' not found on PATH. Install FFmpeg and retry.")
    return path


def probe_streams(video: Path) -> list[dict]:
    """Return ffprobe's stream list for ``video``."""
    result = subprocess.run(
        [_require("ffprobe"), "-v", "error", "-show_streams", "-of", "json", str(video)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout).get("streams", [])


def find_gpmf_stream(video: Path) -> int:
    """Return the index of the GoPro metadata (``gpmd``) stream in ``video``."""
    for stream in probe_streams(video):
        if stream.get("codec_tag_string") == GPMF_CODEC_TAG:
            return int(stream["index"])
    raise ValueError(f"No GPMF ('{GPMF_CODEC_TAG}') stream found in {video}")


def read_gpmf(video: Path, stream_index: int | None = None) -> bytes:
    """Copy the GPMF stream out of ``video`` and return its raw bytes.

    The stream is piped from FFmpeg, so no intermediate ``telemetry.bin`` is written.
    """
    video = Path(video)
    if not video.is_file():
        raise FileNotFoundError(video)
    if stream_index is None:
        stream_index = find_gpmf_stream(video)
    result = subprocess.run(
        [_require("ffmpeg"), "-v", "error", "-i", str(video),
         "-map", f"0:{stream_index}", "-c", "copy", "-f", "data", "-"],
        capture_output=True, check=True,
    )
    if not result.stdout:
        raise ValueError(f"GPMF stream {stream_index} in {video} is empty")
    return result.stdout
