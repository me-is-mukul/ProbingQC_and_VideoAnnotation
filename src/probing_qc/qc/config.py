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
    window_s: float = 1.0            # accelerometer averaging window for the gravity direction


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
        return _update(cls(), data).validate()

    @classmethod
    def from_file(cls, path: str | Path) -> "QCConfig":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    def override(self, section: str, **values) -> "QCConfig":
        """Set the non-``None`` ``values`` on one section in place (used for CLI flags)."""
        _update(getattr(self, section), {k: v for k, v in values.items() if v is not None})
        return self

    def validate(self) -> "QCConfig":
        """Raise ``ValueError`` listing every out-of-range setting; return ``self`` if valid."""
        errors = validation_errors(self)
        if errors:
            raise ValueError("Invalid QC config:\n  " + "\n  ".join(errors))
        return self


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def validation_errors(cfg: QCConfig) -> list[str]:
    s, i, h, o = cfg.sampling, cfg.image, cfg.hands, cfg.orientation
    rules = [
        (_is_int(s.frame_stride) and s.frame_stride >= 1, "sampling.frame_stride must be an integer >= 1"),
        (s.start_s >= 0, "sampling.start_s must be >= 0"),
        (s.max_seconds is None or s.max_seconds > 0, "sampling.max_seconds must be > 0 or null"),
        (_is_int(i.analysis_width) and i.analysis_width >= 1, "image.analysis_width must be an integer >= 1"),
        (_is_int(i.block_size) and i.block_size >= 2, "image.block_size must be an integer >= 2"),
        (0 <= i.dark_luma < i.bright_luma <= 255, "image: need 0 <= dark_luma < bright_luma <= 255"),
        (i.blur_sharpness >= 0, "image.blur_sharpness must be >= 0"),
        (i.cast_factor >= 0, "image.cast_factor must be >= 0"),
        (_is_int(h.input_width) and h.input_width >= 1, "hands.input_width must be an integer >= 1"),
        (_is_int(h.num_hands) and h.num_hands >= 1, "hands.num_hands must be an integer >= 1"),
        (all(0 <= c <= 1 for c in (h.min_detection_confidence, h.min_presence_confidence,
                                    h.min_tracking_confidence)),
         "hands.min_*_confidence must be within [0, 1]"),
        (all(v >= 0 for v in (h.min_loss_s, h.grasp_curl_ratio, h.grasp_pinch_ratio,
                              h.grasp_merge_gap_s, h.grasp_min_duration_s)),
         "hands: durations and grasp ratios must be >= 0"),
        (o.window_s > 0, "orientation.window_s must be > 0"),
        (_is_int(cfg.max_error_messages) and cfg.max_error_messages >= 0,
         "max_error_messages must be an integer >= 0"),
    ]
    return [message for ok, message in rules if not ok]


def _update(obj, data: dict):
    """Recursively apply ``data`` onto dataclass ``obj``; unknown keys are errors."""
    if not isinstance(data, dict):
        raise TypeError(f"Expected an object for {type(obj).__name__}, got {type(data).__name__}")
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
