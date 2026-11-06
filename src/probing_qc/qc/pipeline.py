"""Run every QC stage on one video and assemble the JSON report."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import pandas as pd
from tqdm.auto import tqdm

from .analyzers import FrameAnalyzer, build_analyzers
from .config import QCConfig
from .frames import FrameSampler
from .metadata import probe_video, technical_metadata
from .orientation import gravity_stats

log = logging.getLogger(__name__)

SCHEMA_VERSION = "1.0"


@dataclass
class QCResult:
    report: dict
    frames: pd.DataFrame  # one row per analysed frame, all analyzer columns


def _package_version() -> str:
    try:
        return version("probing-qc")
    except PackageNotFoundError:
        return "unknown"


def _decode_section(sampler: FrameSampler, decoded: int, max_messages: int) -> dict:
    return {
        "count": len(sampler.errors),
        "ffmpeg_exit_code": sampler.returncode,
        "frames_expected": sampler.expected_frames,
        "frames_decoded": decoded,
        "messages": sampler.errors[:max_messages],
    }


def run_qc(video: str | Path, cfg: QCConfig | None = None,
           analyzers: list[FrameAnalyzer] | None = None, progress: bool = True) -> QCResult:
    """Analyse ``video`` and return the report plus the per-frame table.

    ``analyzers`` overrides the default set from ``build_analyzers(cfg)``.
    """
    cfg = cfg or QCConfig()
    video = Path(video)
    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()

    info = probe_video(video)
    s = cfg.sampling
    sampler = FrameSampler(info, s.frame_stride, s.start_s, s.max_seconds, s.hwaccel)
    analyzers = analyzers if analyzers is not None else build_analyzers(cfg)

    rows: list[dict] = []
    try:
        for frame in tqdm(sampler, total=sampler.expected_frames, unit="frame",
                          desc=video.name, disable=not progress):
            row = {"frame": frame.index, "timestamp_s": round(frame.timestamp_s, 4)}
            for analyzer in analyzers:
                row.update(analyzer.process(frame))
            rows.append(row)
        provenance = {a.name: a.info() for a in analyzers}
    finally:
        for analyzer in analyzers:
            analyzer.close()

    frames = pd.DataFrame(rows)
    if frames.empty:
        raise RuntimeError(f"No frames decoded from {video}: {sampler.errors[:5]}")
    dt = s.frame_stride / info.fps

    report: dict = {
        "schema_version": SCHEMA_VERSION,
        "video": {"file": video.name, "size_bytes": info.size_bytes,
                  "frame_count": info.frame_count, "has_gpmf": info.has_gpmf},
        "sampling": {"frame_stride": s.frame_stride, "analysis_fps": round(info.fps / s.frame_stride, 3),
                     "start_s": s.start_s, "max_seconds": s.max_seconds,
                     "frames_analyzed": len(frames)},
        "technical": technical_metadata(info),
    }
    report["technical"]["decode_errors"] = _decode_section(sampler, len(frames), cfg.max_error_messages)

    if cfg.orientation.use_imu and info.has_gpmf:
        try:
            report["technical"]["orientation"]["imu"] = gravity_stats(video, s.start_s, s.max_seconds)
        except Exception as e:  # orientation is supplementary; never fail the run for it
            log.warning("IMU orientation skipped: %s", e)

    for analyzer in analyzers:
        report.setdefault(analyzer.section, {}).update(analyzer.summarize(frames, dt))

    report["config"] = cfg.to_dict()
    report["runtime"] = {
        "started_at": started.isoformat(timespec="seconds"),
        "elapsed_s": round(time.perf_counter() - t0, 1),
        "probing_qc_version": _package_version(),
        **{k: v for name, p in provenance.items() for k, v in p.items()},
    }
    return QCResult(report, frames)
