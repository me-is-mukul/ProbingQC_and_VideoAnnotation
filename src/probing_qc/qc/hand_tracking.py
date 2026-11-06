"""MediaPipe hand landmark detection with egocentric left/right handling.

MediaPipe assumes a mirrored (selfie) image when labelling handedness. For
head-mounted footage the frame is flipped before detection so the labels refer
to the wearer's hands, and coordinates are flipped back afterwards.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .config import HandConfig
from .image_metrics import resize_to_width
from .models import ensure_hand_model

WRIST, THUMB_TIP, INDEX_TIP, MIDDLE_MCP = 0, 4, 8, 9
FINGERTIPS = (8, 12, 16, 20)


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


def assign_sides(hands: list[Hand]) -> FrameHands:
    """Resolve detections to at most one left and one right hand.

    Labels are trusted when they differ. When two hands share a label, the one
    further left in the image is taken as the left hand.
    """
    if not hands:
        return FrameHands()
    if len(hands) == 1:
        h = hands[0]
        return FrameHands(**{h.side: h})
    a, b = sorted(hands[:2], key=lambda h: h.landmarks[WRIST, 0])
    if a.side != b.side:
        return FrameHands(**{a.side: a, b.side: b})
    return FrameHands(left=_relabel(a, "left"), right=_relabel(b, "right"))


def _relabel(hand: Hand, side: str) -> Hand:
    return hand if hand.side == side else Hand(side, hand.score, hand.landmarks, hand.world_landmarks)


class HandDetector:
    """Stateful (video-mode) detector; feed frames in timestamp order."""

    def __init__(self, cfg: HandConfig):
        os.environ.setdefault("GLOG_minloglevel", "2")  # silence MediaPipe/TFLite chatter
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        self._mp = mp
        self.cfg = cfg
        self.model_path = ensure_hand_model(Path(cfg.model_path) if cfg.model_path else None)
        options = vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(self.model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=cfg.num_hands,
            min_hand_detection_confidence=cfg.min_detection_confidence,
            min_hand_presence_confidence=cfg.min_presence_confidence,
            min_tracking_confidence=cfg.min_tracking_confidence,
        )
        self._landmarker = vision.HandLandmarker.create_from_options(options)

    def detect(self, rgb: np.ndarray, timestamp_ms: int) -> FrameHands:
        img = resize_to_width(rgb, self.cfg.input_width)
        flip = not self.cfg.mirrored_input
        if flip:
            img = img[:, ::-1]
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(img))
        result = self._landmarker.detect_for_video(image, timestamp_ms)

        hands = []
        for handedness, lms, world in zip(result.handedness, result.hand_landmarks,
                                          result.hand_world_landmarks):
            pts = np.array([(p.x, p.y, p.z) for p in lms], dtype=np.float32)
            wpts = np.array([(p.x, p.y, p.z) for p in world], dtype=np.float32)
            if flip:
                pts[:, 0] = 1.0 - pts[:, 0]
                wpts[:, 0] = -wpts[:, 0]
            cat = handedness[0]
            hands.append(Hand(cat.category_name.lower(), float(cat.score), pts, wpts))
        return assign_sides(hands)

    def close(self) -> None:
        self._landmarker.close()

    def __enter__(self) -> "HandDetector":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
