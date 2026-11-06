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

from probing_qc.paths import INPUT_DIR, OUTPUT_DIR, resolve_video
from probing_qc.qc import QCConfig, run_qc

log = logging.getLogger("qc")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", nargs="?", help="video path, or file name inside the input directory")
    parser.add_argument("--input-dir", type=Path, default=INPUT_DIR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--config", type=Path, help="JSON file overriding default settings")
    parser.add_argument("--stride", type=int, help="analyse every Nth frame (default 4)")
    parser.add_argument("--start", type=float, help="start offset in seconds")
    parser.add_argument("--max-seconds", type=float, help="analyse only this many seconds")
    parser.add_argument("--hwaccel", help="ffmpeg hardware decoder, e.g. d3d11va or cuda")
    parser.add_argument("--no-hands", action="store_true", help="skip hand tracking")
    parser.add_argument("--frames-csv", action="store_true", help="also write per-frame metrics")
    parser.add_argument("--dump-config", action="store_true", help="print the default config and exit")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser.parse_args(argv)


def build_config(args: argparse.Namespace) -> QCConfig:
    cfg = QCConfig.from_file(args.config) if args.config else QCConfig()
    overrides = {"frame_stride": args.stride, "start_s": args.start,
                 "max_seconds": args.max_seconds, "hwaccel": args.hwaccel}
    for key, value in overrides.items():
        if value is not None:
            setattr(cfg.sampling, key, value)
    if args.no_hands:
        cfg.hands.enabled = False
    if cfg.sampling.frame_stride < 1:
        raise ValueError("frame_stride must be >= 1")
    return cfg


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(name)s: %(message)s")
    if args.dump_config:
        print(json.dumps(QCConfig().to_dict(), indent=2))
        return 0
    if not args.video:
        log.error("A video is required (or use --dump-config)")
        return 2

    video = resolve_video(args.video, args.input_dir)
    if video is None:
        log.error("Video not found: %s (also looked in %s)", args.video, args.input_dir)
        return 1

    cfg = build_config(args)
    result = run_qc(video, cfg)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    out_json = args.output_dir / f"{video.stem}_qc.json"
    out_json.write_text(json.dumps(result.report, indent=2), encoding="utf-8")
    log.info("Wrote %s (%d frames analysed in %.1f s)", out_json,
             result.report["sampling"]["frames_analyzed"], result.report["runtime"]["elapsed_s"])
    if args.frames_csv:
        out_csv = args.output_dir / f"{video.stem}_qc_frames.csv"
        result.frames.to_csv(out_csv, index=False, float_format="%.4f")
        log.info("Wrote %s", out_csv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
