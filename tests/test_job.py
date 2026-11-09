"""probing_qc.job and probing_qc.cli.job: stage plumbing (unit) and a full run (integration)."""

import io
import json

import pytest

from probing_qc.cli import job as job_cli
from probing_qc.events import EventEmitter
from probing_qc.job import (
    RESULTS_FILE, RESULTS_SCHEMA_VERSION, JobOptions, JobPaths, StageError, human_bytes, ordinal, run_job, stage,
)


def events(buf: io.StringIO) -> list[dict]:
    return [json.loads(line) for line in buf.getvalue().splitlines()]


# --- unit ---------------------------------------------------------------------


def test_job_options_to_config():
    cfg = JobOptions(frame_stride=8, max_seconds=5, hands=False).qc_config()
    assert cfg.sampling.frame_stride == 8 and cfg.sampling.max_seconds == 5 and not cfg.hands.enabled
    with pytest.raises(ValueError):
        JobOptions(frame_stride=0).qc_config()
    assert JobOptions().to_dict()["config_path"] is None


def test_job_paths(tmp_path):
    p = JobPaths(tmp_path / "j")
    assert p.out_dir == tmp_path / "j" / "outputs" and p.results.name == RESULTS_FILE


def test_stage_context_emits_start_and_done():
    buf = io.StringIO()
    ev = EventEmitter(buf)
    with stage(ev, "probe", "reading") as out:
        out["message"], out["data"] = "ok", {"n": 1}
    start, done = events(buf)
    assert (start["status"], done["status"]) == ("start", "done")
    assert done["message"] == "ok" and done["data"]["n"] == 1 and "elapsed_s" in done["data"]


def test_stage_context_tags_errors():
    ev = EventEmitter(None)
    with pytest.raises(StageError) as info:
        with stage(ev, "imu", "x"):
            raise ValueError("bad gpmf")
    assert info.value.stage == "imu" and isinstance(info.value.cause, ValueError)
    assert str(info.value) == "bad gpmf"


def test_run_job_argument_errors(tmp_path):
    ev = EventEmitter(None)
    with pytest.raises(ValueError):
        run_job(tmp_path, ev)                                   # neither
    with pytest.raises(ValueError):
        run_job(tmp_path, ev, video=tmp_path / "a", url="https://x/a.mp4")  # both
    with pytest.raises(StageError) as info:
        run_job(tmp_path, ev, video=tmp_path / "missing.mp4")
    assert info.value.stage == "probe"


def test_ordinal():
    assert [ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21, 22, 112)] == [
        "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "112th"]


def test_human_bytes():
    assert human_bytes(512) == "512 B"
    assert human_bytes(1536) == "1.5 KiB"
    assert human_bytes(3 * 1024 ** 3) == "3.0 GiB"


def test_cli_reports_errors_as_events(tmp_path):
    buf = io.StringIO()
    code = job_cli.main(["--job-dir", str(tmp_path), "--video", str(tmp_path / "nope.mp4")], stream=buf)
    assert code == job_cli.FAILED
    err = events(buf)[-1]
    assert err["type"] == "error" and err["stage"] == "probe" and err["error_type"] == "FileNotFoundError"


def test_cli_rejects_bad_options_before_work(tmp_path):
    buf = io.StringIO()
    code = job_cli.main(["--job-dir", str(tmp_path), "--video", "x.mp4", "--stride", "0"], stream=buf)
    assert code == job_cli.USAGE and events(buf)[-1]["type"] == "error"


def test_cli_rejects_invalid_url_in_download_stage(tmp_path):
    buf = io.StringIO()
    assert job_cli.main(["--job-dir", str(tmp_path), "--url", "ftp://x/v.mp4"], stream=buf) == job_cli.FAILED
    assert events(buf)[-1]["stage"] == "download"


# --- integration --------------------------------------------------------------


@pytest.mark.integration
def test_full_job_on_synthetic_video(synthetic_video, tmp_path):
    buf = io.StringIO()
    code = job_cli.main(["--job-dir", str(tmp_path), "--video", str(synthetic_video),
                         "--no-hands", "--stride", "5", "--max-points", "4"], stream=buf)
    evs = events(buf)
    assert code == job_cli.OK, evs[-1]
    stages = [(e["stage"], e["status"]) for e in evs if e["type"] == "stage"]
    assert stages == [("download", "skip"), ("probe", "start"), ("probe", "done"),
                      ("imu", "skip"), ("qc", "start"), ("qc", "done"),
                      ("results", "start"), ("results", "done")]
    assert any(e["type"] == "progress" and e["stage"] == "qc" for e in evs)
    assert evs[-1]["type"] == "result"

    results = json.loads((tmp_path / RESULTS_FILE).read_text(encoding="utf-8"))
    assert results["schema_version"] == RESULTS_SCHEMA_VERSION
    assert results["video"]["file"] == "test.mp4" and "path" not in results["video"]
    assert results["imu"] is None
    assert results["report"]["sampling"]["frames_analyzed"] == 12
    assert results["frames_preview"]["points"] == 4
    assert (tmp_path / results["files"]["report"]).is_file()
    assert (tmp_path / results["files"]["frames_csv"]).is_file()
