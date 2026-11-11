"""Hand analyzer: per-frame hand presence, shape and contact, summarised into hand metrics."""

from __future__ import annotations

from typing import Protocol

import numpy as np
import pandas as pd

from ..config import HandConfig
from ..frames import Frame
from ..hands.interaction import InteractionDetector, LandmarkGraspDetector, hand_shape
from ..hands.landmarks import SIDES, WRIST, FrameHands, palm_size
from ..hands.metrics import compute_hand_metrics
from .base import FrameAnalyzer


class Detector(Protocol):
    def detect(self, rgb: np.ndarray, timestamp_ms: int) -> FrameHands: ...
    def close(self) -> None: ...


def hand_row(hands: FrameHands, frame: Frame, interaction: InteractionDetector) -> dict:
    """Per-frame columns for both sides: presence, score, curl, pinch, contact, wrist, size.

    A missing hand gives ``False`` presence/contact and NaN for the numeric columns.
    Curl and pinch are recorded to calibrate the grasp thresholds; wrist position
    (normalised, 0-1) and ``size`` (``palm_size``) to tell the wearer's hands from
    other people's.
    """
    height, width = frame.rgb.shape[:2]
    row = {}
    for side in SIDES:
        hand = getattr(hands, side)
        curl, pinch = hand_shape(hand.world_landmarks) if hand else (np.nan, np.nan)
        row[side] = hand is not None
        row[f"{side}_score"] = hand.score if hand else np.nan
        row[f"{side}_curl"] = curl
        row[f"{side}_pinch"] = pinch
        row[f"{side}_contact"] = bool(hand and interaction.in_contact(hand, frame))
        row[f"{side}_wrist_x"] = float(hand.landmarks[WRIST, 0]) if hand else np.nan
        row[f"{side}_wrist_y"] = float(hand.landmarks[WRIST, 1]) if hand else np.nan
        row[f"{side}_size"] = palm_size(hand.landmarks, height / width) if hand else np.nan
    return row


class HandAnalyzer(FrameAnalyzer):
    name = "hands"
    section = "hands"

    def __init__(self, cfg: HandConfig | None = None, interaction: InteractionDetector | None = None,
                 detector: Detector | None = None):
        """``detector`` defaults to MediaPipe; pass a stub to test without a model."""
        self.cfg = cfg or HandConfig()
        if detector is None:
            from ..hands.detector import HandDetector  # lazy: MediaPipe is only needed here
            detector = HandDetector(self.cfg)
        self.detector = detector
        self.interaction = interaction or LandmarkGraspDetector(self.cfg.grasp_curl_ratio,
                                                                self.cfg.grasp_pinch_ratio)

    def process(self, frame: Frame) -> dict:
        hands = self.detector.detect(frame.rgb, int(round(frame.timestamp_s * 1000)))
        return hand_row(hands, frame, self.interaction)

    def summarize(self, frames: pd.DataFrame, dt: float) -> dict:
        return compute_hand_metrics(frames.left.to_numpy(), frames.right.to_numpy(),
                                    frames.left_contact.to_numpy(), frames.right_contact.to_numpy(),
                                    dt, self.cfg)

    def info(self) -> dict:
        info = {"interaction_detector": type(self.interaction).__name__,
                "hand_detector": type(self.detector).__name__}
        model_path = getattr(self.detector, "model_path", None)
        if model_path is not None:
            import mediapipe

            from ..models import sha256
            info.update({"mediapipe_version": mediapipe.__version__,
                         "hand_model": model_path.name,
                         "hand_model_sha256": sha256(model_path)})
        return info

    def close(self) -> None:
        self.detector.close()
