"""Video quality control: technical quality and hand-tracking metrics.

    config         every setting and threshold (embedded in each report)
    metadata       container metrics via ffprobe (parse_probe is pure)
    frames         single-pass FFmpeg decoding, every Nth frame
    image_metrics  luminance, sharpness, blockiness, colour cast (pure)
    stats          distribution summaries, boolean run handling (pure)
    hands/         landmark types, MediaPipe detector, grasp heuristic, hand metrics
    analyzers/     per-frame analyzer plug-ins and the default registry
    orientation    camera tilt from the GoPro accelerometer
    models         pinned, checksum-verified model downloads
    report         JSON report section builders
    pipeline       orchestration: run_qc()
"""

from .config import QCConfig
from .pipeline import SCHEMA_VERSION, QCResult, run_qc

__all__ = ["QCConfig", "QCResult", "SCHEMA_VERSION", "run_qc"]
