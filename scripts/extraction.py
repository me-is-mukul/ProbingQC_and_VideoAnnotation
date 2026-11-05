"""Extract IMU (accelerometer + gyroscope) data from a GoPro video.

Usage:
    python scripts/extraction.py GX010140.MP4
    python scripts/extraction.py "input/mono samples/GX010146.MP4"
    python scripts/extraction.py GX010140.MP4 --input-dir input --output-dir output

<video> may be a path or a name inside <input-dir>.
Writes <output-dir>/<video stem>_imu.csv.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

from probing_qc import extract_imu

ROOT = Path(__file__).resolve().parents[1]

log = logging.getLogger("extraction")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", help="video path, or file name inside the input directory")
    parser.add_argument("--input-dir", type=Path, default=ROOT / "input")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "output")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser.parse_args(argv)


def resolve_video(video: str, input_dir: Path) -> Path | None:
    """Accept a path (absolute or relative to cwd) or a name relative to ``input_dir``."""
    for candidate in (Path(video), input_dir / video):
        if candidate.is_file():
            return candidate.resolve()
    return None


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(name)s: %(message)s")

    video = resolve_video(args.video, args.input_dir)
    if video is None:
        log.error("Video not found: %s (also looked in %s)", args.video, args.input_dir)
        return 1

    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = args.output_dir / f"{video.stem}_imu.csv"

    start = time.perf_counter()
    log.info("Extracting IMU from %s", video)
    df = extract_imu(video)
    df.to_csv(output, index=False, float_format="%.6f")

    duration = df["timestamp_s"].iloc[-1] - df["timestamp_s"].iloc[0]
    log.info("Wrote %s (%d samples, %.2f s, %.1f Hz) in %.1f s",
             output, len(df), duration, (len(df) - 1) / duration,
             time.perf_counter() - start)
    return 0


if __name__ == "__main__":
    sys.exit(main())
