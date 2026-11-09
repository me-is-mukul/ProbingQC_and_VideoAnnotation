"""probing_qc.qc.analyzers, orientation and report builders (no video or MediaPipe needed)."""

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import pytest

from helpers import make_hand, probe_json
from probing_qc.qc.analyzers import HandAnalyzer, ImageQualityAnalyzer, build_analyzers, hand_row
from probing_qc.qc.config import QCConfig
from probing_qc.qc.frames import Frame
from probing_qc.qc.hands.interaction import LandmarkGraspDetector
from probing_qc.qc.hands.landmarks import FrameHands
from probing_qc.qc.metadata import parse_probe
from probing_qc.qc.orientation import gravity_stats_from_samples, window_means
from probing_qc.qc.pipeline import analyse_frames, summarize_sections
from probing_qc.qc import report as rpt


def frame(i: int = 0, value: int = 128, shape=(48, 64, 3)) -> Frame:
    return Frame(i, i / 30, np.full(shape, value, np.uint8))


class StubDetector:
    """Returns a scripted FrameHands per call; stands in for MediaPipe."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.closed = False

    def detect(self, rgb, timestamp_ms):
        self.calls.append(timestamp_ms)
        return self.script[len(self.calls) - 1]

    def close(self):
        self.closed = True


# --- image analyzer -----------------------------------------------------------


def test_image_analyzer_process_and_summarize():
    a = ImageQualityAnalyzer()
    rows = [a.process(frame(i, v)) for i, v in enumerate([10, 128, 250])]
    assert set(rows[0]) == {"luminance", "sharpness", "blockiness",
                            "cast_offset", "cast_factor", "cast_hue_deg"}
    s = a.summarize(pd.DataFrame(rows), dt=0.1)
    assert s["luminance"]["dark_frames_pct"] == pytest.approx(33.33)
    assert s["luminance"]["bright_frames_pct"] == pytest.approx(33.33)
    assert s["colour_cast"]["cast_hue_deg"] is None   # grey frames: no cast
    json.dumps(s)


# --- hand analyzer ------------------------------------------------------------


def test_hand_row_missing_and_present():
    row = hand_row(FrameHands(left=make_hand("left", 0.2, curl=1.0)), frame(), LandmarkGraspDetector())
    assert row["left"] and row["left_contact"] and row["left_curl"] == pytest.approx(1.0)
    assert not row["right"] and not row["right_contact"] and np.isnan(row["right_score"])


def test_hand_analyzer_with_stub_detector():
    script = [FrameHands(), FrameHands(left=make_hand("left", 0.2)), FrameHands()]
    det = StubDetector(script)
    a = HandAnalyzer(detector=det)
    frames = analyse_frames([frame(i) for i in range(3)], [a])
    assert det.calls == [0, 33, 67]                       # ms timestamps, increasing
    assert frames["left"].tolist() == [False, True, False]
    m = a.summarize(frames, dt=1 / 30)
    assert m["left_hand_pct"] == pytest.approx(33.33)
    assert a.info()["hand_detector"] == "StubDetector"    # no model -> no mediapipe fields
    a.close()
    assert det.closed


def test_build_analyzers_without_hands():
    cfg = QCConfig.from_dict({"hands": {"enabled": False}})
    assert [a.name for a in build_analyzers(cfg)] == ["image"]


def test_summarize_sections_merges_into_existing():
    report = {"technical": {"fps": 30}}
    rows = analyse_frames([frame(0)], [ImageQualityAnalyzer()])
    summarize_sections(report, [ImageQualityAnalyzer()], rows, 0.1)
    assert report["technical"]["fps"] == 30 and "luminance" in report["technical"]


# --- orientation --------------------------------------------------------------


def test_window_means_skips_empty_bins():
    t = np.array([0.0, 0.5, 2.1])                      # nothing in [1, 2)
    xyz = np.array([[1, 0, 0], [3, 0, 0], [0, 5, 0]], float)
    np.testing.assert_allclose(window_means(t, xyz, 1.0), [[2, 0, 0], [0, 5, 0]])


def test_gravity_stats_steady_and_window():
    t = np.arange(0, 10, 0.005)
    xyz = np.tile([0.0, 0.0, 9.81], (len(t), 1))
    g = gravity_stats_from_samples(t, xyz)
    assert g["up_unit_xyz"] == [0.0, 0.0, 1.0] and g["tilt_deg"]["max"] == 0.0
    with pytest.raises(ValueError):
        gravity_stats_from_samples(t, xyz, start_s=20)
    with pytest.raises(ValueError):
        gravity_stats_from_samples(t, np.zeros_like(xyz))


def test_gravity_stats_tilt():
    t = np.arange(0, 4, 0.01)
    xyz = np.where((t < 2)[:, None], [0.0, 0.0, 9.81], [0.0, 9.81, 0.0])  # 90° turn halfway
    tilt = gravity_stats_from_samples(t, xyz)["tilt_deg"]
    assert tilt["max"] == pytest.approx(45, abs=0.1)


# --- report -------------------------------------------------------------------


def test_report_sections():
    info = parse_probe(probe_json(side_data_list=[{"rotation": 90}]), "x.mp4", 1)
    tech = rpt.technical_section(info)
    assert tech["orientation"] == {"rotation_deg": 90, "display": "portrait",
                                   "width": 1080, "height": 1920}
    assert tech["bitrate"]["video_kbps"] == 60000.0
    s = rpt.sampling_section(QCConfig().sampling, 30.0, 10)
    assert s["analysis_fps"] == 7.5
    d = rpt.decode_section(["e1", "e2", "e3"], 0, 10, 9, max_messages=2)
    assert d["count"] == 3 and d["messages"] == ["e1", "e2"]


def test_runtime_section_flattens_provenance():
    started = datetime(2026, 1, 1, tzinfo=timezone.utc)
    r = rpt.runtime_section(started, 1.234, {"hands": {"model": "m"}}, env={"python_version": "3"})
    assert r == {"started_at": "2026-01-01T00:00:00+00:00", "elapsed_s": 1.2,
                 "python_version": "3", "model": "m"}


def test_environment_lists_versions():
    env = rpt.environment()
    for key in ("python_version", "numpy_version", "opencv_version", "ffmpeg_version"):
        assert key in env
