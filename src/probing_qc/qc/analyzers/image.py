"""Image quality analyzer: luminance, sharpness, blockiness, colour cast."""

from __future__ import annotations

import cv2
import pandas as pd

from .. import image_metrics as im
from ..config import ImageConfig
from ..frames import Frame
from ..stats import circular_mean_deg, pct, summarize
from .base import FrameAnalyzer

COLUMNS = ("luminance", "sharpness", "blockiness", "cast_offset", "cast_factor", "cast_hue_deg")


class ImageQualityAnalyzer(FrameAnalyzer):
    name = "image"
    section = "technical"

    def __init__(self, cfg: ImageConfig | None = None):
        self.cfg = cfg or ImageConfig()

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
        hue = circular_mean_deg(frames.loc[cast, "cast_hue_deg"])  # over frames that show a cast
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
                "cast_hue_deg": round(hue, 1) if hue is not None else None,
            },
        }
