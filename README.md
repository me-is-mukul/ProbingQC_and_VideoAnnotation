# probing_qc_pipeline

Quality-control pipeline for GoPro probing videos. It has two stages:

- **IMU extraction:** accelerometer and gyroscope data from the GPMF telemetry track, written to CSV and sanity-checked.
- **Video QC:** technical quality and hand-tracking metrics for each video, written to JSON.

Both stages can run on their own from the command line, or together as one **job** (`probing-job`) that streams machine-readable progress. The **web interface** in [`frontend/`](frontend/README.md) uses jobs: upload a video or paste a link, watch the pipeline in an on-screen terminal, and explore the results as charts. Its **probing** tool turns lines drawn on those charts into an ffmpeg command that cuts the selected time out of the video, plus a matching cut of the IMU data.

## Layout

```
├── src/probing_qc/                 # library code (importable package)
│   ├── paths.py                    #   project folders, input resolution, output names
│   ├── ffmpeg.py                   #   the only place that calls ffprobe/ffmpeg for data
│   ├── download.py                 #   HTTP(S) video download (.part file, safe file names)
│   ├── events.py                   #   JSON Lines progress events (the contract with the frontend)
│   ├── preview.py                  #   downsampling long tables into chart series
│   ├── job.py                      #   end-to-end job: download → probe → IMU → QC → results.json
│   ├── keyframes.py                #   keyframe index (lets the web UI write lossless cut commands)
│   ├── imu/                        #   stage 1: GPMF telemetry -> IMU table
│   │   ├── telemetry.py            #     find and copy the GPMF track
│   │   ├── gpmf.py                 #     KLV byte parser
│   │   ├── sensor.py               #     one sensor: scaling, axis order, timestamps
│   │   ├── table.py                #     ACCL + GYRO merge, summary, CSV
│   │   └── checks.py               #     physical sanity checks
│   ├── qc/                         #   stage 2: video quality control
│   │   ├── config.py               #     every setting and threshold, with validation
│   │   ├── metadata.py             #     container metrics (ffprobe JSON -> VideoInfo)
│   │   ├── frames.py               #     single-pass decoding, every Nth frame
│   │   ├── image_metrics.py        #     luminance, sharpness, blockiness, colour cast
│   │   ├── stats.py                #     summaries, boolean runs, circular mean
│   │   ├── hands/                  #     landmarks, MediaPipe detector, grasp heuristic, metrics
│   │   ├── analyzers/              #     per-frame analyzer plug-ins (base, image, hands)
│   │   ├── orientation.py          #     camera tilt from the IMU
│   │   ├── models.py               #     pinned, checksum-verified model download
│   │   ├── report.py               #     JSON report section builders
│   │   └── pipeline.py             #     orchestration: run_qc()
│   └── cli/                        #   command-line entry points (extract, qc, download, job)
├── scripts/                        # thin wrappers: python scripts/<name>.py ...
├── tests/                          # pytest suite + MANUAL_TESTING.md checklist
├── docs/                           # extraction.md, qc.md, job.md (event + results contract)
├── frontend/                       # Next.js + TypeScript web interface (own README, tests, checklist)
├── models/                         # downloaded model files (git-ignored)
├── input/                          # videos (git-ignored)
└── output/                         # generated CSV/JSON (git-ignored)
```

Design rule: parsing and maths are pure functions (bytes, dicts or arrays in, values out). Subprocess, network and file I/O sit in thin wrappers around them. So almost every module can be tested without a video, FFmpeg or MediaPipe. See [tests/MANUAL_TESTING.md](tests/MANUAL_TESTING.md).

## Setup

You need Python 3.10 or newer (validated on 3.13.5) and FFmpeg on `PATH` (validated on 8.0.1).

```bash
python -m venv venv
venv\Scripts\activate      # Linux/macOS: source venv/bin/activate
pip install -r requirements.txt   # exact, validated versions
pip install -e ".[dev]"           # the package itself + console scripts
```

## Usage

Each command is available as a console script or through `scripts/`:

```bash
probing-download                            # = python scripts/download.py   (menu asks for a URL)
probing-extract GX010140.MP4                # = python scripts/extraction.py -> output/GX010140_imu.csv
probing-qc GX010140.MP4                     # = python scripts/qc.py         -> output/GX010140_qc.json
probing-job --job-dir jobs/x --video input/GX010140.MP4   # everything, with JSON Lines progress
pytest                                      # all automated tests
pytest -m "not integration"                 # skip the tests that need FFmpeg

cd frontend && npm ci && npm run dev        # web interface on http://localhost:3000
```

More documentation:

- [docs/extraction.md](docs/extraction.md): IMU extraction.
- [docs/qc.md](docs/qc.md): the QC metrics, the report schema, and how to extend them.
- [docs/job.md](docs/job.md): jobs, the event stream and `results.json`.
- [frontend/README.md](frontend/README.md) and [frontend/docs/ARCHITECTURE.md](frontend/docs/ARCHITECTURE.md): the web interface.

## Reproducibility

- `requirements.txt` pins the exact versions the pipeline was validated with.
- Every QC report embeds its full `config` and a `runtime` block. That block records the package, Python, NumPy, pandas, OpenCV, FFmpeg and MediaPipe versions, plus the hand model's SHA-256. The same video, config and environment give the same report, apart from `runtime.started_at` and `elapsed_s`. `tests/test_integration.py::test_run_qc_is_deterministic` checks this.
- The hand model is pinned by URL and SHA-256 and re-downloaded if the cached copy doesn't match.
- Tests use synthetic data with fixed random seeds. The integration video is generated by FFmpeg's `testsrc2`.

## Contributing

- Put reusable logic in `src/probing_qc/`. Keep `cli/` thin and `scripts/` as one-line shims.
- Keep new logic pure where possible, and put I/O in a separate small function.
- Put new QC metrics in a `FrameAnalyzer` (see [docs/qc.md](docs/qc.md#extending)), and put their thresholds in `qc/config.py`, with a rule in `validation_errors`.
- Add a test in `tests/` and a line in `tests/MANUAL_TESTING.md` for any change. Run `pytest` before you commit.
- Changing an image or hand metric? The web UI recomputes them in TypeScript for probing. Run `python tests/probe_parity.py` to refresh the shared fixture, then `npm test` in `frontend/` (see [frontend/docs/ARCHITECTURE.md](frontend/docs/ARCHITECTURE.md#probing)).
- Commit notebooks with their outputs cleared. Never commit videos, models or generated data.
