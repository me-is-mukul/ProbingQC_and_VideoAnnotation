"""One end-to-end processing job: [download] -> probe -> IMU -> QC -> results.json.

Each stage is a separate function so it can be tested and reused on its own;
``run_job`` chains them and reports progress through an ``EventEmitter``
(see ``events.py``). The web frontend runs this through
``python -m probing_qc.cli.job`` and streams the events to the browser.

Job folder layout (everything a job writes stays inside ``job_dir``):

    job_dir/
      source/<video>            only when the video was downloaded from a URL
      outputs/<stem>_imu.csv    full-resolution IMU table
      outputs/<stem>_qc.json    full QC report (same as ``probing-qc``)
      outputs/<stem>_qc_frames.csv
      results.json              compact, chart-ready summary for the UI
"""

from __future__ import annotations

import json
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from .download import download, filename_from_url, is_valid_url
from .events import EventEmitter, Throttle, json_safe
from .imu.checks import check_imu
from .imu.sensor import SensorStream, extract_sensor
from .imu.table import imu_summary, imu_table, write_imu_csv
from .imu.telemetry import read_gpmf
from .keyframes import Keyframes, describe as describe_keyframes, read_keyframes
from .paths import IMU_SUFFIX, QC_FRAMES_SUFFIX, QC_SUFFIX, output_path
from .preview import DEFAULT_MAX_POINTS, frames_preview, imu_preview
from .qc.config import QCConfig
from .qc.metadata import VideoInfo, probe_video
from .qc.pipeline import QCResult, run_qc

RESULTS_FILE = "results.json"
# 1.1: video.has_audio, video.has_b_frames and the top-level keyframes list.
RESULTS_SCHEMA_VERSION = "1.1"
STAGES = ("download", "probe", "imu", "qc", "results")
MIB = 1024 * 1024


class StageError(RuntimeError):
    """An exception raised inside a stage, tagged with the stage name."""

    def __init__(self, stage: str, cause: BaseException):
        super().__init__(str(cause) or type(cause).__name__)
        self.stage = stage
        self.cause = cause


@dataclass
class JobOptions:
    frame_stride: int | None = None
    start_s: float | None = None
    max_seconds: float | None = None
    hwaccel: str | None = None
    hands: bool = True
    imu: bool = True
    config_path: Path | None = None
    max_points: int = DEFAULT_MAX_POINTS

    def qc_config(self) -> QCConfig:
        """Defaults <- config file <- explicit options, validated."""
        cfg = QCConfig.from_file(self.config_path) if self.config_path else QCConfig()
        cfg.override("sampling", frame_stride=self.frame_stride, start_s=self.start_s,
                     max_seconds=self.max_seconds, hwaccel=self.hwaccel)
        if not self.hands:
            cfg.hands.enabled = False
        return cfg.validate()

    def to_dict(self) -> dict:
        d = asdict(self)
        d["config_path"] = str(self.config_path) if self.config_path else None
        return d


@dataclass
class JobPaths:
    job_dir: Path
    source_dir: Path = field(init=False)
    out_dir: Path = field(init=False)
    results: Path = field(init=False)

    def __post_init__(self) -> None:
        self.job_dir = Path(self.job_dir)
        self.source_dir = self.job_dir / "source"
        self.out_dir = self.job_dir / "outputs"
        self.results = self.job_dir / RESULTS_FILE


@contextmanager
def stage(ev: EventEmitter, name: str, message: str) -> Iterator[dict]:
    """Emit ``start``; on exit emit ``done`` with the message/data the body put in the dict.

    Exceptions are re-raised as ``StageError`` so the caller knows which stage failed.
    """
    ev.stage(name, "start", message)
    t0 = time.perf_counter()
    outcome: dict = {"message": f"{name} finished", "data": None}
    try:
        yield outcome
    except StageError:
        raise
    except Exception as e:
        raise StageError(name, e) from e
    data = dict(outcome["data"] or {})
    data["elapsed_s"] = round(time.perf_counter() - t0, 2)
    ev.stage(name, "done", outcome["message"], data)


def ordinal(n: int) -> str:
    """1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st ..."""
    suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def human_bytes(n: float) -> str:
    for unit in ("B", "KiB", "MiB", "GiB"):
        if n < 1024 or unit == "GiB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} GiB"


# --- stages -------------------------------------------------------------------


def stage_download(url: str, dest_dir: Path, ev: EventEmitter) -> Path:
    if not is_valid_url(url):
        raise StageError("download", ValueError("Invalid URL: must start with http:// or https://"))
    name = filename_from_url(url) or "video.mp4"
    dest = dest_dir / name
    throttle = Throttle(0.5)

    def on_progress(done: int, total: int | None) -> None:
        if throttle.ready(final=total is not None and done >= total):
            of = f" of {human_bytes(total)}" if total else ""
            ev.progress("download", done, total, f"Downloaded {human_bytes(done)}{of}", unit="bytes")

    with stage(ev, "download", f"Downloading {name}") as out:
        ev.log("info", f"GET {url}", logger="download")
        download(url, dest, progress=False, on_progress=on_progress)
        size = dest.stat().st_size
        out["message"] = f"Saved {name} ({human_bytes(size)})"
        out["data"] = {"file": name, "size_bytes": size}
    return dest


