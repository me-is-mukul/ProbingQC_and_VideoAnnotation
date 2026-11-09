"""probing_qc.paths, probing_qc.download, probing_qc.ffmpeg, imu.telemetry (pure parts)."""

import pytest

from probing_qc.download import filename_from_url, is_valid_url
from probing_qc.ffmpeg import parse_ffmpeg_version, require_tool
from probing_qc.imu.telemetry import find_gpmf_index, has_gpmf, read_gpmf
from probing_qc.paths import IMU_SUFFIX, list_videos, output_path, resolve_video

# --- paths --------------------------------------------------------------------


def test_resolve_video_prefers_direct_path(tmp_path, monkeypatch):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    (input_dir / "a.mp4").write_bytes(b"")
    monkeypatch.chdir(tmp_path)
    assert resolve_video("a.mp4", input_dir) == (input_dir / "a.mp4").resolve()
    (tmp_path / "a.mp4").write_bytes(b"")             # same name in cwd wins
    assert resolve_video("a.mp4", input_dir) == (tmp_path / "a.mp4").resolve()
    assert resolve_video("missing.mp4", input_dir) is None
    assert resolve_video("input", tmp_path) is None   # directories are not videos


def test_output_path_uses_stem():
    assert output_path("in/My Clip.MP4", "out", IMU_SUFFIX).as_posix() == "out/My Clip_imu.csv"


def test_list_videos_filters_and_sorts(tmp_path):
    for name in ("b.MP4", "a.mov", "c.txt", "d.mp4.part"):
        (tmp_path / name).write_bytes(b"")
    (tmp_path / "e.mp4").mkdir()
    assert [p.name for p in list_videos(tmp_path)] == ["a.mov", "b.MP4"]
    assert list_videos(tmp_path / "nope") == []


# --- download -----------------------------------------------------------------


@pytest.mark.parametrize("url, ok", [
    ("https://x.org/v.mp4", True), ("http://x.org", True),
    ("ftp://x.org/v.mp4", False), ("x.org/v.mp4", False), ("https://", False), ("", False),
])
def test_is_valid_url(url, ok):
    assert is_valid_url(url) is ok


@pytest.mark.parametrize("url, name", [
    ("https://x.org/a/GX010140.MP4", "GX010140.MP4"),
    ("https://x.org/a/My%20Clip.mp4?sig=1#t", "My Clip.mp4"),
    ("https://x.org/a/", ""),
    ("https://x.org", ""),
    ("https://x.org/a/..%2F..%2Fevil.mp4", "evil.mp4"),   # no path traversal
    ("https://x.org/a/..%5C..%5Cevil.mp4", "evil.mp4"),
    ("https://x.org/a/..", ""),
])
def test_filename_from_url(url, name):
    assert filename_from_url(url) == name


# --- ffmpeg / telemetry -------------------------------------------------------


def test_parse_ffmpeg_version():
    assert parse_ffmpeg_version("ffmpeg version 8.0.1-essentials Copyright (c)") == "8.0.1-essentials"
    assert parse_ffmpeg_version("") is None
    assert parse_ffmpeg_version("something else") is None


def test_require_tool_missing():
    with pytest.raises(RuntimeError):
        require_tool("definitely-not-a-real-tool-xyz")


def test_find_gpmf_index():
    streams = [{"index": 0, "codec_type": "video"}, {"index": 3, "codec_tag_string": "gpmd"},
               {"index": 4, "codec_tag_string": "gpmd"}]
    assert find_gpmf_index(streams) == 3          # first match wins
    assert find_gpmf_index(streams[:1]) is None and not has_gpmf([])


def test_read_gpmf_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        read_gpmf(tmp_path / "nope.mp4")
