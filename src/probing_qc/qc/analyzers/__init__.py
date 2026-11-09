"""Per-frame analyzers and the default registry."""

from __future__ import annotations

from ..config import QCConfig
from .base import FrameAnalyzer
from .hands import HandAnalyzer, hand_row
from .image import ImageQualityAnalyzer


def build_analyzers(cfg: QCConfig) -> list[FrameAnalyzer]:
    """The default analyzer set for ``cfg``: image quality always, hands if enabled."""
    analyzers: list[FrameAnalyzer] = [ImageQualityAnalyzer(cfg.image)]
    if cfg.hands.enabled:
        analyzers.append(HandAnalyzer(cfg.hands))
    return analyzers


__all__ = ["FrameAnalyzer", "HandAnalyzer", "ImageQualityAnalyzer", "build_analyzers", "hand_row"]
