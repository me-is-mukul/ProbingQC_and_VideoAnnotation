"""Hand tracking and hand-object interaction.

    landmarks    Hand / FrameHands types, left-right resolution, palm size (pure)
    interaction  grasp/contact detection from landmarks (pure)
    metrics      per-frame flags -> report metrics (pure)
    hoi          hand-object interaction breakdown for the report (pure)
    detector     MediaPipe HandLandmarker wrapper (imported explicitly; needs mediapipe)
"""

from .hoi import hoi_metrics
from .interaction import InteractionDetector, LandmarkGraspDetector, hand_shape
from .landmarks import FrameHands, Hand, assign_sides, palm_size
from .metrics import compute_hand_metrics, grasp_episodes, tracking_losses

__all__ = [
    "FrameHands", "Hand", "InteractionDetector", "LandmarkGraspDetector",
    "assign_sides", "compute_hand_metrics", "grasp_episodes", "hand_shape", "hoi_metrics",
    "palm_size", "tracking_losses",
]
