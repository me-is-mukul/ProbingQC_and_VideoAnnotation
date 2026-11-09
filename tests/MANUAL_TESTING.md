# Manual unit-testing checklist

This is a list of objectives to verify by hand, module by module, with the edge cases that matter. Each row gives the **expected behaviour of the current code**. If you observe something else, it's a bug, or the docs need updating.

The **Auto** column shows whether `pytest` already covers the case: ✅ covered, ◐ partly covered, — manual only. Manual-only rows need you, a real video or a judgement call.

## Setup

```bash
venv\Scripts\activate
pip install -r requirements.txt && pip install -e ".[dev]"
pytest                       # everything should pass before you start
cd tests && python           # REPL with the synthetic builders importable
```

```python
>>> from helpers import gpmf_stream, klv, nest, sensor_strm, devc, make_hand, probe_json
>>> import numpy as np, pandas as pd
```

- `gpmf_stream(payloads, samples, period_us)` builds a valid GPMF byte stream. `klv` / `nest` / `sensor_strm` / `devc` let you build broken ones.
- `make_hand(side, wrist_x, curl, pinch)` builds a hand with palm length 1 and exact curl and pinch ratios.
- `probe_json(**overrides)` returns ffprobe JSON for a 1080p30 HEVC GoPro clip. Override any video-stream key.

**Reproducibility rules for manual tests:** seed every random input (`np.random.default_rng(0)`). Write outputs to a temporary folder, not `output/`. Record the `runtime` block of any report you compare.

---

## 1. IMU: `probing_qc.imu.gpmf` (KLV parser)

| # | Objective / edge case | Input | Expected | Auto |
|---|---|---|---|---|
| 1.1 | Parse a flat list of entries | two `klv(...)` concatenated | both yielded in order with the right `key` | ✅ |
| 1.2 | Zero padding between entries | `klv(A) + b"\0"*8 + klv(B)` | padding skipped, yields A and B | ✅ |
| 1.3 | Payload not a multiple of 4 | `klv(b"ABCD","c",1,3,b"xyz")` | `text() == "xyz"`, next entry aligned | ✅ |
| 1.4 | Truncated payload | header says 8 bytes, only 4 present | `ValueError("Truncated GPMF entry ...")` | ✅ |
| 1.5 | Buffer shorter than a header | `b"ABC"` / `b""` | yields nothing, no error | ✅ |
| 1.6 | Nested container | `nest(b"DEVC", ...)` | `is_nested`, `children()` walks one level | ✅ |
| 1.7 | Big-endian decode, shape | `"s"`, size 6, repeat 2 | `values().shape == (2, 3)`, signs correct | ✅ |
| 1.8 | `repeat == 0` | empty payload | `values().shape == (0, n)` | ✅ |
| 1.9 | Unknown type char | type `"?"` | `values()` raises `KeyError` (known behaviour) | ✅ |
| 1.10 | Non-ASCII key bytes | key `b"\xff\xfeAB"` | decoded with replacement chars, no crash | — |
| 1.11 | Odd struct size vs dtype | `"s"` with size 5 | `reshape` raises `ValueError` (corrupt data surfaces) | — |

## 2. IMU: `probing_qc.imu.sensor`

