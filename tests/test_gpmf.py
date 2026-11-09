"""probing_qc.imu.gpmf: KLV parsing."""

import struct

import numpy as np
import pytest

from helpers import klv, nest
from probing_qc.imu.gpmf import KLV, iter_klv


def test_iter_klv_skips_padding():
    data = klv(b"ABCD", "c", 1, 3, b"xyz") + b"\x00" * 8 + klv(b"EFGH", "c", 1, 1, b"q")
    assert [e.key for e in iter_klv(data)] == ["ABCD", "EFGH"]
    assert next(iter_klv(data)).text() == "xyz"


def test_iter_klv_rejects_truncated_entry():
    with pytest.raises(ValueError):
        list(iter_klv(klv(b"ABCD", "s", 2, 4, b"\x00" * 8)[:-4]))


def test_iter_klv_empty_and_short_buffers():
    assert list(iter_klv(b"")) == []
    assert list(iter_klv(b"ABC")) == []  # shorter than a header: ignored


def test_nested_children():
    data = nest(b"DEVC", klv(b"DVID", "L", 4, 1, struct.pack(">L", 7)))
    devc = next(iter_klv(data))
    assert devc.is_nested
    child = next(devc.children())
    assert child.key == "DVID" and child.values()[0, 0] == 7


def test_values_big_endian_and_shape():
    entry = KLV("ACCL", "s", 6, 2, struct.pack(">6h", 1, -2, 3, 4, 5, -6))
    np.testing.assert_array_equal(entry.values(), [[1, -2, 3], [4, 5, -6]])


def test_zero_repeat_entry():
    entry = next(iter_klv(klv(b"ACCL", "s", 6, 0, b"")))
    assert entry.repeat == 0 and entry.values().shape == (0, 3)


def test_unknown_type_raises():
    with pytest.raises(KeyError):
        KLV("XXXX", "?", 4, 1, b"\x00" * 4).values()
