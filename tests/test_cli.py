"""probing_qc.cli: argument handling and exit codes (no video needed)."""

import json

import pytest

from probing_qc.cli import download as dl_cli
from probing_qc.cli import extract as extract_cli
from probing_qc.cli import qc as qc_cli


def test_qc_dump_config(capsys):
    assert qc_cli.main(["--dump-config"]) == 0
    assert json.loads(capsys.readouterr().out)["sampling"]["frame_stride"] == 4


def test_qc_requires_video():
    assert qc_cli.main([]) == 2


def test_qc_missing_video(tmp_path):
    assert qc_cli.main(["nope.mp4", "--input-dir", str(tmp_path)]) == 1


def test_qc_invalid_flag_value(tmp_path):
    assert qc_cli.main(["x.mp4", "--stride", "0", "--input-dir", str(tmp_path)]) == 2


def test_qc_config_precedence(tmp_path):
    cfg_file = tmp_path / "cfg.json"
    cfg_file.write_text(json.dumps({"sampling": {"frame_stride": 2, "start_s": 5}}), encoding="utf-8")
    args = qc_cli.parse_args(["v.mp4", "--config", str(cfg_file), "--stride", "8", "--no-hands"])
    cfg = qc_cli.config_from_args(args)
    assert cfg.sampling.frame_stride == 8          # flag beats file
    assert cfg.sampling.start_s == 5               # file beats default
    assert not cfg.hands.enabled


def test_extract_missing_video(tmp_path):
    assert extract_cli.main(["nope.mp4", "--input-dir", str(tmp_path)]) == 1


@pytest.mark.parametrize("argv", [["--url", "ftp://x/v.mp4"], ["--url", "https://x.org/"]])
def test_download_rejects_bad_url_without_network(argv, tmp_path):
    assert dl_cli.main(argv + ["--input-dir", str(tmp_path)]) == 2
