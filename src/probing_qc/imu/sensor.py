"""Decode one GPMF sensor (e.g. ACCL, GYRO) into scaled, timestamped samples."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np

from .gpmf import iter_klv

log = logging.getLogger(__name__)

# Channel order used by HERO5-7, which do not write ORIN.
DEFAULT_ORIENTATION = "ZXY"
# Payload length assumed when a stream carries no STMP timestamps.
DEFAULT_PAYLOAD_SECONDS = 1.0


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

    def payload_starts(self) -> np.ndarray:
        """Start time of each payload in seconds (from STMP, or 1 s apart without it)."""
        if any(t is None for t in self.stmp_us):
            log.warning("%s has no STMP; assuming %.1f s payloads", self.key,
                        DEFAULT_PAYLOAD_SECONDS)
            return np.arange(len(self.payloads)) * DEFAULT_PAYLOAD_SECONDS
        return np.array(self.stmp_us, dtype=np.float64) / 1e6

    def timestamps(self) -> np.ndarray:
        """Per-sample time in seconds since recording start."""
        return payload_timestamps([len(p) for p in self.payloads], self.payload_starts())


def payload_timestamps(counts, starts_s) -> np.ndarray:
    """Spread each payload's samples evenly between its start and the next one.

    The final payload has no successor, so it reuses the mean sample period of
    the preceding payloads. A single payload is assumed to last
    ``DEFAULT_PAYLOAD_SECONDS``.
    """
    counts = np.asarray(counts, dtype=np.int64)
    starts = np.asarray(starts_s, dtype=np.float64)
    if counts.size == 0:
        return np.empty(0)
    if counts.size != starts.size:
        raise ValueError(f"{counts.size} payload counts but {starts.size} start times")
    if counts.size > 1:
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
    upper = orientation.upper()
    if len(orientation) != 3 or sorted(upper) != ["X", "Y", "Z"]:
        raise ValueError(f"Invalid ORIN string {orientation!r}; expected a permutation of XYZ")
    order = [upper.index(axis) for axis in "XYZ"]
    signs = np.array([-1.0 if orientation[i].islower() else 1.0 for i in order])
    return samples[:, order] * signs


def apply_scale(raw: np.ndarray, scal: np.ndarray | None) -> np.ndarray:
    """Divide raw integers by GPMF SCAL: one divisor for all channels, or one per channel."""
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
                    sensor.payloads.append(apply_scale(entry.values(), scal))
                    sensor.stmp_us.append(stmp)
                    sensor.orientation = orin or sensor.orientation
                    sensor.units = siun or sensor.units
    if not sensor.payloads:
        raise ValueError(f"No {key} samples found in GPMF stream")
    return sensor
