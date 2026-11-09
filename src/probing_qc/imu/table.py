"""Build, summarise and save the merged accelerometer + gyroscope table."""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from .sensor import SensorStream, extract_sensor
from .telemetry import read_gpmf

log = logging.getLogger(__name__)

IMU_COLUMNS = ["timestamp_s", "acc_x", "acc_y", "acc_z", "gyro_x", "gyro_y", "gyro_z"]
CSV_FLOAT_FORMAT = "%.6f"


def resample(t_target: np.ndarray, t_source: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Linearly interpolate each column of ``values`` from ``t_source`` onto ``t_target``.

    Outside the source range the edge values are held (``np.interp`` behaviour).
    """
    return np.column_stack([np.interp(t_target, t_source, values[:, i])
                            for i in range(values.shape[1])])


def imu_dataframe(data: bytes) -> pd.DataFrame:
    """Build the IMU table from raw GPMF bytes."""
    return imu_table(extract_sensor(data, "ACCL"), extract_sensor(data, "GYRO"))


def imu_table(acc: SensorStream, gyro: SensorStream) -> pd.DataFrame:
    """Merge decoded ACCL and GYRO streams into one table.

    Rows follow the accelerometer clock. Gyroscope values are linearly
    interpolated onto it, which is a no-op when both sensors share timestamps.
    """
    if acc.num_samples != gyro.num_samples:
        log.info("ACCL has %d samples, GYRO has %d; resampling GYRO onto ACCL clock",
                 acc.num_samples, gyro.num_samples)
    t_acc = acc.timestamps()
    gyro_on_acc = resample(t_acc, gyro.timestamps(), gyro.samples())
    return pd.DataFrame(np.column_stack([t_acc, acc.samples(), gyro_on_acc]), columns=IMU_COLUMNS)


def extract_imu(video: str | Path) -> pd.DataFrame:
    """Extract the IMU table straight from a GoPro MP4."""
    return imu_dataframe(read_gpmf(Path(video)))


def imu_summary(df: pd.DataFrame) -> dict:
    """Sample count, covered duration and mean sample rate of an IMU table.

    ``rate_hz`` is ``None`` when there are fewer than two samples or no time span.
    """
    n = len(df)
    duration = float(df["timestamp_s"].iloc[-1] - df["timestamp_s"].iloc[0]) if n else 0.0
    rate = (n - 1) / duration if n > 1 and duration > 0 else None
    return {"samples": n, "duration_s": duration, "rate_hz": rate}


def write_imu_csv(df: pd.DataFrame, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, float_format=CSV_FLOAT_FORMAT)
    return path
