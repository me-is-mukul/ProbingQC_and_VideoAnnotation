"""Run quality-control metrics on a video and write a JSON report.

Usage:
    python scripts/qc.py GX010140.MP4
    python scripts/qc.py "input/mono samples/GX010146.MP4" --max-seconds 60 --frames-csv
    python scripts/qc.py GX010140.MP4 --config my_qc.json
    python scripts/qc.py --dump-config > my_qc.json

<video> may be a path or a name inside <input-dir>.
Writes <output-dir>/<video stem>_qc.json (and _qc_frames.csv with --frames-csv).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from ..paths import QC_FRAMES_SUFFIX, QC_SUFFIX, output_path
from ..qc import QCConfig, run_qc
from .common import NOT_FOUND, OK, USAGE, add_io_args, find_video, make_parser, setup_logging

log = logging.getLogger("qc")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = make_parser(__doc__)
    parser.add_argument("video", nargs="?", help="video path, or file name inside the input directory")
    parser.add_argument("--config", type=Path, help="JSON file overriding default settings")
    parser.add_argument("--stride", type=int, help="analyse every Nth frame (default 4)")
    parser.add_argument("--start", type=float, help="start offset in seconds")
    parser.add_argument("--max-seconds", type=float, help="analyse only this many seconds")
    parser.add_argument("--hwaccel", help="ffmpeg hardware decoder, e.g. d3d11va or cuda")
    parser.add_argument("--no-hands", action="store_true", help="skip hand tracking")
    parser.add_argument("--frames-csv", action="store_true", help="also write per-frame metrics")
    parser.add_argument("--dump-config", action="store_true", help="print the default config and exit")
    add_io_args(parser)
    return parser.parse_args(argv)


def config_from_args(args: argparse.Namespace) -> QCConfig:
    """Defaults <- ``--config`` file <- individual flags, then validated."""
    cfg = QCConfig.from_file(args.config) if args.config else QCConfig()
    cfg.override("sampling", frame_stride=args.stride, start_s=args.start,
                 max_seconds=args.max_seconds, hwaccel=args.hwaccel)
    if args.no_hands:
        cfg.hands.enabled = False
    return cfg.validate()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(args.verbose)
    if args.dump_config:
        print(json.dumps(QCConfig().to_dict(), indent=2))
        return OK
    if not args.video:
        log.error("A video is required (or use --dump-config)")
        return USAGE

    try:
        cfg = config_from_args(args)
    except (ValueError, KeyError, TypeError) as e:
        log.error("%s", e)
        return USAGE

    video = find_video(args.video, args.input_dir, log)
    if video is None:
        return NOT_FOUND

    result = run_qc(video, cfg)
    out_json = output_path(video, args.output_dir, QC_SUFFIX)
    out_csv = output_path(video, args.output_dir, QC_FRAMES_SUFFIX) if args.frames_csv else None
    result.write(out_json, out_csv)
    log.info("Wrote %s (%d frames analysed in %.1f s)", out_json,
             result.report["sampling"]["frames_analyzed"], result.report["runtime"]["elapsed_s"])
    if out_csv:
        log.info("Wrote %s", out_csv)
    return OK


if __name__ == "__main__":
    sys.exit(main())
