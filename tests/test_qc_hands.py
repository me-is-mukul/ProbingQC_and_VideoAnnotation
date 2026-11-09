"""probing_qc.qc.hands: landmarks, interaction heuristic, hand metrics (no MediaPipe needed)."""

import math

import numpy as np
import pytest

from helpers import make_hand
from probing_qc.qc.config import HandConfig
from probing_qc.qc.hands.interaction import LandmarkGraspDetector, hand_shape
from probing_qc.qc.hands.landmarks import FrameHands, assign_sides, unmirror
from probing_qc.qc.hands.metrics import (
    compute_hand_metrics, duration_summary, grasp_episodes, longest_gap_s, seconds_to_frames,
    tracking_losses,
)

B = np.array

# --- landmarks ----------------------------------------------------------------


def test_assign_sides():
    assert assign_sides([]).left is None
    one = assign_sides([make_hand("right", 0.7)])
    assert one.right is not None and one.left is None
    # duplicate labels resolved by image position
    dup = assign_sides([make_hand("left", 0.8), make_hand("left", 0.2)])
    assert dup.left.landmarks[0, 0] == pytest.approx(0.2)
    assert dup.right.landmarks[0, 0] == pytest.approx(0.8) and dup.right.side == "right"


def test_assign_sides_trusts_distinct_labels_and_caps_at_two():
    # labels differ: kept even if positions disagree (hands crossed)
    crossed = assign_sides([make_hand("left", 0.9), make_hand("right", 0.1)])
    assert crossed.left.landmarks[0, 0] == pytest.approx(0.9)
    three = assign_sides([make_hand("left", 0.1), make_hand("right", 0.9), make_hand("left", 0.5)])
    assert len(list(three)) == 2


def test_frame_hands_iter():
    assert list(FrameHands()) == []
    assert [h.side for h in FrameHands(right=make_hand("right", 0.5))] == ["right"]


def test_unmirror_returns_flipped_copies():
    pts = np.array([[0.25, 0.5, 0.1]], np.float32)
    world = np.array([[0.01, 0.02, 0.03]], np.float32)
    p, w = unmirror(pts, world)
    np.testing.assert_allclose(p[0], [0.75, 0.5, 0.1])
    np.testing.assert_allclose(w[0], [-0.01, 0.02, 0.03])
    assert pts[0, 0] == pytest.approx(0.25)     # input untouched


# --- interaction --------------------------------------------------------------


def test_hand_shape_and_grasp():
    assert hand_shape(make_hand("left", 0, curl=2.0, pinch=0.5).world_landmarks) == pytest.approx((2.0, 0.5))
    det = LandmarkGraspDetector(curl_ratio=1.3, pinch_ratio=0.35)
    assert not det.in_contact(make_hand("left", 0, curl=2.0, pinch=1.0))
    assert det.in_contact(make_hand("left", 0, curl=1.0, pinch=1.0))   # fist
    assert det.in_contact(make_hand("left", 0, curl=2.0, pinch=0.1))   # pinch


def test_degenerate_hand_is_nan_and_not_in_contact():
    hand = make_hand("left", 0)
    hand.world_landmarks[:] = 0                  # palm length 0
    curl, pinch = hand_shape(hand.world_landmarks)
    assert math.isnan(curl) and math.isnan(pinch)
    assert not LandmarkGraspDetector().in_contact(hand)


# --- metrics ------------------------------------------------------------------


def test_seconds_to_frames():
    assert seconds_to_frames(0.5, 0.1) == 5
    assert seconds_to_frames(0.04, 0.1) == 0
    assert seconds_to_frames(-1, 0.1) == 0


def test_tracking_losses_ignores_leading_and_short_gaps():
    present = B([0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 1], bool)
    assert tracking_losses(present, min_gap=1) == 2
    assert tracking_losses(present, min_gap=2) == 1
    assert tracking_losses(B([1, 1, 0, 0], bool), min_gap=2) == 1   # trailing gap counts
    assert tracking_losses(B([0, 0, 0], bool), min_gap=1) == 0      # never tracked


def test_longest_gap():
    assert longest_gap_s(B([1, 0, 0, 1, 0], bool), 0.5) == 1.0
    assert longest_gap_s(B([1, 1], bool), 0.5) == 0.0


def test_grasp_episodes_cleaning():
    cfg = HandConfig(grasp_merge_gap_s=0.1, grasp_min_duration_s=0.2)
    eps, mask = grasp_episodes(B([1, 0, 1, 0, 0, 1], bool), 0.1, cfg)
    np.testing.assert_array_equal(mask, [1, 1, 1, 0, 0, 0])   # gap bridged, blip dropped
    np.testing.assert_allclose(eps, [0.3])


def test_duration_summary_empty():
    assert duration_summary(np.array([])) == {"total_s": 0.0, "mean_s": None,
                                              "median_s": None, "max_s": None}


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


def test_contact_without_presence_is_ignored():
    cfg = HandConfig(grasp_merge_gap_s=0, grasp_min_duration_s=0)
    absent = np.zeros(5, bool)
    m = compute_hand_metrics(absent, absent, np.ones(5, bool), np.ones(5, bool), 0.1, cfg)
    assert m["HOI_pct"] == 0.0 and m["grasp_count"] == 0 and m["untracked_pct"] == 100.0
