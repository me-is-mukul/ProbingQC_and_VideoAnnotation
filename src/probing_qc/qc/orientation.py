"""Camera orientation statistics from the GoPro accelerometer (gravity direction).

``gravity_stats_from_samples`` is pure; ``gravity_stats`` reads the video's GPMF.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ..imu.sensor import extract_sensor
from ..imu.telemetry import read_gpmf
from .stats import summarize


def select_window(t: np.ndarray, xyz: np.ndarray, start_s: float = 0.0,
                  max_seconds: float | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Samples with ``start_s <= t < start_s + max_seconds``."""
    end_s = start_s + max_seconds if max_seconds is not None else np.inf
    keep = (t >= start_s) & (t < end_s)
    return t[keep], xyz[keep]


def window_means(t: np.ndarray, xyz: np.ndarray, window_s: float) -> np.ndarray:
    """Mean of ``xyz`` over consecutive ``window_s`` bins from ``t[0]``; empty bins skipped."""
    bins = np.floor((t - t[0]) / window_s).astype(int)
    counts = np.bincount(bins)
    keep = counts > 0
    return np.column_stack([np.bincount(bins, xyz[:, i])[keep] / counts[keep] for i in range(3)])


def gravity_stats_from_samples(t: np.ndarray, xyz: np.ndarray, start_s: float = 0.0,
                               max_seconds: float | None = None, window_s: float = 1.0) -> dict:
    """Median "up" direction in the camera's IMU frame and how much it varies.

    The accelerometer is averaged over ``window_s`` windows to suppress motion.
    At rest it measures the reaction to gravity, so each window's mean points
    up, opposite to gravity. ``tilt_deg`` is each window's angle from the median
    direction: low values mean a steady camera, high values mean a lot of head
    movement or a loose mount. Windows whose mean is exactly zero are ignored.
    """
    t, xyz = select_window(np.asarray(t), np.asarray(xyz), start_s, max_seconds)
    if t.size == 0:
        raise ValueError("No accelerometer samples in the analysed time range")
    means = window_means(t, xyz, window_s)
    norms = np.linalg.norm(means, axis=1)
    means, norms = means[norms > 0], norms[norms > 0]
    if means.size == 0:
        raise ValueError("Accelerometer reads zero in every window")
    units = means / norms[:, None]

    median = np.median(units, axis=0)
    median /= np.linalg.norm(median)
    tilt = np.degrees(np.arccos(np.clip(units @ median, -1.0, 1.0)))
    return {
        "source": "GPMF ACCL",
        "up_unit_xyz": [round(float(v), 4) for v in median],
        "tilt_deg": summarize(tilt, decimals=2),
    }


def gravity_stats(video: str | Path, start_s: float = 0.0, max_seconds: float | None = None,
                  window_s: float = 1.0) -> dict:
    acc = extract_sensor(read_gpmf(video), "ACCL")
    return gravity_stats_from_samples(acc.timestamps(), acc.samples(), start_s, max_seconds, window_s)
