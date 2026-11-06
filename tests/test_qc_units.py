"""Unit tests for QC building blocks (no video, FFmpeg or MediaPipe needed)."""

import numpy as np
import pytest

from probing_qc.qc import image_metrics as im
from probing_qc.qc.config import HandConfig, QCConfig
from probing_qc.qc.hand_metrics import compute_hand_metrics, tracking_losses
from probing_qc.qc.hand_tracking import Hand, assign_sides
from probing_qc.qc.interaction import LandmarkGraspDetector, hand_shape
from probing_qc.qc.stats import drop_short, fill_gaps, pct, runs, summarize

B = np.array


# --- stats -------------------------------------------------------------------

def test_runs():
    np.testing.assert_array_equal(runs(B([0, 1, 1, 0, 1], bool)), [[1, 3], [4, 5]])
    assert runs(B([], bool)).shape == (0, 2)


def test_fill_gaps_only_interior():
    m = B([0, 1, 0, 0, 1, 0], bool)
    np.testing.assert_array_equal(fill_gaps(m, 2), [0, 1, 1, 1, 1, 0])
    np.testing.assert_array_equal(fill_gaps(m, 1), m)


def test_drop_short():
    np.testing.assert_array_equal(drop_short(B([1, 0, 1, 1, 1], bool), 2), [0, 0, 1, 1, 1])


def test_summarize_and_pct():
    s = summarize([1, 2, 3, np.nan])
    assert s["mean"] == 2 and s["min"] == 1 and s["max"] == 3
    assert summarize([])["mean"] is None
    assert pct([True, False, False, False]) == 25.0 and pct([]) == 0.0


# --- image metrics -----------------------------------------------------------

def test_luminance_and_sharpness():
    flat = np.full((64, 64), 100, np.uint8)
    noisy = np.random.default_rng(0).integers(0, 255, (64, 64), dtype=np.uint8)
    assert im.luminance(flat) == 100
    assert im.sharpness(flat) == 0
    assert im.sharpness(noisy) > im.sharpness(flat)


def test_blockiness_detects_8x8_grid():
    rng = np.random.default_rng(1)
    smooth = rng.normal(128, 2, (128, 128)).clip(0, 255).astype(np.uint8)
    blocks = np.kron(rng.integers(0, 255, (16, 16)), np.ones((8, 8))).astype(np.uint8)
    assert im.blockiness(smooth) == pytest.approx(1.0, abs=0.1)
    assert im.blockiness(blocks) > 5


def test_colour_cast():
    grey = np.full((32, 32, 3), 128, np.uint8)
    blue = grey.copy()
    blue[..., 2] = 220
    rng = np.random.default_rng(2)
    blue = (blue + rng.integers(-20, 20, blue.shape)).clip(0, 255).astype(np.uint8)
    offset, _, _ = im.colour_cast(grey)
    assert offset < 1
    offset, factor, hue = im.colour_cast(blue)
    assert offset > 10 and factor > 1.5 and 225 < hue < 315  # blue is around 270°


def test_resize_to_width_never_upscales():
    img = np.zeros((100, 200, 3), np.uint8)
    assert im.resize_to_width(img, 100).shape == (50, 100, 3)
    assert im.resize_to_width(img, 400).shape == img.shape


# --- hands -------------------------------------------------------------------

def make_hand(side: str, wrist_x: float, curl: float = 2.0, pinch: float = 1.0) -> Hand:
    """Synthetic hand with palm length 1 and chosen curl/pinch ratios."""
    world = np.zeros((21, 3), np.float32)
    world[9] = (0, 1, 0)                     # middle MCP: palm length 1
    for tip in (8, 12, 16, 20):
        world[tip] = (0, curl, 0)
    world[4] = (pinch, curl, 0)              # thumb tip offset from index tip
    lms = np.zeros((21, 3), np.float32)
    lms[0, 0] = wrist_x
    return Hand(side, 0.9, lms, world)


def test_assign_sides():
    assert assign_sides([]).left is None
    one = assign_sides([make_hand("right", 0.7)])
    assert one.right is not None and one.left is None
    # duplicate labels resolved by image position
    dup = assign_sides([make_hand("left", 0.8), make_hand("left", 0.2)])
    assert dup.left.landmarks[0, 0] == pytest.approx(0.2)
    assert dup.right.landmarks[0, 0] == pytest.approx(0.8) and dup.right.side == "right"


def test_hand_shape_and_grasp():
    assert hand_shape(make_hand("left", 0, curl=2.0, pinch=0.5).world_landmarks) == pytest.approx((2.0, 0.5))
    det = LandmarkGraspDetector(curl_ratio=1.3, pinch_ratio=0.35)
    assert not det.in_contact(make_hand("left", 0, curl=2.0, pinch=1.0))
    assert det.in_contact(make_hand("left", 0, curl=1.0, pinch=1.0))   # fist
    assert det.in_contact(make_hand("left", 0, curl=2.0, pinch=0.1))   # pinch


def test_tracking_losses_ignores_leading_and_short_gaps():
    present = B([0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 1], bool)
    assert tracking_losses(present, min_gap=1) == 2
    assert tracking_losses(present, min_gap=2) == 1


def test_compute_hand_metrics():
    dt = 0.1
    cfg = HandConfig(min_loss_s=0.2, grasp_merge_gap_s=0.1, grasp_min_duration_s=0.2)
    left = B([1, 1, 1, 1, 0, 0, 0, 1, 1, 1], bool)
    right = B([0, 0, 1, 1, 1, 1, 0, 0, 0, 0], bool)
    left_contact = B([1, 1, 0, 1, 0, 0, 0, 1, 0, 0], bool)  # one 1-frame gap bridged; last blip dropped
    right_contact = np.zeros(10, bool)
    m = compute_hand_metrics(left, right, left_contact, right_contact, dt, cfg)
    assert m["either_hand_pct"] == 90.0
    assert m["both_hands_pct"] == 20.0
    assert m["untracked_pct"] == 10.0
    assert m["longest_hand_gap"] == 0.1
    assert m["tracking_losses"] == 0          # the single no-hand frame is shorter than 0.2 s
    assert m["grasp_count"] == 1
    assert m["grasp_duration"]["total_s"] == pytest.approx(0.4)
    assert m["HOI_pct"] == 40.0
    assert m["per_hand"]["left"]["tracking_losses"] == 1


# --- config ------------------------------------------------------------------

def test_config_round_trip_and_validation():
    cfg = QCConfig.from_dict({"sampling": {"frame_stride": 2}, "hands": {"enabled": False}})
    assert cfg.sampling.frame_stride == 2 and not cfg.hands.enabled
    assert QCConfig.from_dict(cfg.to_dict()) == cfg
    with pytest.raises(KeyError):
        QCConfig.from_dict({"sampling": {"frame_strid": 2}})