| # | Objective / edge case | Input | Expected | Auto |
|---|---|---|---|---|
| 2.1 | Axis reorder `ZXY` → XYZ | `[[1,2,3]]` | `[[2,3,1]]` | ✅ |
| 2.2 | Lowercase = negated | `"zXy"` | `[[2,-3,-1]]` | ✅ |
| 2.3 | Identity orientation | `"XYZ"` | unchanged | ✅ |
| 2.4 | Invalid ORIN (`"XY"`, `"XXY"`, `"ABC"`, `""`) | — | `ValueError` | ✅ |
| 2.5 | SCAL single divisor | `[[10]]` | all channels / 10 | ✅ |
| 2.6 | SCAL per channel | `[[10,20,30]]` | element-wise | ✅ |
| 2.7 | No SCAL | `None` | raw cast to float | ✅ |
| 2.8 | SCAL of 0 | `[[0]]` | inf/NaN values (not guarded); check `no_nans` catches it | — |
| 2.9 | Timestamps spaced evenly between STMPs | counts `[4,4]`, starts `[0,1]` | `0, .25, …, 1.75` | ✅ |
| 2.10 | Last payload uses mean period | `[2,2,4]`, `[0,1,2]` | last four `2.0, 2.5, 3.0, 3.5` | ✅ |
| 2.11 | Single payload | `[4]`, `[5.0]` | spans `DEFAULT_PAYLOAD_SECONDS` (1 s) | ✅ |
| 2.12 | No payloads | `[]`, `[]` | empty array | ✅ |
| 2.13 | Count/start length mismatch | `[1,2]`, `[0]` | `ValueError` | ✅ |
| 2.14 | Missing STMP | streams without STMP | 1 s payloads assumed, warning logged | ✅ |
| 2.15 | Missing ORIN | — | `orientation is None`, `samples()` uses `ZXY` | ✅ |
| 2.16 | Non-monotonic STMP (clock reset) | starts `[0, 2, 1]` | negative durations → decreasing timestamps; `timestamps_increasing` check must fail | — |
| 2.17 | Sensor key absent | `"GPS5"` on ACCL-only data | `ValueError("No GPS5 samples ...")` | ✅ |
| 2.18 | Top-level non-DEVC containers | junk + valid | junk ignored | ✅ |
| 2.19 | SCAL changes between payloads | two STRMs with different SCAL | each payload scaled by its own SCAL | — |

## 3. IMU: `probing_qc.imu.table` and `imu.checks`

| # | Objective / edge case | Input | Expected | Auto |
|---|---|---|---|---|
| 3.1 | Column order | `imu_dataframe(stream)` | exactly `IMU_COLUMNS` | ✅ |
| 3.2 | GYRO on ACCL clock | equal clocks | gyro unchanged | ✅ |
| 3.3 | Different sample counts | GYRO with fewer samples | interpolated, info log, rows = ACCL count | — |
| 3.4 | Interpolation outside range | targets before/after source | edge values held | ✅ |
| 3.5 | `imu_summary` with 0 / 1 / 2 rows | — | `rate_hz` None / None / correct | ✅ |
| 3.6 | CSV round trip | `write_imu_csv` into a new nested folder | folder created; values equal to 1e-6 | ✅ |
| 3.7 | Resting camera passes all checks | seeded synthetic rest data | `failed(...) == []` | ✅ |
| 3.8 | Each check fails on purpose | NaN, ×100 scale, time jump, wrong duration | the matching check fails | ✅ |
| 3.9 | Duration check without video duration | `video_duration_s=None` | check omitted (not failed) | ✅ |
| 3.10 | Gyro bias limit on a slowly rotating camera | constant 0.1 rad/s | `gyro_bias` fails (expected; the limits assume normal use) | — |
| 3.11 | Custom limits | `ImuLimits(min_rate_hz=20, max_rate_hz=30)` on 25 Hz data | `sample_rate` passes | — |

## 4. I/O helpers: `paths`, `download`, `ffmpeg`, `imu.telemetry`