def video_summary(info: VideoInfo) -> dict:
    """``VideoInfo`` for the UI: no server paths, display size resolved."""
    d = info.to_dict()
    d["file"] = Path(d.pop("path")).name
    d["display_width"], d["display_height"] = info.display_size
    return d


def stage_probe(video: Path, ev: EventEmitter) -> tuple[VideoInfo, Keyframes]:
    """Container metadata plus the keyframe index (``None`` when it could not be read)."""
    with stage(ev, "probe", "Reading container metadata (ffprobe)") as out:
        info = probe_video(video)
        w, h = info.display_size
        ev.log("info", f"{info.codec} {w}x{h} @ {info.fps:.3f} fps, {info.duration_s:.2f} s, "
                       f"{info.frame_count} frames, {human_bytes(info.size_bytes)}", logger="probe")
        ev.log("info", "GPMF telemetry track found" if info.has_gpmf
               else "No GPMF telemetry track (not a GoPro file?)", logger="probe")
        ev.log("info", f"Audio track: {'yes' if info.has_audio else 'no'}; "
                       f"B-frames: {'yes' if info.has_b_frames else 'no'}", logger="probe")
        keyframes = scan_keyframes(video, info, ev)
        out["message"] = f"{info.codec.upper()} {w}x{h}, {info.duration_s:.1f} s"
        out["data"] = video_summary(info)
    return info, keyframes


def scan_keyframes(video: Path, info: VideoInfo, ev: EventEmitter) -> Keyframes:
    """Keyframe index for fast probing. Supplementary: a failure is logged, never fatal."""
    ev.log("info", "Indexing keyframes (ffprobe packet scan, reads the file once)", logger="probe")
    try:
        keyframes = read_keyframes(video)
    except Exception as e:
        ev.log("warning", f"Keyframe index unavailable ({e}); fast probing will be disabled",
               logger="probe")
        return None
    ev.log("info" if keyframes is not None else "warning", describe_keyframes(keyframes, info.fps),
           logger="probe")
    return keyframes


def _describe_sensor(s: SensorStream) -> str:
    return (f"{s.key}: {s.num_samples:,} samples in {len(s.payloads)} payloads, "
            f"ORIN={s.orientation or 'default'}, units={s.units or '?'}")


def stage_imu(video: Path, info: VideoInfo, out_dir: Path, ev: EventEmitter,
              enabled: bool, max_points: int) -> tuple[dict | None, bytes | None]:
    """Returns (imu block for results.json, raw GPMF bytes for reuse) or (None, None) if skipped."""
    if not enabled:
        ev.stage("imu", "skip", "IMU extraction disabled")
        return None, None
    if not info.has_gpmf:
        ev.stage("imu", "skip", "No GPMF telemetry track; IMU extraction skipped")
        return None, None

    with stage(ev, "imu", "Extracting IMU telemetry (GPMF)") as out:
        ev.log("info", "Copying the GPMF track out of the container (ffmpeg -c copy)", logger="imu")
        data = read_gpmf(video)
        ev.log("info", f"Read {human_bytes(len(data))} of GPMF telemetry", logger="imu")
        acc, gyro = extract_sensor(data, "ACCL"), extract_sensor(data, "GYRO")
        ev.log("info", _describe_sensor(acc), logger="imu")
        ev.log("info", _describe_sensor(gyro), logger="imu")
        df = imu_table(acc, gyro)
        csv_path = write_imu_csv(df, output_path(video, out_dir, IMU_SUFFIX))
        summary = imu_summary(df)
        ev.log("info", f"Wrote {csv_path.name} ({summary['samples']:,} rows)", logger="imu")

        checks = check_imu(df, info.duration_s)
        for c in checks:
            value = "" if c.value is None else f"value {c.value}, "
            ev.log("info" if c.passed else "warning",
                   f"Check {c.name}: {'pass' if c.passed else 'FAIL'} ({value}expected {c.expected})",
                   logger="imu.checks")
        failed = sum(not c.passed for c in checks)
        rate = f"{summary['rate_hz']:.1f} Hz" if summary["rate_hz"] else "rate n/a"
        out["message"] = (f"{summary['samples']:,} samples at {rate}; "
                          f"{len(checks) - failed}/{len(checks)} checks passed")
        out["data"] = {"samples": summary["samples"], "failed_checks": failed}
        block = {
            "summary": summary,
            "units": {"acc": acc.units, "gyro": gyro.units},
            "checks": [asdict(c) for c in checks],
            "preview": imu_preview(df, max_points),
            "file": csv_path.name,
        }
    return block, data


