"""Container-level technical metadata from ffprobe (no decoding).

``parse_probe`` is pure (ffprobe JSON in, ``VideoInfo`` out); ``probe_video``
adds the FFmpeg call and the file size.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from fractions import Fraction
from pathlib import Path

from ..ffmpeg import ffprobe_json
from ..imu.telemetry import has_gpmf


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


def parse_rotation(stream: dict) -> int:
    """Rotation in [0, 360) from the display matrix side data, else the legacy ``rotate`` tag."""
    for side in stream.get("side_data_list", []):
        if "rotation" in side:
            return int(side["rotation"]) % 360
    return int(stream.get("tags", {}).get("rotate", 0)) % 360


def parse_fps(stream: dict) -> float:
    """``avg_frame_rate``, falling back to ``r_frame_rate`` when it is missing or "0/0"."""
    for key in ("avg_frame_rate", "r_frame_rate"):
        value = stream.get(key)
        if value and value != "0/0" and Fraction(value) > 0:
            return float(Fraction(value))
    raise ValueError("Video stream has no usable frame rate")


def optional_int(value) -> int | None:
    return int(value) if value not in (None, "", "N/A") else None


def parse_probe(data: dict, path: str, size_bytes: int) -> VideoInfo:
    """Build ``VideoInfo`` from ffprobe ``-show_format -show_streams`` JSON."""
    streams = data.get("streams", [])
    vs = next((s for s in streams if s.get("codec_type") == "video"), None)
    if vs is None:
        raise ValueError(f"No video stream in {path}")
    fps = parse_fps(vs)
    duration = float(vs.get("duration") or data.get("format", {})["duration"])
    return VideoInfo(
        path=path,
        size_bytes=size_bytes,
        duration_s=duration,
        fps=fps,
        frame_count=optional_int(vs.get("nb_frames")) or round(duration * fps),
        width=int(vs["width"]),
        height=int(vs["height"]),
        codec=vs["codec_name"],
        profile=vs.get("profile"),
        pix_fmt=vs.get("pix_fmt"),
        video_bitrate=optional_int(vs.get("bit_rate")),
        total_bitrate=optional_int(data.get("format", {}).get("bit_rate")),
        rotation_deg=parse_rotation(vs),
        has_gpmf=has_gpmf(streams),
    )


def probe_video(video: str | Path) -> VideoInfo:
    video = Path(video)
    return parse_probe(ffprobe_json(video), str(video), video.stat().st_size)
