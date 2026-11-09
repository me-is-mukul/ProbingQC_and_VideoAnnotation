"""Downsample long per-sample tables into compact, chart-ready series.

The web UI never receives the raw tables (an 81-minute IMU CSV is ~63 MB).
Instead each table is cut into at most ``max_points`` equal-count buckets and
each bucket is replaced by its mean. Boolean columns become the fraction of
True values per bucket (0-1). The output is columnar JSON:

    {"points": n, "bucket_size": k, "t": [...], "<column>": [...], ...}

NaN (e.g. a hand score when no hand was seen) is ignored inside a bucket; a
bucket that is all NaN becomes ``None``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

DEFAULT_MAX_POINTS = 1500

IMU_PREVIEW_COLUMNS = ("acc_x", "acc_y", "acc_z", "gyro_x", "gyro_y", "gyro_z")
FRAME_PREVIEW_COLUMNS = (
    "luminance", "sharpness", "blockiness", "cast_factor",
    "left", "right", "left_contact", "right_contact", "left_score", "right_score",
)


def bucket_size(n: int, max_points: int) -> int:
    """Samples per bucket so that ``ceil(n / size) <= max_points`` (at least 1)."""
    if max_points < 1:
        raise ValueError("max_points must be >= 1")
    return max(1, -(-n // max_points))


def bucket_means(values: np.ndarray, size: int) -> np.ndarray:
    """NaN-aware mean of consecutive ``size``-sample buckets; all-NaN buckets give NaN."""
    v = np.asarray(values, dtype=np.float64)
    n = v.size
    if n == 0:
        return np.empty(0)
    pad = (-n) % size
    padded = np.concatenate([v, np.full(pad, np.nan)]).reshape(-1, size)
    valid = ~np.isnan(padded)
    counts = valid.sum(axis=1)
    sums = np.where(valid, padded, 0.0).sum(axis=1)
    out = np.full(counts.shape, np.nan)
    np.divide(sums, counts, out=out, where=counts > 0)
    return out


def _to_list(values: np.ndarray, decimals: int) -> list[float | None]:
    return [None if np.isnan(x) else round(float(x), decimals) for x in values]


def downsample(df: pd.DataFrame, time_column: str, columns, max_points: int = DEFAULT_MAX_POINTS,
               decimals: int = 4) -> dict:
    """Bucket-mean ``columns`` of ``df`` (missing columns are skipped)."""
    size = bucket_size(len(df), max_points)
    out: dict = {"points": 0, "bucket_size": size,
                 "t": _to_list(bucket_means(df[time_column].to_numpy(), size), 3) if len(df) else []}
    out["points"] = len(out["t"])
    for col in columns:
        if col in df.columns:
            out[col] = _to_list(bucket_means(df[col].to_numpy(dtype=np.float64), size), decimals)
    return out


def imu_preview(df: pd.DataFrame, max_points: int = DEFAULT_MAX_POINTS) -> dict:
    return downsample(df, "timestamp_s", IMU_PREVIEW_COLUMNS, max_points)


def frames_preview(frames: pd.DataFrame, max_points: int = DEFAULT_MAX_POINTS) -> dict:
    return downsample(frames, "timestamp_s", FRAME_PREVIEW_COLUMNS, max_points)
