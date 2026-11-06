"""Container-level technical metadata from ffprobe (no decoding)."""

from __future__ import annotations

import json
import subprocess
from dataclasses import asdict, dataclass
from fractions import Fraction
from pathlib import Path

from ..telemetry import GPMF_CODEC_TAG, require_tool


@dataclass(frozen=True)
class VideoInfo:
    path: str
    size_bytes: int
    duration_s: float
    fps: float
    frame_count: int
    width: int
    height: int
    codec: str
    profile: str | None
    pix_fmt: str | None
    video_bitrate: int | None
    total_bitrate: int | None
    rotation_deg: int
    has_gpmf: bool

    @property
    def display_size(self) -> tuple[int, int]:
        """(width, height) after applying rotation, i.e. as ffmpeg decodes it."""
        if self.rotation_deg % 180:
            return self.height, self.width
        return self.width, self.height

    def to_dict(self) -> dict:
        return asdict(self)


def _rotation(stream: dict) -> int:
    for side in stream.get("side_data_list", []):
        if "rotation" in side:
            return int(side["rotation"]) % 360
    return int(stream.get("tags", {}).get("rotate", 0)) % 360


def _int(value) -> int | None:
    return int(value) if value not in (None, "", "N/A") else None


def probe_video(video: Path) -> VideoInfo:
    video = Path(video)
    result = subprocess.run(
        [require_tool("ffprobe"), "-v", "error", "-show_format", "-show_streams",
         "-of", "json", str(video)],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    vs = next((s for s in streams if s.get("codec_type") == "video"), None)
    if vs is None:
        raise ValueError(f"No video stream in {video}")

    fps = float(Fraction(vs.get("avg_frame_rate") or vs["r_frame_rate"]))
    duration = float(vs.get("duration") or data["format"]["duration"])
    return VideoInfo(
        path=str(video),
        size_bytes=video.stat().st_size,
        duration_s=duration,
        fps=fps,
        frame_count=_int(vs.get("nb_frames")) or round(duration * fps),
        width=int(vs["width"]),
        height=int(vs["height"]),
        codec=vs["codec_name"],
        profile=vs.get("profile"),
        pix_fmt=vs.get("pix_fmt"),
        video_bitrate=_int(vs.get("bit_rate")),
        total_bitrate=_int(data.get("format", {}).get("bit_rate")),
        rotation_deg=_rotation(vs),
        has_gpmf=any(s.get("codec_tag_string") == GPMF_CODEC_TAG for s in streams),
    )


def technical_metadata(info: VideoInfo) -> dict:
    """The container-derived part of the report's ``technical`` section."""
    w, h = info.display_size
    kbps = lambda b: round(b / 1000, 1) if b else None  # noqa: E731
    return {
        "duration": round(info.duration_s, 3),
        "fps": round(info.fps, 3),
        "bitrate": {"video_kbps": kbps(info.video_bitrate), "total_kbps": kbps(info.total_bitrate)},
        "codec": {"name": info.codec, "profile": info.profile, "pix_fmt": info.pix_fmt},
        "orientation": {
            "rotation_deg": info.rotation_deg,
            "display": "landscape" if w >= h else "portrait",
            "width": w,
            "height": h,
        },
    }