| # | Objective / edge case | Input | Expected | Auto |
|---|---|---|---|---|
| 4.1 | Resolve a name inside `input/` | `"a.mp4"` | absolute path in input dir | ✅ |
| 4.2 | Direct path wins over input dir | same name in cwd and input | cwd file | ✅ |
| 4.3 | Missing file / a directory | — | `None` | ✅ |
| 4.4 | Path with spaces (`"input/mono samples/GX010146.MP4"`) | — | resolves | — |
| 4.5 | `output_path` keeps the stem, any case | `"My Clip.MP4"` | `My Clip_imu.csv` | ✅ |
| 4.6 | `list_videos` | `.MP4`, `.mov`, `.txt`, `.part`, dir named `x.mp4` | only real `.mp4`/`.mov` files, sorted | ✅ |
| 4.7 | URL validation | `ftp://`, no scheme, `https://` | False | ✅ |
| 4.8 | Filename from URL: query/fragment, `%20` | — | stripped / decoded | ✅ |
| 4.9 | **Path traversal** `..%2F..%2Fevil.mp4`, `..%5C` | — | `evil.mp4` | ✅ |
| 4.10 | URL ending in `/` or `..` | — | `""` → CLI asks for / requires a name | ✅ |
| 4.11 | Interrupted download (Ctrl+C mid-transfer) | real URL | no `.part` left, no partial video, exit 130 | — |
| 4.12 | HTTP 404 | real URL | `Download failed: 404 ...` (menu) / traceback (`--url`) | — |
| 4.13 | No `content-length` header | chunked server | progress bar without total, file complete | — |
| 4.14 | `ffmpeg` missing from PATH | rename PATH temporarily | `RuntimeError("'ffmpeg' not found on PATH ...")` | ✅ (`require_tool`) |
| 4.15 | `parse_ffmpeg_version` on odd banners | `""`, other text | `None` | ✅ |
| 4.16 | First `gpmd` stream wins | two `gpmd` streams | lowest listed index | ✅ |
| 4.17 | Video without GPMF | phone clip / synthetic | `find_gpmf_stream` raises `ValueError` | ✅ |
| 4.18 | Non-ASCII file path (e.g. `vidéo.mp4`) | real file | ffprobe JSON decodes (UTF-8) | — |

## 5. QC: `qc.config`

| # | Objective / edge case | Input | Expected | Auto |
|---|---|---|---|---|
| 5.1 | Defaults validate | `QCConfig()` | no error | ✅ |
| 5.2 | Partial override keeps other defaults | `{"sampling": {"frame_stride": 2}}` | only that field changes | ✅ |
| 5.3 | Round trip | `from_dict(cfg.to_dict()) == cfg` | True | ✅ |
| 5.4 | Typo in key | `frame_strid` | `KeyError` naming the class | ✅ |
| 5.5 | Section given as a scalar | `{"sampling": 5}` | `TypeError` | ✅ |
| 5.6 | Out of range: stride 0, 1.5, `true`; `start_s<0`; `max_seconds=0`; `dark>=bright`; `block_size<2`; confidence >1; negative durations; `window_s=0`; `max_error_messages<0` | — | `ValueError` listing every bad field | ✅ |
| 5.7 | Several bad fields at once | two invalid values | both listed in one message | — |
| 5.8 | `override` ignores `None` | `start_s=None` | unchanged | ✅ |
| 5.9 | Wrong value *type* in a leaf (`"dark_luma": "40"`) | — | comparison `TypeError` from `validate` (not a friendly message) | — |
| 5.10 | `--dump-config` output loads back unchanged | `probing-qc --dump-config > c.json` then `--config c.json` | identical `config` block in report | — |

## 6. QC: `qc.stats` and `qc.image_metrics`

