"""Hand landmark data types and left/right resolution (no MediaPipe needed).

Landmark indices follow MediaPipe's 21-point hand model:
https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

NUM_LANDMARKS = 21
WRIST, THUMB_TIP, INDEX_TIP, MIDDLE_MCP = 0, 4, 8, 9
FINGERTIPS = (8, 12, 16, 20)
SIDES = ("left", "right")


@dataclass(frozen=True)
class Hand:
    side: str                    # "left" or "right" (the wearer's hand)
    score: float                 # handedness confidence
    landmarks: np.ndarray        # (21, 3) x, y normalised to the original frame; z relative depth
    world_landmarks: np.ndarray  # (21, 3) metres, origin at the hand's centre


@dataclass(frozen=True)
class FrameHands:
    left: Hand | None = None
    right: Hand | None = None

    def __iter__(self):
        return (h for h in (self.left, self.right) if h is not None)


def relabel(hand: Hand, side: str) -> Hand:
    return hand if hand.side == side else Hand(side, hand.score, hand.landmarks, hand.world_landmarks)


def assign_sides(hands: list[Hand]) -> FrameHands:
    """Resolve detections to at most one left and one right hand.

    Labels are trusted when they differ. When two hands share a label, the one
    further left in the image is taken as the left hand. Detections beyond the
    first two are ignored.
    """
    if not hands:
        return FrameHands()
    if len(hands) == 1:
        h = hands[0]
        return FrameHands(**{h.side: h})
    a, b = sorted(hands[:2], key=lambda h: h.landmarks[WRIST, 0])
    if a.side != b.side:
        return FrameHands(**{a.side: a, b.side: b})
    return FrameHands(left=relabel(a, "left"), right=relabel(b, "right"))


def unmirror(landmarks: np.ndarray, world_landmarks: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Undo a horizontal image flip: normalised x -> 1 - x, world x -> -x. Returns copies."""
    pts, wpts = landmarks.copy(), world_landmarks.copy()
    pts[:, 0] = 1.0 - pts[:, 0]
    wpts[:, 0] = -wpts[:, 0]
    return pts, wpts
