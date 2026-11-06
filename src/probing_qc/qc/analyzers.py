"""Frame analyzers: the extension point for new per-frame QC metrics.

Each analyzer sees every sampled frame once (``process``) and returns a flat
dict of scalars; those rows form the per-frame table. After decoding,
``summarize`` turns the analyzer's columns into its part of the report.

To add a metric family: subclass ``FrameAnalyzer``, set ``name`` and
``section`` ("technical" or "hands", or a new section), and register it in
``build_analyzers``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import cv2
import numpy as np
import pandas as pd

from . import image_metrics as im
from .config import HandConfig, ImageConfig, QCConfig
from .frames import Frame
from .hand_metrics import compute_hand_metrics
from .interaction import InteractionDetector, LandmarkGraspDetector, hand_shape
from .stats import pct, summarize


class FrameAnalyzer(ABC):
    name: str
    section: str

    @abstractmethod
    def process(self, frame: Frame) -> dict:
        """Per-frame scalar measurements."""

    @abstractmethod
    def summarize(self, frames: pd.DataFrame, dt: float) -> dict:
        """Report entries from this analyzer's per-frame columns.

        ``dt`` is the time between analysed frames in seconds.
        """

    def info(self) -> dict:
        """Extra provenance for the report (model versions etc.)."""
        return {}

    def close(self) -> None:
        pass


class ImageQualityAnalyzer(FrameAnalyzer):
    name = "image"
    section = "technical"

    def __init__(self, cfg: ImageConfig):
        self.cfg = cfg

    def process(self, frame: Frame) -> dict:
        small = im.resize_to_width(frame.rgb, self.cfg.analysis_width)
        gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
        native_gray = cv2.cvtColor(frame.rgb, cv2.COLOR_RGB2GRAY)
        offset, factor, hue = im.colour_cast(small)
        return {
            "luminance": im.luminance(gray),
            "sharpness": im.sharpness(gray),
            "blockiness": im.blockiness(native_gray, self.cfg.block_size),
            "cast_offset": offset,
            "cast_factor": factor,
            "cast_hue_deg": hue,
        }

    def summarize(self, frames: pd.DataFrame, dt: float) -> dict:
        c = self.cfg
        cast = frames["cast_factor"] > c.cast_factor
        hues = np.radians(frames.loc[cast, "cast_hue_deg"])
        return {
            "luminance": {**summarize(frames.luminance),
                          "dark_frames_pct": pct(frames.luminance < c.dark_luma),
                          "bright_frames_pct": pct(frames.luminance > c.bright_luma)},
            "sharpness": {**summarize(frames.sharpness),
                          "blurry_frames_pct": pct(frames.sharpness < c.blur_sharpness)},
            "blockiness": summarize(frames.blockiness),
            "colour_cast": {
                "offset": summarize(frames.cast_offset),
                "factor": summarize(frames.cast_factor),
                "cast_frames_pct": pct(cast),
                # circular mean of the hue over frames that show a cast
                "cast_hue_deg": (round(float(np.degrees(np.arctan2(np.sin(hues).mean(),
                                                                   np.cos(hues).mean())) % 360), 1)
                                 if len(hues) else None),
            },
        }


class HandAnalyzer(FrameAnalyzer):
    name = "hands"
    section = "hands"

    def __init__(self, cfg: HandConfig, interaction: InteractionDetector | None = None):
        from .hand_tracking import HandDetector  # lazy: MediaPipe is only needed here

        self.cfg = cfg
        self.detector = HandDetector(cfg)
        self.interaction = interaction or LandmarkGraspDetector(cfg.grasp_curl_ratio,
                                                                cfg.grasp_pinch_ratio)

    def process(self, frame: Frame) -> dict:
        hands = self.detector.detect(frame.rgb, int(round(frame.timestamp_s * 1000)))
        row = {}
        for side in ("left", "right"):
            hand = getattr(hands, side)
            curl, pinch = hand_shape(hand.world_landmarks) if hand else (np.nan, np.nan)
            row[side] = hand is not None
            row[f"{side}_score"] = hand.score if hand else np.nan
            row[f"{side}_curl"] = curl    # recorded for threshold calibration
            row[f"{side}_pinch"] = pinch
            row[f"{side}_contact"] = bool(hand and self.interaction.in_contact(hand, frame))
        return row

    def summarize(self, frames: pd.DataFrame, dt: float) -> dict:
        return compute_hand_metrics(frames.left.to_numpy(), frames.right.to_numpy(),
                                    frames.left_contact.to_numpy(), frames.right_contact.to_numpy(),
                                    dt, self.cfg)

    def info(self) -> dict:
        from .models import sha256
        import mediapipe

        return {"mediapipe_version": mediapipe.__version__,
                "hand_model": self.detector.model_path.name,
                "hand_model_sha256": sha256(self.detector.model_path),
                "interaction_detector": type(self.interaction).__name__}

    def close(self) -> None:
        self.detector.close()


def build_analyzers(cfg: QCConfig) -> list[FrameAnalyzer]:
    analyzers: list[FrameAnalyzer] = [ImageQualityAnalyzer(cfg.image)]
    if cfg.hands.enabled:
        analyzers.append(HandAnalyzer(cfg.hands))
    return analyzers
