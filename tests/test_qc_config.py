"""probing_qc.qc.config: defaults, overrides, validation, JSON round trip."""

import json

import pytest

from probing_qc.qc.config import QCConfig


def test_defaults_are_valid():
    assert QCConfig().validate() == QCConfig()


def test_round_trip_and_partial_override():
    cfg = QCConfig.from_dict({"sampling": {"frame_stride": 2}, "hands": {"enabled": False}})
    assert cfg.sampling.frame_stride == 2 and not cfg.hands.enabled
    assert cfg.image == QCConfig().image                 # untouched sections keep defaults
    assert QCConfig.from_dict(cfg.to_dict()) == cfg


def test_from_file(tmp_path):
    path = tmp_path / "cfg.json"
    path.write_text(json.dumps({"image": {"dark_luma": 30}}), encoding="utf-8")
    assert QCConfig.from_file(path).image.dark_luma == 30


def test_unknown_and_malformed_fields():
    with pytest.raises(KeyError):
        QCConfig.from_dict({"sampling": {"frame_strid": 2}})
    with pytest.raises(KeyError):
        QCConfig.from_dict({"nonsense": 1})
    with pytest.raises(TypeError):
        QCConfig.from_dict({"sampling": 5})


@pytest.mark.parametrize("patch", [
    {"sampling": {"frame_stride": 0}},
    {"sampling": {"frame_stride": 1.5}},
    {"sampling": {"frame_stride": True}},
    {"sampling": {"start_s": -1}},
    {"sampling": {"max_seconds": 0}},
    {"image": {"dark_luma": 220}},                     # dark >= bright
    {"image": {"block_size": 1}},
    {"hands": {"min_detection_confidence": 1.5}},
    {"hands": {"min_loss_s": -0.1}},
    {"orientation": {"window_s": 0}},
    {"max_error_messages": -1},
])
def test_validation_rejects(patch):
    with pytest.raises(ValueError):
        QCConfig.from_dict(patch)


def test_override_ignores_none():
    cfg = QCConfig().override("sampling", frame_stride=8, start_s=None)
    assert cfg.sampling.frame_stride == 8 and cfg.sampling.start_s == 0.0
