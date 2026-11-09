"""Argument and logging helpers shared by the command-line entry points."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from ..paths import INPUT_DIR, OUTPUT_DIR, resolve_video

LOG_FORMAT = "%(levelname)s %(name)s: %(message)s"

# Exit codes
OK, NOT_FOUND, USAGE, CANCELLED = 0, 1, 2, 130


def make_parser(doc: str | None) -> argparse.ArgumentParser:
    return argparse.ArgumentParser(description=doc, formatter_class=argparse.RawDescriptionHelpFormatter)


def add_io_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--input-dir", type=Path, default=INPUT_DIR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("-v", "--verbose", action="store_true")


def setup_logging(verbose: bool) -> None:
    logging.basicConfig(level=logging.DEBUG if verbose else logging.INFO, format=LOG_FORMAT)


def find_video(video: str, input_dir: Path, log: logging.Logger) -> Path | None:
    """``resolve_video`` that logs a helpful error when nothing is found."""
    path = resolve_video(video, input_dir)
    if path is None:
        log.error("Video not found: %s (also looked in %s)", video, input_dir)
    return path
