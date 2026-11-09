"""Aggregate per-frame hand presence/contact flags into the report's hand metrics."""

from __future__ import annotations

import numpy as np

from ..config import HandConfig
from ..stats import drop_short, fill_gaps, pct, runs


def seconds_to_frames(seconds: float, dt: float) -> int:
    """Number of analysed frames spanning ``seconds`` (rounded, never negative)."""
    return max(int(round(seconds / dt)), 0)


def tracking_losses(present: np.ndarray, min_gap: int) -> int:
    """Number of times tracking drops out for at least ``min_gap`` samples.

    A gap before the first detection is not a loss (nothing was tracked yet).
    A gap that runs to the end of the clip is a loss.
    """
    gaps = runs(~np.asarray(present, bool))
    return int(sum(1 for start, end in gaps if start > 0 and end - start >= min_gap))


def longest_gap_s(present: np.ndarray, dt: float) -> float:
    """Longest run of ``False`` in seconds (0 when always present)."""
    gaps = runs(~np.asarray(present, bool))
    return float((gaps[:, 1] - gaps[:, 0]).max() * dt) if len(gaps) else 0.0


def grasp_episodes(contact: np.ndarray, dt: float, cfg: HandConfig) -> tuple[np.ndarray, np.ndarray]:
    """Clean a contact mask (bridge short gaps, drop blips).

    Returns (episode durations in seconds, cleaned mask).
    """
    c = fill_gaps(contact, seconds_to_frames(cfg.grasp_merge_gap_s, dt))
    c = drop_short(c, max(seconds_to_frames(cfg.grasp_min_duration_s, dt), 1))
    r = runs(c)
    return (r[:, 1] - r[:, 0]) * dt, c


def duration_summary(episodes: np.ndarray) -> dict:
    """``total_s, mean_s, median_s, max_s`` of episode durations (``None`` stats when empty)."""
    e = np.asarray(episodes, dtype=np.float64)
    if e.size == 0:
        return {"total_s": 0.0, "mean_s": None, "median_s": None, "max_s": None}
    return {"total_s": round(float(e.sum()), 2), "mean_s": round(float(e.mean()), 2),
            "median_s": round(float(np.median(e)), 2), "max_s": round(float(e.max()), 2)}


def compute_hand_metrics(left: np.ndarray, right: np.ndarray,
                         left_contact: np.ndarray, right_contact: np.ndarray,
                         dt: float, cfg: HandConfig) -> dict:
    """All inputs are boolean arrays over the analysed frames; ``dt`` is seconds per sample.

    Contact only counts while that hand is detected.
    """
    left, right = np.asarray(left, bool), np.asarray(right, bool)
    either, both = left | right, left & right
    min_gap = max(seconds_to_frames(cfg.min_loss_s, dt), 1)

    left_eps, left_mask = grasp_episodes(np.asarray(left_contact, bool) & left, dt, cfg)
    right_eps, right_mask = grasp_episodes(np.asarray(right_contact, bool) & right, dt, cfg)
    episodes = np.concatenate([left_eps, right_eps])

    def per_hand(present, eps) -> dict:
        return {"tracking_losses": tracking_losses(present, min_gap), "grasp_count": int(eps.size),
                "grasp_duration": duration_summary(eps)}

    return {
        "either_hand_pct": pct(either),
        "both_hands_pct": pct(both),
        "left_hand_pct": pct(left),
        "right_hand_pct": pct(right),
        "HOI_pct": pct(left_mask | right_mask),
        "tracking_losses": tracking_losses(either, min_gap),
        "untracked_pct": pct(~either),
        "grasp_count": int(episodes.size),
        "grasp_duration": duration_summary(episodes),
        "longest_hand_gap": round(longest_gap_s(either, dt), 2),
        "per_hand": {"left": per_hand(left, left_eps), "right": per_hand(right, right_eps)},
    }
