"""Small numeric helpers: distribution summaries and boolean run handling."""

from __future__ import annotations

import numpy as np


def summarize(values, decimals: int = 4) -> dict:
    """Mean, spread and percentiles of a 1-D series (NaNs ignored)."""
    v = np.asarray(values, dtype=np.float64)
    v = v[~np.isnan(v)]
    keys = ("mean", "std", "min", "p5", "p50", "p95", "max")
    if v.size == 0:
        return dict.fromkeys(keys)
    stats = (v.mean(), v.std(), v.min(), *np.percentile(v, [5, 50, 95]), v.max())
    return {k: round(float(s), decimals) for k, s in zip(keys, stats)}


def pct(mask) -> float:
    """Percentage of True values (0 for an empty mask)."""
    m = np.asarray(mask, dtype=bool)
    return round(100.0 * m.mean(), 2) if m.size else 0.0


def runs(mask) -> np.ndarray:
    """Return (start, end) index pairs, end exclusive, of each run of True values."""
    m = np.asarray(mask, dtype=np.int8)
    if m.size == 0:
        return np.empty((0, 2), dtype=int)
    edges = np.diff(np.concatenate(([0], m, [0])))
    return np.column_stack((np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)))


def fill_gaps(mask, max_gap: int) -> np.ndarray:
    """Set interior False runs of length <= ``max_gap`` to True."""
    m = np.asarray(mask, dtype=bool).copy()
    if max_gap <= 0:
        return m
    for start, end in runs(~m):
        if start > 0 and end < m.size and end - start <= max_gap:
            m[start:end] = True
    return m


def drop_short(mask, min_len: int) -> np.ndarray:
    """Set True runs shorter than ``min_len`` to False."""
    m = np.asarray(mask, dtype=bool).copy()
    for start, end in runs(m):
        if end - start < min_len:
            m[start:end] = False
    return m
