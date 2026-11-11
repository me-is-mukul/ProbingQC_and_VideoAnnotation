"""Hand-object interaction (HOI) metrics from per-hand presence and cleaned contact masks.

Inputs are boolean arrays over the analysed frames: each hand's presence and its
contact mask after cleaning (``metrics.grasp_episodes``). Every number comes from
the per-frame table alone, so the web UI recomputes them for a probed (cut)
video. Keep the arithmetic in step with ``frontend/src/features/qc/probe/metrics.ts``:
``tests/probe_parity.py`` generates the fixture both sides are tested against.
"""

from __future__ import annotations

import numpy as np

from ..stats import longest_run, pct


def share_pct(part, whole) -> float | None:
    """``100 * count(part) / count(whole)``, 2 decimals; ``None`` when ``whole`` is all False."""
    p, w = int(np.count_nonzero(part)), int(np.count_nonzero(whole))
    return round(100.0 * p / w, 2) if w else None


def laterality_index(left_contact, right_contact) -> float | None:
    """``(R - L) / (R + L)`` over contact frames, 3 decimals.

    +1 means only the right hand interacts, -1 only the left, 0 both equally.
    ``None`` when neither hand is ever in contact.
    """
    left, right = int(np.count_nonzero(left_contact)), int(np.count_nonzero(right_contact))
    return round((right - left) / (right + left), 3) if right + left else None


def per_minute(count: int, frames: int, dt: float) -> float | None:
    """Events per minute of analysed time (``frames * dt`` seconds); ``None`` for no time."""
    seconds = frames * dt
    return round(60.0 * count / seconds, 2) if seconds > 0 else None


def hoi_metrics(left, right, left_contact, right_contact, grasps: int, dt: float) -> dict:
    """The report's ``hands.hoi`` block.

    ``left``/``right``: hand detected; ``*_contact``: cleaned contact masks;
    ``grasps``: contact episodes of both hands; ``dt``: seconds per analysed frame.
    """
    left, right = np.asarray(left, bool), np.asarray(right, bool)
    left_contact, right_contact = np.asarray(left_contact, bool), np.asarray(right_contact, bool)
    either = left | right
    contact = left_contact | right_contact

    def per_hand(present: np.ndarray, mask: np.ndarray) -> dict:
        return {"contact_pct": pct(mask), "contact_while_visible_pct": share_pct(mask & present, present)}

    return {
        "bimanual_pct": pct(left_contact & right_contact),
        "idle_hands_pct": pct(either & ~contact),
        "contact_while_visible_pct": share_pct(either & contact, either),
        "grasps_per_min": per_minute(grasps, either.size, dt),
        "longest_no_contact_s": round(longest_run(~contact) * dt, 2),
        "laterality_index": laterality_index(left_contact, right_contact),
        "per_hand": {"left": per_hand(left, left_contact), "right": per_hand(right, right_contact)},
    }
