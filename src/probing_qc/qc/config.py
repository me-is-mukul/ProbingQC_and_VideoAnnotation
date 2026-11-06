"""QC configuration. Every threshold lives here so runs are reproducible.

The full config is embedded in each report. Override defaults with a JSON file
(``scripts/qc.py --config my.json``) containing any subset of these fields, e.g.
``{"sampling": {"frame_stride": 2}, "hands": {"min_loss_s": 1.0}}``.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields, is_dataclass
from pathlib import Path


@dataclass
class SamplingConfig:
    frame_stride: int = 4            # analyse every Nth decoded frame (skip N-1)
    start_s: float = 0.0             # seek before analysis
    max_seconds: float | None = None # analyse at most this much video (None = all)
    hwaccel: str | None = None       # ffmpeg -hwaccel value, e.g. "d3d11va", "cuda"


@dataclass
class ImageConfig:
    analysis_width: int = 960        # frames are downscaled to this width for luma/sharpness/colour
    block_size: int = 8              # grid for blockiness (computed at native resolution)
    dark_luma: float = 40.0          # frame mean luma below this counts as underexposed (0-255)
    bright_luma: float = 215.0       # frame mean luma above this counts as overexposed
    blur_sharpness: float = 100.0    # Laplacian variance below this counts as blurry (uncalibrated)
    cast_factor: float = 1.5         # colour-cast factor K above this counts as cast


@dataclass
class HandConfig:
    enabled: bool = True
    model_path: str | None = None    # None = models/hand_landmarker.task (auto-downloaded)
    input_width: int = 1280          # frames are downscaled to this width before detection
    num_hands: int = 2
    min_detection_confidence: float = 0.5
    min_presence_confidence: float = 0.5
    min_tracking_confidence: float = 0.5
    mirrored_input: bool = False     # False for head/chest-mounted (egocentric) footage
    min_loss_s: float = 0.5          # shorter no-hand gaps are not counted as tracking losses
    grasp_curl_ratio: float = 1.3    # fingertip-wrist / palm length below this = closed hand
    grasp_pinch_ratio: float = 0.35  # thumb-index tip distance / palm length below this = pinch
    grasp_merge_gap_s: float = 0.25  # contact gaps shorter than this are bridged
    grasp_min_duration_s: float = 0.3


@dataclass
class OrientationConfig:
    use_imu: bool = True             # add gravity statistics from the GoPro accelerometer


@dataclass
class QCConfig:
    sampling: SamplingConfig = field(default_factory=SamplingConfig)
    image: ImageConfig = field(default_factory=ImageConfig)
    hands: HandConfig = field(default_factory=HandConfig)
    orientation: OrientationConfig = field(default_factory=OrientationConfig)
    max_error_messages: int = 20     # decode error lines kept verbatim in the report

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "QCConfig":
        return _update(cls(), data)

    @classmethod
    def from_file(cls, path: str | Path) -> "QCConfig":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


def _update(obj, data: dict):
    """Recursively apply ``data`` onto dataclass ``obj``; unknown keys are errors."""
    known = {f.name for f in fields(obj)}
    for key, value in data.items():
        if key not in known:
            raise KeyError(f"Unknown config field '{key}' for {type(obj).__name__}")
        current = getattr(obj, key)
        if is_dataclass(current):
            _update(current, value)
        else:
            setattr(obj, key, value)
    return obj
