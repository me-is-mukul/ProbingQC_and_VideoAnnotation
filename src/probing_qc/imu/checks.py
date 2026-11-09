"""Physical sanity checks on an extracted IMU table.

These catch broken extractions (wrong scale, wrong clock, corrupt payloads)
without needing ground truth. The limits suit a GoPro at rest or in normal
handheld/head-mounted use (HERO12: about 200 Hz).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

GRAVITY = 9.81  # m/s²


@dataclass(frozen=True)
class ImuLimits:
    duration_tolerance_s: float = 1.0       # |IMU span - video duration|
    min_rate_hz: float = 150.0
    max_rate_hz: float = 250.0
    gravity_tolerance: float = 0.5          # |median |acc| - g| in m/s²
    max_gyro_bias: float = 0.05             # |mean gyro| per axis in rad/s


@dataclass(frozen=True)
class Check:
    name: str
    passed: bool
    value: float | None
    expected: str


def check_imu(df: pd.DataFrame, video_duration_s: float | None = None,
              limits: ImuLimits = ImuLimits()) -> list[Check]:
    """Run every check; the duration check is skipped when no video duration is given."""
    t = df["timestamp_s"].to_numpy()
    acc = df[["acc_x", "acc_y", "acc_z"]].to_numpy()
    gyro = df[["gyro_x", "gyro_y", "gyro_z"]].to_numpy()
    checks = [
        Check("no_nans", not df.isna().any().any(), float(df.isna().sum().sum()), "0 NaN values"),
        Check("timestamps_increasing", bool(len(t) > 1 and np.all(np.diff(t) > 0)),
              None, "strictly increasing"),
    ]

    span = float(t[-1] - t[0]) if len(t) else 0.0
    if video_duration_s is not None:
        diff = abs(span - video_duration_s)
        checks.append(Check("duration_matches_video", diff <= limits.duration_tolerance_s,
                            round(diff, 3), f"<= {limits.duration_tolerance_s} s off"))

    rate = (len(t) - 1) / span if span > 0 else 0.0
    checks.append(Check("sample_rate", limits.min_rate_hz <= rate <= limits.max_rate_hz,
                        round(rate, 2), f"{limits.min_rate_hz}-{limits.max_rate_hz} Hz"))

    g = float(np.median(np.linalg.norm(acc, axis=1))) if len(acc) else float("nan")
    checks.append(Check("gravity_magnitude", abs(g - GRAVITY) <= limits.gravity_tolerance,
                        round(g, 3), f"{GRAVITY} ± {limits.gravity_tolerance} m/s²"))

    bias = float(np.abs(gyro.mean(axis=0)).max()) if len(gyro) else float("nan")
    checks.append(Check("gyro_bias", bias < limits.max_gyro_bias,
                        round(bias, 4), f"< {limits.max_gyro_bias} rad/s per axis"))
    return checks


def failed(checks: list[Check]) -> list[Check]:
    return [c for c in checks if not c.passed]
