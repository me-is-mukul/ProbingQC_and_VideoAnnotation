"""probing_qc.imu.table and imu.checks: merged table, summary, CSV, sanity checks."""

import numpy as np
import pandas as pd
import pytest

from probing_qc.imu.checks import check_imu, failed
from probing_qc.imu.table import IMU_COLUMNS, imu_dataframe, imu_summary, resample, write_imu_csv


def test_imu_dataframe(stream):
    df = imu_dataframe(stream)
    assert list(df.columns) == IMU_COLUMNS
    assert len(df) == 8
    assert df["timestamp_s"].is_monotonic_increasing
    np.testing.assert_allclose(df.loc[0, ["gyro_x", "gyro_y", "gyro_z"]], [0.1, 0.2, 0.0])


def test_resample_interpolates_and_holds_edges():
    out = resample(np.array([-1.0, 0.5, 2.0]), np.array([0.0, 1.0]), np.array([[0.0], [10.0]]))
    np.testing.assert_allclose(out[:, 0], [0.0, 5.0, 10.0])


def test_imu_summary_edge_cases():
    one = pd.DataFrame([[0.0] * 7], columns=IMU_COLUMNS)
    assert imu_summary(one) == {"samples": 1, "duration_s": 0.0, "rate_hz": None}
    empty = pd.DataFrame(columns=IMU_COLUMNS)
    assert imu_summary(empty)["rate_hz"] is None
    two = pd.DataFrame([[0.0] * 7, [0.005] + [0.0] * 6], columns=IMU_COLUMNS)
    assert imu_summary(two)["rate_hz"] == pytest.approx(200.0)


def test_write_imu_csv_round_trip(tmp_path, stream):
    df = imu_dataframe(stream)
    path = write_imu_csv(df, tmp_path / "sub" / "x_imu.csv")
    back = pd.read_csv(path)
    assert list(back.columns) == IMU_COLUMNS
    np.testing.assert_allclose(back.to_numpy(), df.to_numpy(), atol=1e-6)


def resting_imu(seconds: float = 10.0, rate: float = 200.0) -> pd.DataFrame:
    """A camera lying still: acc = (0, 0, g), gyro ~ 0, with a little seeded noise."""
    n = int(seconds * rate)
    rng = np.random.default_rng(0)
    t = np.arange(n) / rate
    acc = np.column_stack([np.zeros(n), np.zeros(n), np.full(n, 9.81)]) + rng.normal(0, 0.05, (n, 3))
    gyro = rng.normal(0, 0.01, (n, 3))
    return pd.DataFrame(np.column_stack([t, acc, gyro]), columns=IMU_COLUMNS)


def test_checks_pass_for_resting_camera():
    df = resting_imu()
    checks = check_imu(df, video_duration_s=10.0)
    assert failed(checks) == []
    assert {c.name for c in checks} >= {"no_nans", "timestamps_increasing",
                                        "duration_matches_video", "sample_rate",
                                        "gravity_magnitude", "gyro_bias"}


def test_checks_catch_bad_data():
    df = resting_imu()
    df.loc[5, "acc_x"] = np.nan
    df[["acc_x", "acc_y", "acc_z"]] *= 100       # wrong scale
    df.loc[10, "timestamp_s"] = 0.0              # clock jump back
    names = {c.name for c in failed(check_imu(df, video_duration_s=20.0))}
    assert {"no_nans", "timestamps_increasing", "duration_matches_video",
            "gravity_magnitude"} <= names


def test_duration_check_skipped_without_video_duration():
    assert "duration_matches_video" not in {c.name for c in check_imu(resting_imu())}