def stage_qc(video: Path, info: VideoInfo, cfg: QCConfig, out_dir: Path, ev: EventEmitter,
             gpmf_data: bytes | None) -> QCResult:
    s = cfg.sampling
    window = f"from {s.start_s:g} s" + (f" for {s.max_seconds:g} s" if s.max_seconds else " to the end")
    every = "every frame" if s.frame_stride == 1 else f"every {ordinal(s.frame_stride)} frame"
    with stage(ev, "qc", f"Video QC: {every} {window}") as out:
        ev.log("info", "Analyzers: image quality" + (", hand tracking (MediaPipe)" if cfg.hands.enabled
                                                     else " (hand tracking disabled)"), logger="qc")
        if cfg.hands.enabled:
            ev.log("info", "Loading the hand landmark model (downloaded and verified on first use)",
                   logger="qc")
        throttle = Throttle(0.5)
        expected: dict = {"n": None}

        def on_frame(done: int, frame) -> None:
            if expected["n"] is None:
                from .qc.frames import expected_frame_count
                expected["n"] = expected_frame_count(info.frame_count, info.fps, s.frame_stride,
                                                     s.start_s, s.max_seconds)
                ev.log("info", "Decoding with ffmpeg; first frame received", logger="qc")
            if throttle.ready():
                ev.progress("qc", done, expected["n"],
                            f"Analysed frame {done}/{expected['n']} (t = {frame.timestamp_s:.1f} s)",
                            unit="frames")

        result = run_qc(video, cfg, progress=False, on_frame=on_frame, info=info, gpmf_data=gpmf_data)
        n = len(result.frames)
        ev.progress("qc", n, n, f"Analysed {n} frames", unit="frames")  # expected is ±1 at window edges
        result.write(output_path(video, out_dir, QC_SUFFIX), output_path(video, out_dir, QC_FRAMES_SUFFIX))
        dec = result.report["technical"]["decode_errors"]
        ev.log("warning" if dec["count"] else "info",
               f"Decode errors: {dec['count']} (ffmpeg exit code {dec['ffmpeg_exit_code']})", logger="qc")
        out["message"] = f"{n} frames analysed"
        out["data"] = {"frames_analyzed": n, "decode_errors": dec["count"]}
    return result


def build_results(source: dict, options: JobOptions, info: VideoInfo, qc: QCResult,
                  imu: dict | None, max_points: int, video: Path,
                  keyframes: Keyframes = None) -> dict:
    return {
        "schema_version": RESULTS_SCHEMA_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source,
        "options": options.to_dict(),
        "video": video_summary(info),
        "keyframes": keyframes,
        "report": qc.report,
        "imu": imu,
        "frames_preview": frames_preview(qc.frames, max_points),
        "files": {
            "report": output_path(video, Path("outputs"), QC_SUFFIX).as_posix(),
            "frames_csv": output_path(video, Path("outputs"), QC_FRAMES_SUFFIX).as_posix(),
            "imu_csv": f"outputs/{imu['file']}" if imu else None,
        },
    }


def run_job(job_dir: Path, ev: EventEmitter, video: Path | None = None, url: str | None = None,
            options: JobOptions | None = None) -> Path:
    """Run every stage and return the path of ``results.json``. Exactly one of video/url."""
    if (video is None) == (url is None):
        raise ValueError("Pass exactly one of video or url")
    options = options or JobOptions()
    paths = JobPaths(job_dir)
    paths.out_dir.mkdir(parents=True, exist_ok=True)
    cfg = options.qc_config()  # fail fast on bad options, before any heavy work

    if url is not None:
        video = stage_download(url, paths.source_dir, ev)
        source = {"kind": "url", "url": url, "file": video.name}
    else:
        video = Path(video)
        if not video.is_file():
            raise StageError("probe", FileNotFoundError(f"Video not found: {video.name}"))
        ev.stage("download", "skip", "Local file; nothing to download")
        source = {"kind": "file", "file": video.name}

    info, keyframes = stage_probe(video, ev)
    imu, gpmf = stage_imu(video, info, paths.out_dir, ev, options.imu, options.max_points)
    qc = stage_qc(video, info, cfg, paths.out_dir, ev, gpmf)

    with stage(ev, "results", "Building chart data") as out:
        results = build_results(source, options, info, qc, imu, options.max_points, video, keyframes)
        tmp = paths.results.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(json_safe(results), allow_nan=False, default=_json_default),
                       encoding="utf-8")
        tmp.replace(paths.results)
        out["message"] = f"Wrote {RESULTS_FILE} ({human_bytes(paths.results.stat().st_size)})"
    ev.result(RESULTS_FILE, "Processing complete")
    return paths.results


def _json_default(o):
    """numpy scalars that slipped through -> Python numbers."""
    if hasattr(o, "item"):
        return o.item()
    raise TypeError(f"Not JSON serialisable: {type(o).__name__}")
