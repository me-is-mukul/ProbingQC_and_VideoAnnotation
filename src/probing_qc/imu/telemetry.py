"""Locate and extract the raw GPMF telemetry track from a GoPro MP4."""

from __future__ import annotations

from pathlib import Path

from ..ffmpeg import copy_stream, ffprobe_json

GPMF_CODEC_TAG = "gpmd"


def find_gpmf_index(streams: list[dict]) -> int | None:
    """Index of the first GoPro metadata (``gpmd``) stream in an ffprobe stream list."""
    for stream in streams:
        if stream.get("codec_tag_string") == GPMF_CODEC_TAG:
            return int(stream["index"])
    return None


def has_gpmf(streams: list[dict]) -> bool:
    return find_gpmf_index(streams) is not None


def find_gpmf_stream(video: str | Path) -> int:
    """Index of the GPMF stream in ``video``; raises ``ValueError`` if there is none."""
    index = find_gpmf_index(ffprobe_json(video).get("streams", []))
    if index is None:
        raise ValueError(f"No GPMF ('{GPMF_CODEC_TAG}') stream found in {video}")
    return index


def read_gpmf(video: str | Path, stream_index: int | None = None) -> bytes:
    """Copy the GPMF stream out of ``video`` and return its raw bytes.

    The stream is piped from FFmpeg, so no intermediate ``telemetry.bin`` is written.
    """
    video = Path(video)
    if not video.is_file():
        raise FileNotFoundError(video)
    if stream_index is None:
        stream_index = find_gpmf_stream(video)
    data = copy_stream(video, stream_index)
    if not data:
        raise ValueError(f"GPMF stream {stream_index} in {video} is empty")
    return data
