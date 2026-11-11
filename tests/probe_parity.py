"""Golden data for the web UI's metric port (frontend/src/features/qc/probe/metrics.ts).

When lines are set on the charts, the browser recomputes the image and hand metrics for
the part of the video that is kept. Those numbers must match what Python would report for
the same frames, so this module writes a fixture of inputs (frame tables, keep-masks,
configs) together with the outputs of the real Python functions:

    python tests/probe_parity.py        # rewrite frontend/tests/fixtures/probe-parity.json

``tests/test_probe_parity.py`` recomputes the outputs from the stored inputs, so a change
to the Python metrics that is not mirrored in the fixture (and therefore in TypeScript)
fails the test. Inputs come from ``random.Random`` (its ``random()`` sequence is stable
across Python versions), not numpy's generators (not guaranteed stable across versions).
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

import numpy as np
import pandas as pd

from probing_qc.events import json_safe
from probing_qc.qc.analyzers.image import ImageQualityAnalyzer
from probing_qc.qc.config import HandConfig, ImageConfig
from probing_qc.qc.hands.metrics import compute_hand_metrics

FIXTURE = Path(__file__).resolve().parents[1] / "frontend" / "tests" / "fixtures" / "probe-parity.json"

IMAGE_KEYS = ("dark_luma", "bright_luma", "blur_sharpness", "cast_factor")
HAND_KEYS = ("min_loss_s", "grasp_merge_gap_s", "grasp_min_duration_s")


def _normal(rng: random.Random, mean: float, sd: float) -> float:
    u1, u2 = rng.random() or 1e-12, rng.random()
    return mean + sd * math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


def _runs(rng: random.Random, n: int, p_on: float, p_off: float) -> list[bool]:
    """Booleans with persistence (hands stay visible for a while), like real tracking."""
    out, state = [], rng.random() < 0.5
    for _ in range(n):
        if rng.random() < (p_off if state else p_on):
            state = not state
        out.append(state)
    return out


def make_table(n: int, seed: int, hands: bool = True) -> dict:
    """A frames table; ``hands=False`` never detects a hand (null HOI shares and laterality)."""
    rng = random.Random(seed)
    r4 = lambda x: round(x, 4)  # noqa: E731  (the frames CSV stores 4 decimals)
    lum = [r4(min(255.0, max(0.0, _normal(rng, 95, 55)))) for _ in range(n)]
    for i in (3, n // 2):
        lum[i] = None  # NaN handling in summarize()
    hue = [r4(rng.random() * 360) for _ in range(n)]
    hue[5] = None
    left = _runs(rng, n, 0.08, 0.05)
    right = _runs(rng, n, 0.06, 0.07)
    lc = [l and c for l, c in zip(left, _runs(rng, n, 0.2, 0.25))]
    rc = [r and c for r, c in zip(right, _runs(rng, n, 0.2, 0.25))]
    if not hands:
        left = right = lc = rc = [False] * n
    return {
        "luminance": lum,
        "sharpness": [r4(abs(_normal(rng, 160, 90))) for _ in range(n)],
        "blockiness": [r4(_normal(rng, 1.05, 0.03)) for _ in range(n)],
        "cast_offset": [r4(abs(_normal(rng, 4, 2.5))) for _ in range(n)],
        "cast_factor": [r4(abs(_normal(rng, 1.2, 0.6))) for _ in range(n)],
        "cast_hue_deg": hue,
        "left": left, "right": right, "left_contact": lc, "right_contact": rc,
    }


def make_masks(n: int, seed: int) -> dict[str, list[bool]]:
    rng = random.Random(seed)
    segments = [False] * n
    for a, b in ((0, n // 7), (n // 4, n // 2), (n - n // 9, n)):
        segments[a:b] = [True] * (b - a)
    return {
        "all": [True] * n,
        "segments": segments,
        "random": [rng.random() < 0.6 for _ in range(n)],
        "none": [False] * n,
    }


def make_inputs() -> dict:
    tables = {"t257": make_table(257, 11), "t1000": make_table(1000, 12),
              "t40_no_hands": make_table(40, 13, hands=False)}
    image_default = {k: getattr(ImageConfig(), k) for k in IMAGE_KEYS}
    hand_default = {k: getattr(HandConfig(), k) for k in HAND_KEYS}
    variants = [
        (4 / 29.97002997002997, image_default, hand_default),
        (1 / 59.94005994005994, {**image_default, "dark_luma": 60.0, "cast_factor": 1.0},
         {"min_loss_s": 0.2, "grasp_merge_gap_s": 0.1, "grasp_min_duration_s": 0.5}),
    ]
    cases = []
    for name, table in tables.items():
        n = len(table["luminance"])
        for mask_name, mask in make_masks(n, n).items():
            for i, (dt, image_cfg, hand_cfg) in enumerate(variants):
                cases.append({"name": f"{name}/{mask_name}/v{i}", "table": name, "mask": mask,
                              "dt": dt, "image_config": image_cfg, "hand_config": hand_cfg})
    return {"tables": tables, "cases": cases}


def _frame(table: dict) -> pd.DataFrame:
    df = pd.DataFrame({k: v for k, v in table.items()})
    for k in ("left", "right", "left_contact", "right_contact"):
        df[k] = df[k].astype(bool)
    for k in ("luminance", "sharpness", "blockiness", "cast_offset", "cast_factor", "cast_hue_deg"):
        df[k] = df[k].astype(np.float64)
    return df


def expected_for(case: dict, tables: dict) -> dict:
    """What the Python pipeline reports for the kept frames of one case."""
    df = _frame(tables[case["table"]])
    kept = df[np.asarray(case["mask"], bool)].reset_index(drop=True)
    image_cfg = ImageConfig(**case["image_config"])
    hand_cfg = HandConfig(**case["hand_config"])
    image = ImageQualityAnalyzer(image_cfg).summarize(kept, case["dt"])
    hands = compute_hand_metrics(kept.left.to_numpy(), kept.right.to_numpy(),
                                 kept.left_contact.to_numpy(), kept.right_contact.to_numpy(),
                                 case["dt"], hand_cfg)
    return json.loads(json.dumps(json_safe({"image": image, "hands": hands})))


def build_fixture() -> dict:
    inputs = make_inputs()
    for case in inputs["cases"]:
        case["expected"] = expected_for(case, inputs["tables"])
    return {"_comment": "Generated by tests/probe_parity.py. Do not edit by hand.", **inputs}


if __name__ == "__main__":
    data = json.loads(json.dumps(json_safe(build_fixture())))
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {FIXTURE} ({len(data['cases'])} cases)")

