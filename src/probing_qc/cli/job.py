"""Run a full processing job and stream progress as JSON Lines on stdout.

Usage:
    python -m probing_qc.cli.job --job-dir jobs/abc --video input/GX010140.MP4
    python -m probing_qc.cli.job --job-dir jobs/abc --url https://host/GX010140.MP4 --max-seconds 60

stdout carries ONLY events (one JSON object per line, see probing_qc/events.py);
anything else (native library chatter) goes to stderr. Exit code 0 on success,
1 when a stage failed (an ``error`` event says which), 2 for bad arguments.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from ..events import EventEmitter, EventLogHandler
from ..job import JobOptions, StageError, run_job
from .common import make_parser

OK, FAILED, USAGE = 0, 1, 2


def parse_args(argv: list[str] | None = None):
    parser = make_parser(__doc__)
    parser.add_argument("--job-dir", type=Path, required=True, help="folder for all job outputs")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--video", type=Path, help="local video file")
    source.add_argument("--url", help="http(s) URL to download first")
    parser.add_argument("--stride", type=int, help="analyse every Nth frame")
    parser.add_argument("--start", type=float, help="start offset in seconds")
    parser.add_argument("--max-seconds", type=float, help="analyse only this many seconds")
    parser.add_argument("--hwaccel", help="ffmpeg hardware decoder, e.g. d3d11va or cuda")
    parser.add_argument("--no-hands", action="store_true", help="skip hand tracking")
    parser.add_argument("--no-imu", action="store_true", help="skip IMU extraction")
    parser.add_argument("--config", type=Path, help="QC config JSON (see probing-qc --dump-config)")
    parser.add_argument("--max-points", type=int, default=1500, help="chart points per series")
    parser.add_argument("-v", "--verbose", action="store_true", help="forward debug logs too")
    return parser.parse_args(argv)


def options_from_args(args) -> JobOptions:
    return JobOptions(frame_stride=args.stride, start_s=args.start, max_seconds=args.max_seconds,
                      hwaccel=args.hwaccel, hands=not args.no_hands, imu=not args.no_imu,
                      config_path=args.config, max_points=args.max_points)


def install_log_forwarding(ev: EventEmitter, verbose: bool) -> None:
    """Route Python logging into ``log`` events; keep native stderr chatter quiet."""
    os.environ.setdefault("GLOG_minloglevel", "2")
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(EventLogHandler(ev, logging.DEBUG if verbose else logging.INFO))
    root.setLevel(logging.DEBUG if verbose else logging.INFO)


def main(argv: list[str] | None = None, stream=None) -> int:
    args = parse_args(argv)
    if stream is None:
        if hasattr(sys.stdout, "reconfigure"):  # units such as "m/s²" must not crash a cp1252 console
            sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
        stream = sys.stdout
    ev = EventEmitter(stream)
    install_log_forwarding(ev, args.verbose)
    if args.max_points < 1:
        ev.error("--max-points must be >= 1", error_type="UsageError")
        return USAGE
    try:
        options = options_from_args(args)
        options.qc_config()
    except (ValueError, KeyError, TypeError) as e:
        ev.error(f"Invalid options: {e}", error_type=type(e).__name__)
        return USAGE

    try:
        run_job(args.job_dir, ev, video=args.video, url=args.url, options=options)
    except StageError as e:
        ev.error(str(e), stage=e.stage, error_type=type(e.cause).__name__)
        return FAILED
    except KeyboardInterrupt:
        ev.error("Cancelled", error_type="KeyboardInterrupt")
        return FAILED
    except Exception as e:  # unexpected: still report it as an event
        ev.error(str(e) or type(e).__name__, error_type=type(e).__name__)
        return FAILED
    return OK


if __name__ == "__main__":
    sys.exit(main())
