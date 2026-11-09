"""probing_qc.imu.sensor: scaling, axis order, timestamps, sensor extraction."""

import numpy as np
import pytest

from helpers import nest, sensor_strm
from probing_qc.imu.sensor import (
    DEFAULT_PAYLOAD_SECONDS, apply_scale, extract_sensor, payload_timestamps, to_xyz,
)


def test_to_xyz_reorders_and_negates():
    zxy = np.array([[1.0, 2.0, 3.0]])  # z=1, x=2, y=3
    np.testing.assert_array_equal(to_xyz(zxy, "ZXY"), [[2.0, 3.0, 1.0]])
    np.testing.assert_array_equal(to_xyz(zxy, "zXy"), [[2.0, -3.0, -1.0]])
    np.testing.assert_array_equal(to_xyz(zxy, "XYZ"), zxy)


@pytest.mark.parametrize("bad", ["XY", "XXY", "ABC", "XYZW", ""])
def test_to_xyz_rejects_invalid_orientation(bad):
    with pytest.raises(ValueError):
        to_xyz(np.zeros((1, 3)), bad)


def test_apply_scale_single_and_per_channel():
    raw = np.array([[10, 20, 30]])
    np.testing.assert_allclose(apply_scale(raw, None), raw)
    np.testing.assert_allclose(apply_scale(raw, np.array([[10]])), [[1, 2, 3]])
    np.testing.assert_allclose(apply_scale(raw, np.array([[10, 20, 30]])), [[1, 1, 1]])


def test_payload_timestamps_even_spacing():
    t = payload_timestamps([4, 4], [0.0, 1.0])
    np.testing.assert_allclose(t, np.arange(8) * 0.25)


def test_payload_timestamps_last_payload_uses_mean_period():
    t = payload_timestamps([2, 2, 4], [0.0, 1.0, 2.0])  # period 0.5 s
    np.testing.assert_allclose(t[-4:], [2.0, 2.5, 3.0, 3.5])


def test_payload_timestamps_single_and_empty():
    np.testing.assert_allclose(payload_timestamps([4], [5.0]),
                               5.0 + np.arange(4) * DEFAULT_PAYLOAD_SECONDS / 4)
    assert payload_timestamps([], []).size == 0
    with pytest.raises(ValueError):
        payload_timestamps([1, 2], [0.0])


def test_extract_sensor_scales_and_times(stream):
    acc = extract_sensor(stream, "ACCL")
    assert acc.num_samples == 8
    assert acc.orientation == "ZXY"
    # raw row 0 is (z, x, y) = (0, 1, 2) / 100
    np.testing.assert_allclose(acc.samples()[0], [0.01, 0.02, 0.0])
    np.testing.assert_allclose(acc.timestamps(), np.arange(8) * 0.25)


def test_extract_sensor_missing_key(stream):
    with pytest.raises(ValueError):
        extract_sensor(stream, "GPS5")


def test_extract_sensor_without_stmp_or_orin(caplog):
    raw = np.zeros((2, 3))
    data = (nest(b"DEVC", sensor_strm(b"ACCL", None, 1, raw, orin=None))
            + nest(b"DEVC", sensor_strm(b"ACCL", None, 1, raw, orin=None)))
    acc = extract_sensor(data, "ACCL")
    assert acc.orientation is None                       # falls back to DEFAULT_ORIENTATION
    np.testing.assert_allclose(acc.timestamps(), [0, 0.5, 1.0, 1.5])
    assert "no STMP" in caplog.text


def test_extract_sensor_ignores_non_devc_top_level(stream):
    junk = nest(b"JUNK", sensor_strm(b"ACCL", 0, 1, np.ones((3, 3))))
    assert extract_sensor(junk + stream, "ACCL").num_samples == 8
