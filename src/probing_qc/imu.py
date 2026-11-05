"""Decode accelerometer and gyroscope samples from a GPMF byte stream."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from .gpmf import iter_klv
from .telemetry import read_gpmf

log = logging.getLogger(__name__)

# Channel order used by HERO5-7, which do not write ORIN.
DEFAULT_ORIENTATION = "ZXY"
# Payload length assumed when a stream carries no STMP timestamps.
DEFAULT_PAYLOAD_SECONDS = 1.0

IMU_COLUMNS = ["timestamp_s", "acc_x", "acc_y", "acc_z", "gyro_x", "gyro_y", "gyro_z"]


@dataclass
class SensorStream:
    """All payloads of one sensor (e.g. ACCL) with their start timestamps."""

    key: str
    payloads: list[np.ndarray] = field(default_factory=list)
    stmp_us: list[int | None] = field(default_factory=list)
    orientation: str | None = None
    units: str | None = None

    @property
    def num_samples(self) -> int:
        return sum(len(p) for p in self.payloads)

    def samples(self) -> np.ndarray:
        """Scaled samples, shape (n, 3), reordered to camera X, Y, Z."""
        return to_xyz(np.vstack(self.payloads), self.orientation or DEFAULT_ORIENTATION)

    def timestamps(self) -> np.ndarray:
        """Per-sample time in seconds since recording start.

        Samples are spread evenly between consecutive payload STMP values; the
        final payload reuses the mean rate of the preceding ones.
        """
        counts = np.array([len(p) for p in self.payloads])
        if any(t is None for t in self.stmp_us):
            log.warning("%s has no STMP; assuming %.1f s payloads", self.key,
                        DEFAULT_PAYLOAD_SECONDS)
            starts = np.arange(len(counts)) * DEFAULT_PAYLOAD_SECONDS
        else:
            starts = np.array(self.stmp_us, dtype=np.float64) / 1e6

        if len(counts) > 1:
            durations = np.diff(starts)
            mean_period = durations.sum() / counts[:-1].sum()
            durations = np.append(durations, counts[-1] * mean_period)
        else:
            durations = np.array([DEFAULT_PAYLOAD_SECONDS])

        return np.concatenate([
            start + np.arange(n) * (dur / n)
            for start, dur, n in zip(starts, durations, counts)
        ])


def to_xyz(samples: np.ndarray, orientation: str) -> np.ndarray:
    """Reorder channels to X, Y, Z using a GPMF ORIN string (lowercase = negated)."""
    order = [orientation.upper().index(axis) for axis in "XYZ"]
    signs = np.array([-1.0 if orientation[i].islower() else 1.0 for i in order])
    return samples[:, order] * signs


def _scale(raw: np.ndarray, scal: np.ndarray | None) -> np.ndarray:
    values = raw.astype(np.float64)
    if scal is None:
        return values
    divisor = scal.astype(np.float64).ravel()
    return values / (divisor[0] if divisor.size == 1 else divisor)


def extract_sensor(data: bytes, key: str) -> SensorStream:
    """Collect every ``key`` payload from DEVC > STRM containers in ``data``."""
    sensor = SensorStream(key)
    for devc in iter_klv(data):
        if devc.key != "DEVC":
            continue
        for strm in devc.children():
            if strm.key != "STRM":
                continue
            # Properties are "sticky": they modify the data entry that follows them.
            scal = stmp = orin = siun = None
            for entry in strm.children():
                if entry.key == "SCAL":
                    scal = entry.values()
                elif entry.key == "STMP":
                    stmp = int(entry.values()[0, 0])
                elif entry.key == "ORIN":
                    orin = entry.text()
                elif entry.key == "SIUN":
                    siun = entry.payload.rstrip(b"\x00").decode("latin-1")
                elif entry.key == key and entry.repeat > 0:
                    sensor.payloads.append(_scale(entry.values(), scal))
                    sensor.stmp_us.append(stmp)
                    sensor.orientation = orin or sensor.orientation
                    sensor.units = siun or sensor.units
    if not sensor.payloads:
        raise ValueError(f"No {key} samples found in GPMF stream")
    return sensor


def imu_dataframe(data: bytes) -> pd.DataFrame:
    """Build the IMU table from raw GPMF bytes.

    Rows follow the accelerometer clock. Gyroscope values are linearly
    interpolated onto it, which is a no-op when both sensors share timestamps.
    """
    acc = extract_sensor(data, "ACCL")
    gyro = extract_sensor(data, "GYRO")

    t_acc, acc_xyz = acc.timestamps(), acc.samples()
    t_gyro, gyro_xyz = gyro.timestamps(), gyro.samples()
    if acc.num_samples != gyro.num_samples:
        log.info("ACCL has %d samples, GYRO has %d; resampling GYRO onto ACCL clock",
                 acc.num_samples, gyro.num_samples)
    gyro_on_acc = np.column_stack([np.interp(t_acc, t_gyro, gyro_xyz[:, i]) for i in range(3)])

    return pd.DataFrame(np.column_stack([t_acc, acc_xyz, gyro_on_acc]), columns=IMU_COLUMNS)


def extract_imu(video: Path) -> pd.DataFrame:
    """Extract the IMU table straight from a GoPro MP4."""
    return imu_dataframe(read_gpmf(Path(video)))
