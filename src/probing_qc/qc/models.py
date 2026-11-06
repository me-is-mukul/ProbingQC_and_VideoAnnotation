"""Pinned model files, downloaded on first use and verified by checksum."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

import requests

from ..paths import MODELS_DIR

log = logging.getLogger(__name__)

HAND_MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
                  "hand_landmarker/float16/1/hand_landmarker.task")
HAND_MODEL_SHA256 = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"
HAND_MODEL_PATH = MODELS_DIR / "hand_landmarker.task"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_hand_model(path: Path | None = None) -> Path:
    """Return a usable hand model path, downloading the pinned default if needed.

    A custom ``path`` is used as-is; only the default model is checksum-verified.
    """
    if path is not None:
        if not path.is_file():
            raise FileNotFoundError(f"Hand model not found: {path}")
        return path
    if HAND_MODEL_PATH.is_file() and sha256(HAND_MODEL_PATH) == HAND_MODEL_SHA256:
        return HAND_MODEL_PATH

    log.info("Downloading hand model to %s", HAND_MODEL_PATH)
    HAND_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    r = requests.get(HAND_MODEL_URL, timeout=120)
    r.raise_for_status()
    if hashlib.sha256(r.content).hexdigest() != HAND_MODEL_SHA256:
        raise RuntimeError("Downloaded hand model failed checksum verification")
    HAND_MODEL_PATH.write_bytes(r.content)
    return HAND_MODEL_PATH
