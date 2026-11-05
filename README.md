# probing_qc_pipeline

Quality-control pipeline for GoPro probing videos. The current stage extracts IMU telemetry (accelerometer and gyroscope) from the GPMF track into a CSV.

## Layout

```
├── src/probing_qc/        # library code (importable package)
│   ├── telemetry.py       #   ffprobe/ffmpeg: find and read the GPMF track
│   ├── gpmf.py            #   GPMF KLV parser
│   └── imu.py             #   ACCL/GYRO decoding, timestamps, DataFrame
├── scripts/
│   ├── extraction.py      # CLI: input/<video> -> output/<video>_imu.csv
│   └── download.py        # interactive menu: download a video URL into input/
├── tests/                 # pytest unit tests (synthetic data, no video needed)
├── notebooks/main.ipynb   # stage-by-stage validation on a real video
├── docs/extraction.md     # how the extraction works
├── input/                 # videos (git-ignored)
└── output/                # generated CSVs (git-ignored)
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
pytest
```

See [docs/extraction.md](docs/extraction.md) for the format, the method and the validation.

## Contributing

- Put reusable logic in `src/probing_qc/`. Keep `scripts/` as thin CLI wrappers.
- Add a test in `tests/` for any change to parsing or decoding, and run `pytest` before you commit.
- Commit notebooks with their outputs cleared. Never commit videos or generated data.