| # | Objective / edge case | Input | Expected | Auto |
|---|---|---|---|---|
| 6.1 | `runs` on all-False / all-True / empty | — | `(0,2)` / `[[0,n]]` / `(0,2)` | ✅ |
| 6.2 | `fill_gaps` only fills interior gaps | `[0,1,0,0,1,0]`, gap 2 | `[0,1,1,1,1,0]` (edges kept) | ✅ |
| 6.3 | `fill_gaps`/`drop_short` don't mutate input | — | input unchanged | ✅ |
| 6.4 | `summarize` ignores NaN; all-NaN/empty → `None`s | — | — | ✅ |
| 6.5 | `pct([])` | — | `0.0` | ✅ |
| 6.6 | Circular mean across 0° | `[350, 10]` | ≈0°, not 180° | ✅ |
| 6.7 | Circular mean of opposite angles | `[0, 180]` | undefined direction; result is arbitrary but in `[0,360)` | — |
| 6.8 | Luminance black / white | zeros / 255 | 0 / 255 | ◐ |
| 6.9 | Sharpness flat vs noise | — | 0 vs large | ✅ |
| 6.10 | Sharpness is resolution dependent | same scene at 960 vs 1920 wide | different values → always compare at `analysis_width` | — |
| 6.11 | Blockiness clean vs 8×8 blocks | — | ≈1.0 vs >5 | ✅ |
| 6.12 | Blockiness flat image | constant | exactly 1.0 (1-level floor) | ✅ |
| 6.13 | Blockiness image ≤ block size | 8×8 | NaN | ✅ |
| 6.14 | Blockiness with grid offset (cropped video) | shift a block image by 3 px | ratio drops towards 1 (known limitation) | — |
| 6.15 | Colour cast grey | constant 128 | offset ≈0, factor 0, hue 0 (meaningless) | ✅ |
| 6.16 | Colour cast blue / red / yellow | tinted noise | hue ≈270 / ≈0 / ≈90 | ◐ (blue only) |
| 6.17 | `resize_to_width` never upscales; returns same object when equal | — | — | ✅ |
| 6.18 | Portrait (rotated) frames | 1080×1920 | metrics computed, no crash | — |

## 7. QC: `qc.metadata` and `qc.frames`

| # | Objective / edge case | Input | Expected | Auto |
|---|---|---|---|---|
| 7.1 | Parse a GoPro-like probe | `probe_json()` | fps 29.97, 300 frames, `has_gpmf` | ✅ |
| 7.2 | `avg_frame_rate = "0/0"` | fallback to `r_frame_rate` | ✅ | ✅ |
| 7.3 | No usable frame rate | both `0/0` | `ValueError` | ✅ |
| 7.4 | `nb_frames = "N/A"` | — | estimated `round(duration*fps)` | ✅ |
| 7.5 | Stream duration missing | — | format duration used | ✅ |
| 7.6 | Both durations missing | — | `KeyError` (known) | — |
| 7.7 | Audio-only file | — | `ValueError("No video stream ...")` | ✅ |
| 7.8 | Rotation: side data (−90 → 270) beats `rotate` tag | — | ✅ | ✅ |
| 7.9 | Rotated display size swaps w/h | rotation 90 | `(1080, 1920)` | ✅ |
| 7.10 | Expected frame count: ceil, start offset, window, start past end | table in tests | ✅ | ✅ |
| 7.11 | Decode command: `-ss`/`-hwaccel` before `-i`, `-t` after | — | ✅ | ✅ |
| 7.12 | Sampler yields every Nth frame with correct timestamps | synthetic video | ✅ | ✅ |
| 7.13 | Sampler window `--start 1 --max-seconds 0.5` | synthetic video | first index 30, count within ±1 of expected | ✅ |
| 7.14 | Consumer stops early (`break`) | — | ffmpeg terminated and reaped, no hang | ✅ |
| 7.15 | Corrupt/truncated video (cut a real MP4 with `head -c`) | — | `decode_errors.count > 0`, `frames_decoded < frames_expected` | — |
| 7.16 | Invalid `--hwaccel foo` | real video | ffmpeg error → no frames → `RuntimeError("No frames decoded ...")` | — |
| 7.17 | Variable-frame-rate phone clip | — | timestamps assume CFR; note drift (known limitation) | — |

## 8. QC: `qc.hands` (landmarks, interaction, metrics)

