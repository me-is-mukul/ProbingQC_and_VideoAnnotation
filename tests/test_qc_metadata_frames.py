"""probing_qc.qc.metadata (parse_probe) and qc.frames (pure helpers), no FFmpeg needed."""

import pytest

from helpers import probe_json
from probing_qc.qc.frames import decode_command, expected_frame_count
from probing_qc.qc.metadata import parse_fps, parse_probe, parse_rotation


def test_parse_probe_gopro_like():
    info = parse_probe(probe_json(), "x.mp4", 123)
    assert (info.width, info.height, info.codec) == (1920, 1080, "hevc")
    assert info.fps == pytest.approx(29.97, abs=1e-3)
    assert info.frame_count == 300 and info.has_gpmf
    assert info.video_bitrate == 60_000_000 and info.total_bitrate == 61_000_000
    assert info.display_size == (1920, 1080) and info.size_bytes == 123


def test_parse_probe_fallbacks():
    data = probe_json(nb_frames="N/A", bit_rate=None, duration=None, avg_frame_rate="0/0",
                      r_frame_rate="25/1")
    info = parse_probe(data, "x.mp4", 0)
    assert info.fps == 25.0
    assert info.duration_s == pytest.approx(10.01)        # from format
    assert info.frame_count == round(10.01 * 25)          # estimated
    assert info.video_bitrate is None


def test_parse_probe_audio_and_b_frames():
    info = parse_probe(probe_json(), "x.mp4", 0)
    assert info.has_audio is True and info.has_b_frames == 0      # GoPro: no B-frames
    info = parse_probe(probe_json(has_b_frames=2), "x.mp4", 0)
    assert info.has_b_frames == 2
    silent = probe_json()
    silent["streams"] = [s for s in silent["streams"] if s["codec_type"] != "audio"]
    assert parse_probe(silent, "x.mp4", 0).has_audio is False


def test_parse_probe_rejects_audio_only():
    with pytest.raises(ValueError):
        parse_probe({"streams": [{"codec_type": "audio"}], "format": {}}, "a.m4a", 0)


def test_parse_fps_no_rate():
    with pytest.raises(ValueError):
        parse_fps({"avg_frame_rate": "0/0", "r_frame_rate": "0/0"})


@pytest.mark.parametrize("stream, deg", [
    ({}, 0),
    ({"tags": {"rotate": "90"}}, 90),
    ({"side_data_list": [{"rotation": -90}]}, 270),
    ({"side_data_list": [{"other": 1}, {"rotation": 180}], "tags": {"rotate": "90"}}, 180),
])
def test_parse_rotation(stream, deg):
    assert parse_rotation(stream) == deg


def test_rotated_display_size():
    info = parse_probe(probe_json(side_data_list=[{"rotation": 90}]), "x.mp4", 0)
    assert info.display_size == (1080, 1920)


@pytest.mark.parametrize("frames, start, max_s, stride, expected", [
    (60, 0, None, 4, 15),
    (60, 0, None, 1, 60),
    (61, 0, None, 4, 16),     # ceil
    (60, 1.0, None, 4, 8),    # 30 frames left
    (60, 0, 1.0, 4, 8),       # 30 frames in window
    (60, 5.0, None, 4, 0),    # start past the end
])
def test_expected_frame_count(frames, start, max_s, stride, expected):
    assert expected_frame_count(frames, 30.0, stride, start, max_s) == expected


def test_decode_command():
    cmd = decode_command("ffmpeg", "in.mp4", 4)
    assert cmd[0] == "ffmpeg" and "-ss" not in cmd and "-t" not in cmd and "-hwaccel" not in cmd
    assert "select=not(mod(n\\,4))" in cmd
    cmd = decode_command("ffmpeg", "in.mp4", 2, start_s=1.5, max_seconds=3, hwaccel="cuda")
    assert cmd[cmd.index("-ss") + 1] == "1.5" and cmd[cmd.index("-t") + 1] == "3"
    assert cmd.index("-hwaccel") < cmd.index("-i") and cmd.index("-ss") < cmd.index("-i")
