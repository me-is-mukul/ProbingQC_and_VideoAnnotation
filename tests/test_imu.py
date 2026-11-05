"""Unit tests on synthetic GPMF streams (no video or FFmpeg needed)."""

import struct

import numpy as np
import pytest

from probing_qc.gpmf import iter_klv
from probing_qc.imu import IMU_COLUMNS, extract_sensor, imu_dataframe, to_xyz


def klv(key: bytes, type_: str, size: int, repeat: int, payload: bytes) -> bytes:
    header = key + type_.encode("latin-1") + bytes([size]) + struct.pack(">H", repeat)
    return header + payload + b"\x00" * (-len(payload) % 4)


def nest(key: bytes, *children: bytes) -> bytes:
    body = b"".join(children)
    return klv(key, "\x00", 4, len(body) // 4, body)


def sensor_strm(key: bytes, stmp_us: int, scale: int, raw: np.ndarray, orin: bytes = b"ZXY") -> bytes:
    return nest(
        b"STRM",
        klv(b"STMP", "J", 8, 1, struct.pack(">Q", stmp_us)),
        klv(b"ORIN", "c", 1, len(orin), orin),
        klv(b"SCAL", "s", 2, 1, struct.pack(">h", scale)),
        klv(key, "s", 6, len(raw), raw.astype(">i2").tobytes()),
    )


def payload(stmp_us: int, acc_raw: np.ndarray, gyro_raw: np.ndarray) -> bytes:
    return nest(
        b"DEVC",
        klv(b"DVID", "L", 4, 1, struct.pack(">L", 1)),
        sensor_strm(b"ACCL", stmp_us, 100, acc_raw),
        sensor_strm(b"GYRO", stmp_us, 10, gyro_raw),
    )


@pytest.fixture
def stream() -> bytes:
    raw = np.arange(4 * 3).reshape(4, 3)
    return payload(0, raw, raw) + payload(1_000_000, raw + 100, raw + 100)


def test_iter_klv_skips_padding():
    data = klv(b"ABCD", "c", 1, 3, b"xyz") + b"\x00" * 8 + klv(b"EFGH", "c", 1, 1, b"q")
    assert [e.key for e in iter_klv(data)] == ["ABCD", "EFGH"]
    assert next(iter_klv(data)).text() == "xyz"


def test_iter_klv_rejects_truncated_entry():
    with pytest.raises(ValueError):
        list(iter_klv(klv(b"ABCD", "s", 2, 4, b"\x00" * 8)[:-4]))


def test_to_xyz_reorders_and_negates():
    zxy = np.array([[1.0, 2.0, 3.0]])  # z=1, x=2, y=3
    np.testing.assert_array_equal(to_xyz(zxy, "ZXY"), [[2.0, 3.0, 1.0]])
    np.testing.assert_array_equal(to_xyz(zxy, "zXy"), [[2.0, -3.0, -1.0]])


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


def test_imu_dataframe(stream):
    df = imu_dataframe(stream)
    assert list(df.columns) == IMU_COLUMNS
    assert len(df) == 8
    assert df["timestamp_s"].is_monotonic_increasing
    np.testing.assert_allclose(df.loc[0, ["gyro_x", "gyro_y", "gyro_z"]], [0.1, 0.2, 0.0])
