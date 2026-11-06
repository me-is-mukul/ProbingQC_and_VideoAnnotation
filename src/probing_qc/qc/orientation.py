"""Camera orientation statistics from the GoPro accelerometer (gravity direction)."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ..imu import extract_sensor
from ..telemetry import read_gpmf
from .stats import summarize


def gravity_stats(video: Path, start_s: float = 0.0, max_seconds: float | None = None,
                  window_s: float = 1.0) -> dict:
    """Median "up" direction in the camera's IMU frame and how much it varies.

    The accelerometer is averaged over ``window_s`` windows to suppress motion.
    At rest it measures the reaction to gravity, so each window's mean points
    up, opposite to gravity. ``tilt_deg`` is each
    window's angle from the median direction: low values mean a steady camera,
    high values mean a lot of head movement or a loose mount.
    """
    acc = extract_sensor(read_gpmf(video), "ACCL")
    t, xyz = acc.timestamps(), acc.samples()
    end_s = start_s + max_seconds if max_seconds is not None else np.inf
    in_range = (t >= start_s) & (t < end_s)
    if not in_range.any():
        raise ValueError("No accelerometer samples in the analysed time range")
    t, xyz = t[in_range], xyz[in_range]
    bins = np.floor((t - t[0]) / window_s).astype(int)
    counts = np.bincount(bins)
    keep = counts > 0
    means = np.column_stack([np.bincount(bins, xyz[:, i])[keep] / counts[keep] for i in range(3)])
    units = means / np.linalg.norm(means, axis=1, keepdims=True)

    median = np.median(units, axis=0)
    median /= np.linalg.norm(median)
    tilt = np.degrees(np.arccos(np.clip(units @ median, -1.0, 1.0)))
    return {
        "source": "GPMF ACCL",
        "up_unit_xyz": [round(float(v), 4) for v in median],
        "tilt_deg": summarize(tilt, decimals=2),
    }
