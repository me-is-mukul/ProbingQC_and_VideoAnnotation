"""The browser's metric port is checked against this fixture; keep it in sync with Python.

If this fails after a deliberate change to the image or hand metrics, regenerate the
fixture (``python tests/probe_parity.py``), then make the TypeScript port in
``frontend/src/features/qc/probe/metrics.ts`` pass ``npm test`` again.
"""

import json

import pytest

from probe_parity import FIXTURE, expected_for

DATA = json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["name"] for c in DATA["cases"]])
def test_fixture_matches_python(case):
    assert expected_for(case, DATA["tables"]) == case["expected"]


def test_fixture_covers_edge_cases():
    names = {c["name"].split("/")[1] for c in DATA["cases"]}
    assert names == {"all", "segments", "random", "none"}
    sizes = {len(t["luminance"]) for t in DATA["tables"].values()}
    assert any(n > 128 for n in sizes) and any(n % 8 for n in sizes)  # pairwise-sum paths
