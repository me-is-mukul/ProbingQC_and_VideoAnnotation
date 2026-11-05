# IMU Extraction

How `scripts/extraction.py` turns a GoPro video into `output/<video>_imu.csv`.

## Quick start

```bash
python -m venv venv
venv\Scripts\activate            # Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
pip install -e ".[dev]"

python scripts/download.py                  # optional: menu asks for a video URL, saves to input/
python scripts/extraction.py GX010140.MP4   # writes output/GX010140_imu.csv
```

`scripts/download.py` shows a menu: download from a URL, list the videos in `input/`, or quit. The download asks for the URL and a file name (taken from the URL by default) and shows a progress bar. It writes to a `.part` file first, so an interrupted download never leaves a broken video behind. For automation, `--url <URL> [--name FILE]` skips the menu.

**Requirements:** Python 3.10 or newer, and FFmpeg (`ffmpeg` and `ffprobe`) on `PATH`. No C compiler is needed.

| Option | Default | Meaning |
|---|---|---|
| `video` (positional) | — | File name inside the input directory |
| `--input-dir` | `input/` | Folder the video is read from |
| `--output-dir` | `output/` | Folder the CSV is written to |
| `-v`, `--verbose` | off | Debug logging |

## Pipeline

```
input/GX010140.MP4
   │  1. ffprobe: find the stream tagged "gpmd"           probing_qc.telemetry.find_gpmf_stream
   ▼
   │  2. ffmpeg -map 0:<idx> -c copy -f data -  (stdout)  probing_qc.telemetry.read_gpmf
   ▼
raw GPMF bytes (about 29 MiB for an 81-minute video, held in memory)
   │  3. walk the KLV tree DEVC > STRM > {STMP, ORIN, SCAL, ACCL|GYRO}   probing_qc.gpmf / probing_qc.imu
   ▼
scaled samples + per-sample timestamps
   │  4. reorder axes to X,Y,Z; resample GYRO onto the ACCL clock         probing_qc.imu.imu_dataframe
   ▼
output/GX010140_imu.csv
```

### 1. Locate the telemetry track

A GoPro MP4 holds video (`hvc1`), audio (`mp4a`), timecode (`tmcd`) and **GPMF telemetry** (`gpmd`, handler "GoPro MET"). The stream index depends on the camera model, so it is looked up with `ffprobe` rather than hard-coded as `0:3`.

### 2. Extract the GPMF bytes

FFmpeg copies the track without re-encoding. `-f data` is required because FFmpeg cannot guess a container for raw data. Without it, the command fails with *"Unable to choose an output format"*. The output goes to stdout, so no `telemetry.bin` file is left behind. On the 8 GB sample, the whole extraction takes about 20 s.

### 3. Parse GPMF (KLV)

Every GPMF entry has an 8-byte header followed by a payload padded to a multiple of 4 bytes. All values are **big-endian**.

| Bytes | Field | Example (`ACCL`) |
|---|---|---|
| 0–3 | FourCC key | `41 43 43 4C` = `ACCL` |
| 4 | type char (`0x00` = nested container) | `73` = `s` (int16) |
| 5 | struct size (bytes per sample) | `06` = 3 × int16 |
| 6–7 | repeat (sample count) | `00 C7` = 199 |

Each payload (about 1 s) is one `DEVC`, which holds one `STRM` per sensor. Inside a `STRM`, properties are **sticky** and apply to the data entry that follows them:

| Key | Use |
|---|---|
| `STMP` | payload start time, µs since recording start (uint64) |
| `ORIN` | channel order, e.g. `ZXY`; lowercase means negated |
| `SIUN` | SI units: `m/s²` (ACCL), `rad/s` (GYRO) |
| `SCAL` | divisor applied to raw ints (HERO12: ACCL 417, GYRO 939) |
| `ACCL` / `GYRO` | raw `int16[3]` samples |

The parser walks this tree structurally. It does not search the bytes for `b"ACCL"`, which could also match inside sensor data. It reads `SCAL` from the stream itself rather than using fixed constants.

### 4. Timestamps, axes and merging

- **Timestamps:** each payload's samples are spaced evenly from its `STMP` to the next payload's `STMP`. The last payload uses the mean sample period. Without `STMP` (older cameras), 1 s payloads are assumed and a warning is logged.
- **Axes:** the data is stored in `ORIN` order (`ZXY` on the HERO12). It is reordered to camera **X, Y, Z**, and the sign is flipped for lowercase channels.
- **Merging:** rows follow the accelerometer clock. Gyroscope values are linearly interpolated onto it. On the HERO12 both sensors share timestamps, so this changes nothing.

## Output format

`output/<video stem>_imu.csv`, written with 6 decimal places:

| Column | Unit | Description |
|---|---|---|
| `timestamp_s` | s | time since the recording started (same timeline as the video) |
| `acc_x`, `acc_y`, `acc_z` | m/s² | accelerometer, camera frame, includes gravity |
| `gyro_x`, `gyro_y`, `gyro_z` | rad/s | gyroscope, camera frame |

## Reference result (GX010140.MP4, HERO12 Black)

| Metric | Value |
|---|---|
| Video duration | 4868.86 s |
| Payloads | 4864 |
| Samples (ACCL = GYRO) | 970,019 |
| Effective rate | 199.23 Hz |
| Median \|acc\| | 9.76 m/s² (≈ g) |
| CSV size | 63 MiB |

## Validation

- `pytest` runs unit tests on synthetic GPMF streams: KLV parsing, padding, scaling, axis reordering and timing. These tests need neither a video nor FFmpeg.
- `notebooks/main.ipynb` runs each stage on a real video and asserts:
  - no NaNs
  - strictly increasing timestamps
  - IMU duration within 1 s of the video duration
  - sample rate between 150 and 250 Hz
  - median \|acc\| = 9.81 ± 0.5 m/s²
  - mean gyroscope bias below 0.05 rad/s
  - the script's CSV matches the in-memory result

## Changes from the original exploration notebook

| Before | Now | Why |
|---|---|---|
| Fixed rate `np.arange(n) / 199` | Timestamps from `STMP` | The true rate is 199.23 Hz. The fixed rate drifted to 4874.5 s on a 4868.9 s video, about 5.6 s off. |
| Hard-coded `SCAL` 417 / 939 | `SCAL` read per stream | Scales can differ between models and firmware |
| `data.find(b"ACCL")` byte search | Structural KLV walk | Avoids false matches inside the payload |
| Columns `axis_1..3` in raw `ZXY` order | `x, y, z` columns using `ORIN` | Axes are explicit |
| Stream `0:3`, `telemetry.bin` on disk | Stream found with ffprobe, piped in memory | Works on any camera and leaves no stray files |
| gpmf-parser C demo built with gcc | Dropped | On Windows/MinGW, `fseeko` is missing and the 32-bit fallback rejects files over 4 GB with *"invalid MP4/MOV"*. The pure-Python parser avoids the build step. |

## Extending

Other sensors use the same `extract_sensor(data, KEY)` call. On the HERO12 these include `GRAV` (gravity vector), `CORI` (camera orientation quaternion) and `IORI`, and GPS models add `GPS5`/`GPS9`. Note that `SensorStream.samples()` assumes three channels. Use `np.vstack(sensor.payloads)` for other shapes.
