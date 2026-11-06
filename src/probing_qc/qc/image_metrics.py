"""Per-frame image quality measures. Pure functions on numpy arrays."""

from __future__ import annotations

import cv2
import numpy as np


def resize_to_width(img: np.ndarray, width: int) -> np.ndarray:
    h, w = img.shape[:2]
    if w <= width:
        return img
    return cv2.resize(img, (width, round(h * width / w)), interpolation=cv2.INTER_AREA)


def luminance(gray: np.ndarray) -> float:
    """Mean luma, 0 (black) to 255 (white)."""
    return float(gray.mean())


def sharpness(gray: np.ndarray) -> float:
    """Variance of the Laplacian; low values indicate blur or defocus.

    Resolution-dependent, so always compute it at a fixed analysis width.
    """
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def blockiness(gray: np.ndarray, block: int = 8) -> float:
    """Ratio of luma steps across block boundaries to steps inside blocks.

    About 1.0 means no visible block grid; values well above 1 indicate
    compression blocking. Compute at native resolution so the grid aligns.
    """
    ratios = []
    # Mean absolute step per column boundary (horizontal) and per row boundary (vertical).
    h_steps = cv2.reduce(cv2.absdiff(gray[:, 1:], gray[:, :-1]), 0, cv2.REDUCE_AVG, dtype=cv2.CV_32F).ravel()
    v_steps = cv2.reduce(cv2.absdiff(gray[1:, :], gray[:-1, :]), 1, cv2.REDUCE_AVG, dtype=cv2.CV_32F).ravel()
    for steps in (h_steps, v_steps):
        on_grid = np.zeros(steps.size, dtype=bool)
        on_grid[block - 1::block] = True
        # Floor at one luma level: flat block interiors would otherwise divide by ~0.
        inner = max(float(steps[~on_grid].mean()), 1.0)
        ratios.append(max(float(steps[on_grid].mean()), 1.0) / inner)
    return float(np.mean(ratios))


def colour_cast(rgb: np.ndarray) -> tuple[float, float, float]:
    """Colour cast in CIELAB as (offset D, factor K, hue in degrees).

    D is the distance of the mean chroma (a*, b*) from neutral grey. K = D / M,
    where M is the chroma spread; K > ~1.5 suggests a global cast rather than
    colourful content. The hue gives its direction (0 = red, 90 = yellow,
    180 = green, 270 = blue).
    """
    lab = cv2.cvtColor(rgb[::2, ::2], cv2.COLOR_RGB2LAB).astype(np.float32)  # 1/4 pixels is plenty
    a, b = lab[..., 1] - 128.0, lab[..., 2] - 128.0
    da, db = float(a.mean()), float(b.mean())
    offset = float(np.hypot(da, db))
    spread = float(np.hypot(np.abs(a - da).mean(), np.abs(b - db).mean()))
    factor = offset / spread if spread > 0 else 0.0
    hue = float(np.degrees(np.arctan2(db, da)) % 360)
    return offset, factor, hue
