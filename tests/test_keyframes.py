"""probing_qc.keyframes: parsing ffprobe packet lines into keyframe frame numbers (no FFmpeg)."""

import shutil
import subprocess

import pytest

from probing_qc.keyframes import ALL_KEYFRAMES, describe, parse_packets, read_keyframes


def test_gopro_like_gop():
    # 1 s GOP at 30 fps, no B-frames: pts in display order
    lines = [f"{i * 1001},{'K__' if i % 30 == 0 else '___'}" for i in range(95)]
    assert parse_packets("\n".join(lines)) == [0, 30, 60, 90]


def test_b_frame_reordering_uses_presentation_order():
    # decode order I P B B with pts 0 3 1 2 -> display order I B B P; one keyframe at display 0,
    # second GOP's keyframe has pts 4 (display frame 4)
    text = "0,K__\n3,___\n1,___\n2,___\n4,K__\n"
    assert parse_packets(text) == [0, 4]


def test_skips_discarded_and_unknown_pts():
    text = "0,K__\nN/A,___\n1,__D\n2,___\n3,K__\n,K__\n"
    # frames are pts 0, 2, 3 -> numbers 0, 1, 2
    assert parse_packets(text) == [0, 2]


def test_all_intra_and_empty():
    assert parse_packets("0,K__\r\n1,K__\r\n2,K_\r\n") == ALL_KEYFRAMES
    assert parse_packets("") is None
    assert parse_packets("N/A,K__\n") is None


def test_describe():
    assert describe([0, 30, 60, 90], 29.97) == "4 keyframes, every 30 frames (1.00 s)"
    assert describe(ALL_KEYFRAMES, 30) == "Every frame is a keyframe (all-intra)"
    assert describe(None, 30) == "No keyframes found"
    assert describe([0], 30) == "1 keyframe"


@pytest.mark.integration
@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg not installed")
def test_read_keyframes_on_encoded_clip(tmp_path):
    path = tmp_path / "gop.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=30:duration=2",
                    "-c:v", "libx264", "-g", "15", "-keyint_min", "15", "-sc_threshold", "0",
                    "-bf", "2", "-pix_fmt", "yuv420p", str(path)], check=True)
    assert read_keyframes(path) == [0, 15, 30, 45]
