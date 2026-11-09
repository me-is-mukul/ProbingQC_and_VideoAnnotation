# Processing jobs and the event contract

`probing-job` (`python -m probing_qc.cli.job`) runs the whole pipeline on one video and streams its progress as JSON Lines. The web frontend uses it, and so can any other caller: a batch script, a Cloud Run Job or a test.

```bash
probing-job --job-dir jobs/abc --video input/GX010140.MP4 --start 600 --max-seconds 60
probing-job --job-dir jobs/abc --url https://storage.example.com/GX010140.MP4 --no-hands
```

| Option | Meaning |
|---|---|
| `--job-dir DIR` | Folder for every output of this job (required) |
| `--video PATH` / `--url URL` | Exactly one source. A URL is downloaded into `DIR/source/` first. |
| `--stride`, `--start`, `--max-seconds`, `--hwaccel`, `--config` | Same as `probing-qc` |
| `--no-hands` / `--no-imu` | Skip hand tracking / IMU extraction |
| `--max-points N` | Points per chart series in `results.json` (default 1500) |

Exit codes: `0` success, `1` a stage failed (an `error` event names the stage), `2` invalid arguments.

## Stages

`download` → `probe` → `imu` → `qc` → `results`. The code is in `src/probing_qc/job.py`, with one function per stage.

| Stage | Does | Skipped when |
|---|---|---|
| `download` | Streams the URL to `source/` via a `.part` file | The source is a local file |
| `probe` | ffprobe container metadata | never |
| `imu` | Copies GPMF once, decodes ACCL and GYRO, writes the CSV, runs the checks | `--no-imu`, or no GPMF track |
| `qc` | One FFmpeg decode pass with the image and hand analyzers. Reuses the GPMF bytes from `imu` for orientation, so FFmpeg doesn't run a second time | never |
| `results` | Writes the compact `results.json` | never |

```
job_dir/
  source/<video>              (URL jobs only)
  outputs/<stem>_imu.csv      full-resolution IMU table
  outputs/<stem>_qc.json      full QC report (same as probing-qc)
  outputs/<stem>_qc_frames.csv
  results.json                chart-ready summary (below)
```

## Event stream (stdout, `EVENT_VERSION` 1)

stdout carries only events, one JSON object per line. Native library noise (FFmpeg, MediaPipe) goes to stderr. Python `logging` records are forwarded as `log` events.

| `type` | Fields (besides `v`, `t`) |
|---|---|
| `stage` | `stage`, `status` (`start` \| `done` \| `skip`), `message`, optional `data` (`done` always includes `elapsed_s`; `probe` done includes the video summary) |
| `progress` | `stage`, `done`, `total` (int or `null`), `message`, optional `unit` (`frames`, `bytes`). Throttled to 2 per second. |
| `log` | `level` (`debug` \| `info` \| `warning` \| `error`), `logger`, `message` |
| `result` | `path` (`results.json`), `message`. This is the last line of a successful run. |
| `error` | `stage` (or `null`), `message`, optional `error_type` |

Example:

```json
{"v": 1, "t": 1794213212.098, "type": "stage", "stage": "qc", "status": "done", "message": "74 frames analysed", "data": {"frames_analyzed": 74, "decode_errors": 0, "elapsed_s": 9.19}}
```

Rules for changing the contract:

- Adding a field is backwards compatible.
- Renaming or removing a field means bumping `EVENT_VERSION` in `events.py`. Also update `SUPPORTED_EVENT_VERSIONS` and the parser in `frontend/src/lib/shared/events.ts`.
- Non-finite numbers are written as `null`, never as `NaN`.
- `frontend/tests/integration/pipeline.integration.test.ts` runs the real CLI and asserts that every stdout line parses. Run it after any change here.

## `results.json` (`RESULTS_SCHEMA_VERSION` "1.0")

| Key | Content |
|---|---|
| `source`, `options`, `created_at` | What was processed and how |
| `video` | `VideoInfo` without server paths, plus `display_width` / `display_height` |
| `report` | The full QC report (see [qc.md](qc.md)) |
| `imu` | `null`, or `summary`, `units`, `checks[]`, `preview`, `file` |
| `frames_preview` | Downsampled per-frame metrics |
| `files` | Paths of the full outputs, relative to the job folder |

A *preview* is columnar: `{"points", "bucket_size", "t": [...], "<column>": [...]}`. Each point is the mean of `bucket_size` consecutive samples, so booleans such as `left` become the share of frames, from 0 to 1. A bucket that is all NaN becomes `null`. The code is in `src/probing_qc/preview.py`. An 81-minute video produces about 300 KB instead of more than 60 MB of CSV.
