"""probing_qc.qc.stats: summaries and boolean run handling."""

import numpy as np
import pytest

from probing_qc.qc.stats import circular_mean_deg, drop_short, fill_gaps, pct, runs, summarize

B = np.array


def test_runs():
    np.testing.assert_array_equal(runs(B([0, 1, 1, 0, 1], bool)), [[1, 3], [4, 5]])
    np.testing.assert_array_equal(runs(B([1, 1, 1], bool)), [[0, 3]])
    assert runs(B([0, 0], bool)).shape == (0, 2)
    assert runs(B([], bool)).shape == (0, 2)


def test_fill_gaps_only_interior():
    m = B([0, 1, 0, 0, 1, 0], bool)
    np.testing.assert_array_equal(fill_gaps(m, 2), [0, 1, 1, 1, 1, 0])
    np.testing.assert_array_equal(fill_gaps(m, 1), m)
    np.testing.assert_array_equal(fill_gaps(m, 0), m)


def test_fill_gaps_does_not_mutate_input():
    m = B([1, 0, 1], bool)
    fill_gaps(m, 1)
    np.testing.assert_array_equal(m, [1, 0, 1])


def test_drop_short():
    np.testing.assert_array_equal(drop_short(B([1, 0, 1, 1, 1], bool), 2), [0, 0, 1, 1, 1])
    np.testing.assert_array_equal(drop_short(B([1, 1], bool), 0), [1, 1])


def test_summarize():
    s = summarize([1, 2, 3, np.nan])
    assert s["mean"] == 2 and s["min"] == 1 and s["max"] == 3 and s["p50"] == 2
    assert summarize([])["mean"] is None
    assert summarize([np.nan, np.nan])["p95"] is None
    assert summarize([1 / 3], decimals=2)["mean"] == 0.33


def test_pct():
    assert pct([True, False, False, False]) == 25.0
    assert pct([]) == 0.0
    assert pct([True] * 3) == 100.0


def test_circular_mean_deg():
    wrap = circular_mean_deg([350, 10])
    assert min(wrap, 360 - wrap) < 1e-6           # 0°, not the arithmetic 180°
    assert circular_mean_deg([0, 90]) == pytest.approx(45)
    assert circular_mean_deg([270]) == pytest.approx(270)
    assert 0 <= circular_mean_deg([-90]) < 360    # always normalised
    assert circular_mean_deg([]) is None
