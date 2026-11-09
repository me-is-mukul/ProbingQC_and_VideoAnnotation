"""Run every QC stage on one video and assemble the JSON report."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import pandas as pd
from tqdm.auto import tqdm

from . import report as rpt
from .analyzers import FrameAnalyzer, build_analyzers
from .config import QCConfig
from .frames import Frame, FrameSampler
from .metadata import probe_video
from .orientation import gravity_stats

log = logging.getLogger(__name__)

SCHEMA_VERSION = rpt.SCHEMA_VERSION
FRAMES_CSV_FLOAT_FORMAT = "%.4f"


@dataclass
class QCResult:
    report: dict
    frames: pd.DataFrame  # one row per analysed frame, all analyzer columns

    def write(self, json_path: Path, frames_csv_path: Path | None = None) -> None:
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(self.report, indent=2), encoding="utf-8")
        if frames_csv_path is not None:
            self.frames.to_csv(frames_csv_path, index=False, float_format=FRAMES_CSV_FLOAT_FORMAT)


def analyse_frames(frames: Iterable[Frame], analyzers: list[FrameAnalyzer]) -> pd.DataFrame:
    """Run every analyzer on every frame; one row per frame (``frame``, ``timestamp_s``, metrics)."""
    rows: list[dict] = []
    for frame in frames:
        row = {"frame": frame.index, "timestamp_s": round(frame.timestamp_s, 4)}
        for analyzer in analyzers:
            row.update(analyzer.process(frame))
        rows.append(row)
    return pd.DataFrame(rows)


def summarize_sections(report: dict, analyzers: list[FrameAnalyzer], frames: pd.DataFrame,
                       dt: float) -> dict:
    """Merge each analyzer's summary into ``report[analyzer.section]``."""
    for analyzer in analyzers:
        report.setdefault(analyzer.section, {}).update(analyzer.summarize(frames, dt))
    return report


def run_qc(video: str | Path, cfg: QCConfig | None = None,
           analyzers: list[FrameAnalyzer] | None = None, progress: bool = True) -> QCResult:
    """Analyse ``video`` and return the report plus the per-frame table.

    ``analyzers`` overrides the default set from ``build_analyzers(cfg)``.
    """
    cfg = (cfg or QCConfig()).validate()
    video = Path(video)
    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()

    info = probe_video(video)
    s = cfg.sampling
    sampler = FrameSampler(info, s.frame_stride, s.start_s, s.max_seconds, s.hwaccel)
    analyzers = analyzers if analyzers is not None else build_analyzers(cfg)

    try:
        stream = tqdm(sampler, total=sampler.expected_frames, unit="frame",
                      desc=video.name, disable=not progress)
        frames = analyse_frames(stream, analyzers)
        provenance = {a.name: a.info() for a in analyzers}
    finally:
        for analyzer in analyzers:
            analyzer.close()

    if frames.empty:
        raise RuntimeError(f"No frames decoded from {video}: {sampler.errors[:5]}")
    dt = s.frame_stride / info.fps

    report: dict = {
        "schema_version": SCHEMA_VERSION,
        "video": rpt.video_section(info, video.name),
        "sampling": rpt.sampling_section(s, info.fps, len(frames)),
        "technical": rpt.technical_section(info),
    }
    report["technical"]["decode_errors"] = rpt.decode_section(
        sampler.errors, sampler.returncode, sampler.expected_frames, len(frames),
        cfg.max_error_messages)

    if cfg.orientation.use_imu and info.has_gpmf:
        try:
            report["technical"]["orientation"]["imu"] = gravity_stats(
                video, s.start_s, s.max_seconds, cfg.orientation.window_s)
        except Exception as e:  # orientation is supplementary; never fail the run for it
            log.warning("IMU orientation skipped: %s", e)

    summarize_sections(report, analyzers, frames, dt)
    report["config"] = cfg.to_dict()
    report["runtime"] = rpt.runtime_section(started, time.perf_counter() - t0, provenance)
    return QCResult(report, frames)
