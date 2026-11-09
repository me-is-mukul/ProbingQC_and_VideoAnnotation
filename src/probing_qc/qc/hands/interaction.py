"""Hand-object interaction (HOI) detection.

``InteractionDetector`` is the extension point: implement ``in_contact`` with a
learned contact model (e.g. 100DOH hand-object detector, EgoHOS) and pass it to
``HandAnalyzer``. The default ``LandmarkGraspDetector`` is a landmark-only
heuristic: it flags a closed hand or a thumb-index pinch as a grasp. It cannot
see objects, so a fist with nothing in it also counts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

import numpy as np

from .landmarks import FINGERTIPS, INDEX_TIP, MIDDLE_MCP, THUMB_TIP, WRIST, Hand

if TYPE_CHECKING:
    from ..frames import Frame


class InteractionDetector(Protocol):
    def in_contact(self, hand: Hand, frame: "Frame") -> bool: ...


def hand_shape(world: np.ndarray) -> tuple[float, float]:
    """(curl, pinch) ratios normalised by palm length (wrist to middle-finger MCP).

    curl: mean fingertip-to-wrist distance / palm, ~2 for an open hand, ~1 for a fist.
    pinch: thumb-tip-to-index-tip distance / palm.
    Both are NaN when the palm length is zero (degenerate landmarks).
    """
    palm = float(np.linalg.norm(world[MIDDLE_MCP] - world[WRIST]))
    if palm <= 0:
        return float("nan"), float("nan")
    curl = float(np.linalg.norm(world[list(FINGERTIPS)] - world[WRIST], axis=1).mean()) / palm
    pinch = float(np.linalg.norm(world[THUMB_TIP] - world[INDEX_TIP])) / palm
    return curl, pinch


@dataclass
class LandmarkGraspDetector:
    curl_ratio: float = 1.3
    pinch_ratio: float = 0.35

    def in_contact(self, hand: Hand, frame: "Frame | None" = None) -> bool:
        curl, pinch = hand_shape(hand.world_landmarks)
        return curl < self.curl_ratio or pinch < self.pinch_ratio  # NaN compares False
