"""probing_qc.events (JSON Lines contract) and probing_qc.preview (chart downsampling)."""

import io
import json
import logging

import numpy as np
import pandas as pd
import pytest

from probing_qc.events import EVENT_VERSION, EventEmitter, EventLogHandler, Throttle, json_safe, make_event
from probing_qc.preview import bucket_means, bucket_size, downsample, frames_preview, imu_preview
from probing_qc.imu.table import IMU_COLUMNS

# --- events -------------------------------------------------------------------


def read_lines(buf: io.StringIO) -> list[dict]:
    return [json.loads(line) for line in buf.getvalue().splitlines()]


def test_event_envelope_and_types():
    e = make_event("log", now=1.23456, level="info", message="hi")
    assert e == {"v": EVENT_VERSION, "t": 1.235, "type": "log", "level": "info", "message": "hi"}
    with pytest.raises(ValueError):
        make_event("nope")


def test_emitter_writes_one_json_line_per_event():
    buf = io.StringIO()
    ev = EventEmitter(buf, clock=lambda: 10.0)
    ev.stage("imu", "start", "go")
    ev.progress("qc", 5, None, "five", unit="frames")
    ev.error("boom", stage="qc", error_type="ValueError")
    ev.result("results.json", "done")
    lines = read_lines(buf)
    assert [l["type"] for l in lines] == ["stage", "progress", "error", "result"]
    assert lines[1]["total"] is None and lines[1]["unit"] == "frames"
    assert lines[2]["stage"] == "qc" and lines[2]["error_type"] == "ValueError"
    assert all(l["v"] == EVENT_VERSION and l["t"] == 10.0 for l in lines)


def test_emitter_rejects_bad_stage_status_and_handles_none_stream():
    ev = EventEmitter(None)
    assert ev.log("info", "x")["message"] == "x"     # returned even when discarded
    with pytest.raises(ValueError):
        ev.stage("qc", "finished", "x")


def test_non_finite_numbers_become_null():
    buf = io.StringIO()
    EventEmitter(buf).stage("qc", "done", "x", data={"a": float("nan"), "b": [1.0, float("inf")]})
    data = read_lines(buf)[0]["data"]
    assert data == {"a": None, "b": [1.0, None]}
    assert json_safe((1, float("-inf"))) == [1, None]


def test_unicode_survives():
    buf = io.StringIO()
    EventEmitter(buf).log("info", "units m/s²")
    assert read_lines(buf)[0]["message"] == "units m/s²"


def test_throttle():
    now = {"t": 0.0}
    th = Throttle(0.5, clock=lambda: now["t"])
    assert th.ready()            # first call always passes
    now["t"] = 0.2
    assert not th.ready()
    assert th.ready(final=True)  # final always passes
    now["t"] = 0.8
    assert th.ready()


def test_log_handler_forwards_records():
    buf = io.StringIO()
    logger = logging.getLogger("probing_qc.test_events")
    handler = EventLogHandler(EventEmitter(buf))
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    try:
        logger.warning("careful %d", 3)
        logger.debug("hidden")             # handler level defaults to INFO
    finally:
        logger.removeHandler(handler)
    lines = read_lines(buf)
    assert len(lines) == 1
    assert lines[0] == {**lines[0], "type": "log", "level": "warning", "message": "careful 3",
                        "logger": "probing_qc.test_events"}


# --- preview ------------------------------------------------------------------


@pytest.mark.parametrize("n, max_points, size", [(0, 10, 1), (10, 10, 1), (11, 10, 2), (1000, 7, 143)])
def test_bucket_size(n, max_points, size):
    assert bucket_size(n, max_points) == size
    assert -(-n // size) <= max_points


def test_bucket_size_rejects_zero():
    with pytest.raises(ValueError):
        bucket_size(10, 0)


def test_bucket_means_nan_aware_and_partial_last_bucket():
    out = bucket_means(np.array([1, 3, np.nan, np.nan, 5]), 2)
    np.testing.assert_allclose(out[[0, 2]], [2, 5])
    assert np.isnan(out[1])
    assert bucket_means(np.array([]), 3).size == 0


def test_downsample_booleans_become_fractions():
    df = pd.DataFrame({"timestamp_s": [0, 1, 2, 3], "left": [True, False, True, True],
                       "left_score": [0.9, np.nan, np.nan, np.nan]})
    out = downsample(df, "timestamp_s", ["left", "left_score", "missing_col"], max_points=2)
    assert out["points"] == 2 and out["bucket_size"] == 2
    assert out["t"] == [0.5, 2.5]
    assert out["left"] == [0.5, 1.0]
    assert out["left_score"] == [0.9, None]          # all-NaN bucket -> null
    assert "missing_col" not in out
    json.dumps(out, allow_nan=False)


def test_downsample_empty_table():
    out = downsample(pd.DataFrame({"timestamp_s": []}), "timestamp_s", [], 10)
    assert out == {"points": 0, "bucket_size": 1, "t": []}


def test_imu_and_frames_preview_shapes():
    n = 10_000
    imu = pd.DataFrame(np.column_stack([np.arange(n) / 200] + [np.ones(n)] * 6), columns=IMU_COLUMNS)
    p = imu_preview(imu, max_points=100)
    assert p["points"] == 100 and set(p) >= {"acc_x", "gyro_z"}
    frames = pd.DataFrame({"timestamp_s": np.arange(50) / 7.5, "luminance": np.full(50, 100.0),
                           "left": np.zeros(50, bool)})
    f = frames_preview(frames, max_points=1000)
    assert f["points"] == 50 and f["luminance"][0] == 100.0 and f["left"][0] == 0.0
