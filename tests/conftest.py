"""Shared fixtures. Builders live in helpers.py so they can be imported directly."""

import shutil
import subprocess

import pytest

from helpers import gpmf_stream

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
requires_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="FFmpeg not installed")


@pytest.fixture
def stream() -> bytes:
    """Two 4-sample payloads, 1 s apart (ACCL scale 100, GYRO scale 10)."""
    return gpmf_stream(payloads=2, samples=4)


@pytest.fixture(scope="session")
def synthetic_video(tmp_path_factory):
    """2 s, 320x240, 30 fps H.264 test pattern (60 frames), no audio or GPMF."""
    if not HAS_FFMPEG:
        pytest.skip("FFmpeg not installed")
    path = tmp_path_factory.mktemp("video") / "test.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi",
                    "-i", "testsrc2=size=320x240:rate=30:duration=2",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], check=True)
    return path
