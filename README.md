# probing_qc_pipeline

Quality-control pipeline for GoPro probing videos. It has two stages:

- **IMU extraction:** accelerometer and gyroscope data from the GPMF telemetry track, written to CSV.
- **Video QC:** technical quality and hand-tracking metrics for each video, written to JSON.

## Layout

```
├── src/probing_qc/            # library code (importable package)
│   ├── paths.py               #   project folders, input resolution
│   ├── telemetry.py           #   ffprobe/ffmpeg: find and read the GPMF track
│   ├── gpmf.py                #   GPMF KLV parser
│   ├── imu.py                 #   ACCL/GYRO decoding, timestamps, DataFrame
│   └── qc/                    #   video quality control
│       ├── config.py          #     all settings and thresholds
│       ├── metadata.py        #     container metrics (ffprobe)
│       ├── frames.py          #     single-pass decoding, every Nth frame
│       ├── image_metrics.py   #     luminance, sharpness, blockiness, colour cast
│       ├── hand_tracking.py   #     MediaPipe 21-point hands, egocentric left/right
│       ├── interaction.py     #     hand-object contact (pluggable)
│       ├── hand_metrics.py    #     presence/loss/grasp aggregation
│       ├── orientation.py     #     camera tilt from the IMU
│       ├── analyzers.py       #     per-frame analyzer plug-ins
│       └── pipeline.py        #     orchestration and report assembly
├── scripts/
│   ├── extraction.py          # CLI: input/<video> -> output/<video>_imu.csv
│   ├── qc.py                  # CLI: input/<video> -> output/<video>_qc.json
│   └── download.py            # interactive menu: download a video URL into input/
├── tests/                     # pytest (synthetic data; no real video needed)
├── notebooks/main.ipynb       # stage-by-stage IMU validation on a real video
├── docs/                      # extraction.md, qc.md
├── models/                    # downloaded model files (git-ignored)
├── input/                     # videos (git-ignored)
└── output/                    # generated CSV/JSON (git-ignored)
```

## Setup

You need Python 3.10 or newer and FFmpeg on `PATH`.

```bash
python -m venv venv
venv\Scripts\activate      # Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
pip install -e ".[dev]"
```

## Usage

```bash
python scripts/download.py                  # optional: menu asks for a URL
python scripts/extraction.py GX010140.MP4   # -> output/GX010140_imu.csv
python scripts/qc.py GX010140.MP4           # -> output/GX010140_qc.json
pytest
```

See [docs/extraction.md](docs/extraction.md) for IMU extraction and [docs/qc.md](docs/qc.md) for the QC metrics, the report schema and how to extend it.

## Contributing

- Put reusable logic in `src/probing_qc/`. Keep `scripts/` as thin CLI wrappers.
- Put new QC metrics in a `FrameAnalyzer` (see [docs/qc.md](docs/qc.md#extending)), and put their thresholds in `qc/config.py`.
- Add a test in `tests/` for any change, and run `pytest` before you commit.
- Commit notebooks with their outputs cleared. Never commit videos, models or generated data.
