"""probing_qc.qc.image_metrics: pure per-frame image measures."""

import math

import numpy as np
import pytest

from probing_qc.qc import image_metrics as im


def test_luminance_and_sharpness():
    flat = np.full((64, 64), 100, np.uint8)
    noisy = np.random.default_rng(0).integers(0, 255, (64, 64), dtype=np.uint8)
    assert im.luminance(flat) == 100
    assert im.luminance(np.zeros((4, 4), np.uint8)) == 0
    assert im.sharpness(flat) == 0
    assert im.sharpness(noisy) > im.sharpness(flat)


def test_blockiness_detects_8x8_grid():
    rng = np.random.default_rng(1)
    smooth = rng.normal(128, 2, (128, 128)).clip(0, 255).astype(np.uint8)
    blocks = np.kron(rng.integers(0, 255, (16, 16)), np.ones((8, 8))).astype(np.uint8)
    assert im.blockiness(smooth) == pytest.approx(1.0, abs=0.1)
    assert im.blockiness(blocks) > 5


def test_blockiness_flat_image_and_tiny_image():
    assert im.blockiness(np.full((32, 32), 50, np.uint8)) == 1.0   # floored at 1 luma level
    assert math.isnan(im.blockiness(np.zeros((8, 8), np.uint8)))   # no block boundary


def test_colour_cast():
    grey = np.full((32, 32, 3), 128, np.uint8)
    blue = grey.copy()
    blue[..., 2] = 220
    rng = np.random.default_rng(2)
    blue = (blue + rng.integers(-20, 20, blue.shape)).clip(0, 255).astype(np.uint8)
    offset, factor, _ = im.colour_cast(grey)
    assert offset < 1 and factor == 0.0          # no spread -> factor defined as 0
    offset, factor, hue = im.colour_cast(blue)
    assert offset > 10 and factor > 1.5 and 225 < hue < 315  # blue is around 270°


def test_resize_to_width_never_upscales():
    img = np.zeros((100, 200, 3), np.uint8)
    assert im.resize_to_width(img, 100).shape == (50, 100, 3)
    assert im.resize_to_width(img, 200) is img
    assert im.resize_to_width(img, 400).shape == img.shape
