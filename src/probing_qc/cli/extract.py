"""Extract IMU (accelerometer + gyroscope) data from a GoPro video.

Usage:
    python scripts/extraction.py GX010140.MP4
    python scripts/extraction.py "input/mono samples/GX010146.MP4"
    python scripts/extraction.py GX010140.MP4 --input-dir input --output-dir output

<video> may be a path or a name inside <input-dir>.
Writes <output-dir>/<video stem>_imu.csv, then runs sanity checks on the result.
"""

from __future__ import annotations

import logging
import sys
import time

from ..imu import check_imu, extract_imu, imu_summary, write_imu_csv
from ..imu.checks import failed
from ..paths import IMU_SUFFIX, output_path
from .common import NOT_FOUND, OK, add_io_args, find_video, make_parser, setup_logging

log = logging.getLogger("extraction")


def parse_args(argv: list[str] | None = None):
    parser = make_parser(__doc__)
    parser.add_argument("video", help="video path, or file name inside the input directory")
    parser.add_argument("--no-checks", action="store_true", help="skip the IMU sanity checks")
    add_io_args(parser)
    return parser.parse_args(argv)


def video_duration(video) -> float | None:
    """Video duration for the duration check; ``None`` if ffprobe cannot tell."""
    from ..qc.metadata import probe_video

    try:
        return probe_video(video).duration_s
    except Exception as e:  # the check is optional
        log.debug("No video duration for checks: %s", e)
        return None


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(args.verbose)

    video = find_video(args.video, args.input_dir, log)
    if video is None:
        return NOT_FOUND
    output = output_path(video, args.output_dir, IMU_SUFFIX)

    start = time.perf_counter()
    log.info("Extracting IMU from %s", video)
    df = extract_imu(video)
    write_imu_csv(df, output)

    s = imu_summary(df)
    rate = f"{s['rate_hz']:.1f} Hz" if s["rate_hz"] else "rate n/a"
    log.info("Wrote %s (%d samples, %.2f s, %s) in %.1f s",
             output, s["samples"], s["duration_s"], rate, time.perf_counter() - start)

    if not args.no_checks:
        bad = failed(check_imu(df, video_duration(video)))
        for c in bad:
            log.warning("Check %s failed: %s (expected %s)", c.name, c.value, c.expected)
        if not bad:
            log.info("All IMU sanity checks passed")
    return OK


if __name__ == "__main__":
    sys.exit(main())