| # | Objective / edge case | Input | Expected | Auto |
|---|---|---|---|---|
| 8.1 | No / one detection | — | empty / that side only | ✅ |
| 8.2 | Duplicate labels resolved by image x | two "left" | leftmost → left, other relabelled right | ✅ |
| 8.3 | Distinct labels trusted even when crossed | left at x=0.9, right at 0.1 | kept as labelled | ✅ |
| 8.4 | More than two detections | three hands | first two used | ✅ |
| 8.5 | `unmirror` flips x, returns copies | — | input untouched | ✅ |
| 8.6 | Open hand / fist / pinch | curl 2 / 1 / pinch 0.1 | not contact / contact / contact | ✅ |
| 8.7 | Zero palm length | all-zero world landmarks | curl, pinch NaN; not in contact | ✅ |
| 8.8 | Around the threshold | curl 1.29 / 1.31 | contact / not contact (strict `<`). At exactly 1.3 the float32 landmarks round to 1.2999999, so `make_hand(curl=1.3)` **is** in contact. Don't test exact equality. | — |
| 8.9 | `seconds_to_frames` rounding and negatives | — | ✅ | ✅ |
| 8.10 | Tracking losses: leading gap ignored, trailing gap counted, never-tracked = 0 | — | ✅ | ✅ |
| 8.11 | Gap exactly `min_loss_s` | gap of `min_gap` frames | counted (`>=`) | ◐ |
| 8.12 | Grasp cleaning: bridge short gaps, drop blips | — | ✅ | ✅ |
| 8.13 | Contact while hand absent | contact True, presence False | ignored | ✅ |
| 8.14 | Full metric set on a hand-made sequence | see `test_compute_hand_metrics` | all fields match by hand calculation | ✅ |
| 8.15 | Empty arrays (0 frames) | — | percentages 0, counts 0, durations `None` | — |
| 8.16 | Changing stride changes only resolution, not seconds | same clip, stride 2 vs 8 | `*_pct` similar; `grasp_duration` comparable | — |

## 9. QC: analyzers, orientation, report, pipeline

| # | Objective / edge case | Input | Expected | Auto |
|---|---|---|---|---|
| 9.1 | Image analyzer row keys | any frame | the six documented columns | ✅ |
| 9.2 | Dark / bright percentages | frames at 10 / 128 / 250 | 33.33 % each side | ✅ |
| 9.3 | No cast frames → `cast_hue_deg: null` | grey frames | ✅ | ✅ |
| 9.4 | Hand analyzer with a stub detector | scripted `FrameHands` | timestamps in ms increasing; presence column matches script | ✅ |
| 9.5 | `info()` without a real model | stub | no MediaPipe fields | ✅ |
| 9.6 | `close()` always called, even if an analyzer raises mid-run | stub that raises on frame 2 | detector `closed == True` | — |
| 9.7 | `--no-hands` | — | only `image` analyzer; no `hands` section | ✅ |
| 9.8 | Gravity: steady camera | constant `(0,0,g)` | up `[0,0,1]`, tilt 0 | ✅ |
| 9.9 | Gravity: 90° turn halfway | — | max tilt ≈45° from the median | ✅ |
| 9.10 | Window outside data / all-zero accel | — | `ValueError` (pipeline logs a warning, keeps going) | ✅ |
| 9.11 | Empty time bins skipped | gap in samples | no NaN windows | ✅ |
| 9.12 | Report sections: portrait, kbps, analysis fps, message cap | — | ✅ | ✅ |
| 9.13 | Runtime flattening of provenance | — | ✅ | ✅ |
| 9.14 | Report is JSON-serialisable (no numpy types) | synthetic video | `json.dumps` works | ✅ |
| 9.15 | **Determinism**: same video and config twice | synthetic video | all fields outside `runtime` equal; frames table equal | ✅ |
| 9.16 | Determinism on real footage with hands | 60 s window of GX010140, run twice | identical `hands` section and frames CSV | — |
| 9.17 | Zero frames decoded | `--start` beyond the end | `RuntimeError("No frames decoded ...")` | — |

