"""MediaPipe handedness on a real egocentric frame (needs mediapipe and the downloaded model).

``fixtures/egocentric_hands.jpg`` is a crop of head-mounted GoPro footage: the
wearer's left hand rests on the table on the left, the right hand holds a cutter
on the right. Regression for the label swap in reports before schema 1.2: the
pipeline flipped every non-mirrored frame, as the legacy MediaPipe API required,
and MediaPipe Tasks then named each hand after the other one.
"""

from pathlib import Path

import numpy as np
import pytest

from probing_qc.qc.config import HandConfig
from probing_qc.qc.models import HAND_MODEL_PATH, HAND_MODEL_SHA256, is_verified

cv2 = pytest.importorskip("cv2")
pytest.importorskip("mediapipe")
if not is_verified(HAND_MODEL_PATH, HAND_MODEL_SHA256):
    pytest.skip("hand model not downloaded yet (run probing-qc once)", allow_module_level=True)

from probing_qc.qc.hands.detector import HandDetector  # noqa: E402  (after the skips)

FRAME = Path(__file__).parent / "fixtures" / "egocentric_hands.jpg"


@pytest.fixture(scope="module")
def frame() -> np.ndarray:
    return cv2.cvtColor(cv2.imread(str(FRAME)), cv2.COLOR_BGR2RGB)


def detect(frame: np.ndarray, mirrored: bool):
    with HandDetector(HandConfig(mirrored_input=mirrored)) as det:
        return det.detect(frame, 0)


def test_egocentric_frame_labels_the_wearers_hands(frame):
    hands = detect(frame, mirrored=False)
    assert hands.left is not None and hands.right is not None
    assert hands.left.landmarks[0, 0] < 0.5 < hands.right.landmarks[0, 0]


def test_mirrored_footage_is_unmirrored_for_detection(frame):
    hands = detect(np.ascontiguousarray(frame[:, ::-1]), mirrored=True)
    assert hands.left is not None and hands.right is not None
    # same hands, reported in the mirrored frame's coordinates
    assert hands.left.landmarks[0, 0] > 0.5 > hands.right.landmarks[0, 0]
