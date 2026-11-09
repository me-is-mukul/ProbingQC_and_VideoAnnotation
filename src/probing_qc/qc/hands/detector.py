"""MediaPipe hand landmark detection with egocentric left/right handling.

MediaPipe assumes a mirrored (selfie) image when labelling handedness. For
head-mounted footage the frame is flipped before detection so the labels refer
to the wearer's hands, and coordinates are flipped back afterwards.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np

from ..config import HandConfig
from ..image_metrics import resize_to_width
from ..models import ensure_hand_model
from .landmarks import FrameHands, Hand, assign_sides, unmirror


class HandDetector:
    """Stateful (video-mode) detector; feed frames in increasing timestamp order."""

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
                pts, wpts = unmirror(pts, wpts)
            cat = handedness[0]
            hands.append(Hand(cat.category_name.lower(), float(cat.score), pts, wpts))
        return assign_sides(hands)

    def close(self) -> None:
        self._landmarker.close()

    def __enter__(self) -> "HandDetector":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
