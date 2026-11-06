"""Aggregate per-frame hand presence/contact flags into the report's hand metrics."""

from __future__ import annotations

import numpy as np

from .config import HandConfig
from .stats import drop_short, fill_gaps, pct, runs


def _frames(seconds: float, dt: float) -> int:
    return max(int(round(seconds / dt)), 0)


def tracking_losses(present: np.ndarray, min_gap: int) -> int:
    """Number of times tracking drops out for at least ``min_gap`` samples.

    A gap before the first detection is not a loss (nothing was tracked yet).
    """
    gaps = runs(~present)
    return int(sum(1 for start, end in gaps if start > 0 and end - start >= min_gap))


def grasp_episodes(contact: np.ndarray, dt: float, cfg: HandConfig) -> tuple[np.ndarray, np.ndarray]:
    """Clean a contact mask (bridge short gaps, drop blips).

    Returns (episode durations in seconds, cleaned mask).
    """
    c = fill_gaps(contact, _frames(cfg.grasp_merge_gap_s, dt))
    c = drop_short(c, max(_frames(cfg.grasp_min_duration_s, dt), 1))
    r = runs(c)
    return (r[:, 1] - r[:, 0]) * dt, c


def compute_hand_metrics(left: np.ndarray, right: np.ndarray,
                         left_contact: np.ndarray, right_contact: np.ndarray,
                         dt: float, cfg: HandConfig) -> dict:
    """All inputs are boolean arrays over the analysed frames; ``dt`` is seconds per sample."""
    left, right = np.asarray(left, bool), np.asarray(right, bool)
    either, both = left | right, left & right
    min_gap = max(_frames(cfg.min_loss_s, dt), 1)

    no_hand = runs(~either)
    longest_gap = float((no_hand[:, 1] - no_hand[:, 0]).max() * dt) if len(no_hand) else 0.0

    left_eps, left_mask = grasp_episodes(np.asarray(left_contact, bool) & left, dt, cfg)
    right_eps, right_mask = grasp_episodes(np.asarray(right_contact, bool) & right, dt, cfg)
    episodes = np.concatenate([left_eps, right_eps])

    def durations(e: np.ndarray) -> dict:
        if e.size == 0:
            return {"total_s": 0.0, "mean_s": None, "median_s": None, "max_s": None}
        return {"total_s": round(float(e.sum()), 2), "mean_s": round(float(e.mean()), 2),
                "median_s": round(float(np.median(e)), 2), "max_s": round(float(e.max()), 2)}

    return {
        "either_hand_pct": pct(either),
        "both_hands_pct": pct(both),
        "left_hand_pct": pct(left),
        "right_hand_pct": pct(right),
        "HOI_pct": pct(left_mask | right_mask),
        "tracking_losses": tracking_losses(either, min_gap),
        "untracked_pct": pct(~either),
        "grasp_count": int(episodes.size),
        "grasp_duration": durations(episodes),
        "longest_hand_gap": round(longest_gap, 2),
        "per_hand": {
            "left": {"tracking_losses": tracking_losses(left, min_gap), "grasp_count": int(left_eps.size),
                     "grasp_duration": durations(left_eps)},
            "right": {"tracking_losses": tracking_losses(right, min_gap), "grasp_count": int(right_eps.size),
                      "grasp_duration": durations(right_eps)},
        },
    }
