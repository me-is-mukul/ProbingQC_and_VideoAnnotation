"""Hand tracking and hand-object interaction.

    landmarks    Hand / FrameHands types, left-right resolution (pure)
    interaction  grasp/contact detection from landmarks (pure)
    metrics      per-frame flags -> report metrics (pure)
    detector     MediaPipe HandLandmarker wrapper (imported explicitly; needs mediapipe)
"""

from .interaction import InteractionDetector, LandmarkGraspDetector, hand_shape
from .landmarks import FrameHands, Hand, assign_sides
from .metrics import compute_hand_metrics, grasp_episodes, tracking_losses

__all__ = [
    "FrameHands", "Hand", "InteractionDetector", "LandmarkGraspDetector",
    "assign_sides", "compute_hand_metrics", "grasp_episodes", "hand_shape", "tracking_losses",
]