## 10. CLI (`probing-extract`, `probing-qc`, `probing-download`)

| # | Objective / edge case | Command | Expected | Auto |
|---|---|---|---|---|
| 10.1 | Dump config | `probing-qc --dump-config` | valid JSON, exit 0 | ✅ |
| 10.2 | No video | `probing-qc` | error, exit 2 | ✅ |
| 10.3 | Missing video | `probing-qc nope.mp4` | "Video not found … also looked in …", exit 1 | ✅ |
| 10.4 | Invalid flag value | `--stride 0` | "Invalid QC config", exit 2 | ✅ |
| 10.5 | Precedence | file stride 2, `--stride 8` | 8 wins; other file values kept | ✅ |
| 10.6 | Outputs written, folder created | `--output-dir new/dir --frames-csv` | JSON + CSV with header + N rows | ✅ |
| 10.7 | `scripts/*.py` shims behave the same as console scripts | run both with `--help` | identical help | — |
| 10.8 | Extract: missing video | `probing-extract nope.mp4` | exit 1 | ✅ |
| 10.9 | Extract: video without GPMF | phone clip | `ValueError` traceback, no CSV written | — |
| 10.10 | Extract: `--no-checks` | real video | no check log lines | — |
| 10.11 | Download: bad URL / URL with no file name | `--url ftp://x`, `--url https://x.org/` | exit 2, no network call | ✅ |
| 10.12 | Download menu: invalid choice, overwrite prompt "n" | interactive | "Please enter 1, 2 or 3." / "Skipped." | — |

---

## 11. End-to-end on real footage (manual, slow)

Run these in a scratch output folder so `output/` stays untouched:

```bash
probing-extract GX010140.MP4 --output-dir tmp_out
probing-qc GX010140.MP4 --start 600 --max-seconds 60 --frames-csv --output-dir tmp_out
```

| # | Objective | Expected (validated 2026-11-09, HERO12, FFmpeg 8.0.1) |
|---|---|---|
| 11.1 | IMU reference numbers | 970,019 samples, 4868.86 s, 199.2 Hz; "All IMU sanity checks passed" |
| 11.2 | IMU CSV is stable across code changes | `pd.read_csv(old).equals(pd.read_csv(new))` is True |
| 11.3 | QC window | `frames_analyzed: 449`, `analysis_fps: 7.493`, `decode_errors.count: 0` |
| 11.4 | Reproducibility | a second run gives the same report except `runtime.started_at`/`elapsed_s` |
| 11.5 | Hand model integrity | `runtime.hand_model_sha256 == fbc2a300…7cde1`; corrupting `models/hand_landmarker.task` triggers a re-download |
| 11.6 | 2.7K / 59.94 fps clip (`input/mono samples/GX010146.MP4`) | runs; `analysis_fps ≈ 14.99` |
| 11.7 | Visual check of hand metrics | play 10 s with `--frames-csv`, compare `left`/`right`/`*_contact` columns against what you see; note left/right swaps when hands cross |

Diff two reports while ignoring the runtime block:

```python
import json
a, b = (json.load(open(p)) for p in ("run1/GX010140_qc.json", "run2/GX010140_qc.json"))
for r in (a, b): r.pop("runtime")
assert a == b
```

## Known behaviours worth re-checking after changes

- Unknown GPMF type characters raise `KeyError` only when that entry's values are read. Unread entries are harmless.
- `SCAL = 0` is not guarded. It produces inf/NaN, and the `no_nans` check catches that.
- Grey frames report colour-cast hue 0°. The hue is only meaningful when `factor` exceeds `cast_factor`.
- Thresholds use strict comparisons: `curl < curl_ratio`, `luminance < dark_luma`, `factor > cast_factor`.
- Timestamps assume a constant frame rate (`index / fps`).
- `blur_sharpness`, `grasp_curl_ratio` and `grasp_pinch_ratio` are uncalibrated (see `docs/qc.md`).
