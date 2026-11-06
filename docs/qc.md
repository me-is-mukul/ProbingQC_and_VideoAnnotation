# Video QC Metrics

`scripts/qc.py` analyses one video and writes `output/<video>_qc.json`. The report covers technical quality (container, decode, exposure, sharpness, compression, colour, orientation) and hand-tracking coverage (presence, tracking losses, hand-object interaction, grasps).

## Quick start

```bash
pip install -r requirements.txt
pip install -e ".[dev]"

python scripts/qc.py GX010140.MP4                              # full video -> output/GX010140_qc.json
python scripts/qc.py "input/mono samples/GX010146.MP4" --start 600 --max-seconds 60 --frames-csv
python scripts/qc.py --dump-config > my_qc.json                # editable settings file
python scripts/qc.py GX010140.MP4 --config my_qc.json
```

The hand model (`models/hand_landmarker.task`, 7.8 MB) downloads automatically on the first run and is checked against a pinned SHA-256.

| Option | Meaning |
|---|---|
| `--stride N` | analyse every Nth frame (default 4, i.e. skip 3) |
| `--start S` / `--max-seconds S` | analyse a window, e.g. for quick checks |
| `--hwaccel d3d11va` | GPU video decoding (`cuda` on NVIDIA) |
| `--no-hands` | technical metrics only (much faster) |
| `--frames-csv` | also write `<video>_qc_frames.csv` with one row per analysed frame |
| `--config FILE` | JSON overriding any subset of the settings below |

## How it works

```
probe_video (ffprobe) ──► container metrics: duration, fps, bitrate, codec, rotation
        │
FrameSampler (one ffmpeg decode pass, every Nth frame piped as RGB, stderr = decode errors)
        │  frame
        ├──► ImageQualityAnalyzer ── luminance, sharpness, blockiness, colour cast
        └──► HandAnalyzer ── MediaPipe landmarks ──► InteractionDetector (grasp/contact)
        │  per-frame table
        ▼
summaries + hand_metrics ──► report JSON
gravity_stats (GPMF accelerometer) ──► orientation.imu
```

- **Frame stride:** ffmpeg must still decode every frame, because HEVC frames reference each other. The stride saves analysis time, not decode time. Decode errors are therefore detected over the whole range, not just the sampled frames.
- **Analysis rate:** the effective rate is `fps / stride`, about 15 fps for 59.94 fps footage and about 7.5 fps for 29.97 fps footage. Duration-based thresholds (in seconds) behave the same either way.
- **Timestamps:** every frame is stamped `index / fps`. GoPro footage is constant frame rate.
- **Overlap:** a prefetch thread lets decoding run while the previous frame is analysed.

## Report schema (`schema_version` 1.0)

### `technical`

| Field | Unit | Definition |
|---|---|---|
| `duration` | s | video stream duration |
| `fps` | frames/s | average frame rate |
| `bitrate.video_kbps` / `total_kbps` | kbit/s | video stream bitrate / whole file |
| `codec.name`, `profile`, `pix_fmt` | — | from ffprobe |
| `decode_errors.count` | lines | ffmpeg error-level messages during decoding (0 = clean) |
| `decode_errors.ffmpeg_exit_code` | — | non-zero means decoding aborted |
| `decode_errors.frames_expected` / `frames_decoded` | frames | a gap larger than about 1 means truncated or corrupt video. A difference of ±1 at `--start`/`--max-seconds` boundaries is normal. |
| `decode_errors.messages` | — | first `max_error_messages` error lines |
| `orientation.rotation_deg` | ° | rotation metadata (display matrix) |
| `orientation.display` | — | `landscape` or `portrait` after rotation |
| `orientation.width` / `height` | px | display size |
| `orientation.imu.up_unit_xyz` | — | median "up" direction in the IMU frame. This is the accelerometer averaged over 1 s windows, so it points opposite to gravity. |
| `orientation.imu.tilt_deg` | ° | per-window angle from that median. Low means a steady camera; high means head movement or a loose mount. |
| `luminance` | 0–255 | mean luma per frame. Adds `dark_frames_pct` (< `dark_luma`) and `bright_frames_pct` (> `bright_luma`). |
| `sharpness` | — | variance of the Laplacian at `analysis_width`. Adds `blurry_frames_pct` (< `blur_sharpness`). |
| `blockiness` | ratio | mean luma step across 8×8 block boundaries divided by the step inside blocks. About 1.0 is clean; clearly above 1 indicates compression blocking. Computed at native resolution. |
| `colour_cast.offset` | CIELAB units | distance of the mean (a\*, b\*) from neutral grey |
| `colour_cast.factor` | ratio | K = offset / chroma spread. Above `cast_factor`, a frame counts as cast (`cast_frames_pct`). |
| `colour_cast.cast_hue_deg` | ° | mean direction of the cast: 0 red, 90 yellow, 180 green, 270 blue |

Per-frame metrics are summarised as `mean, std, min, p5, p50, p95, max`.

### `hands`

All percentages are over analysed frames. "Left" and "right" mean the wearer's hands.

| Field | Unit | Definition |
|---|---|---|
| `either_hand_pct` | % | at least one hand detected |
| `both_hands_pct` | % | both hands detected |
| `left_hand_pct` / `right_hand_pct` | % | that hand detected |
| `untracked_pct` | % | no hand detected (100 − `either_hand_pct`) |
| `tracking_losses` | count | times all hands disappear for at least `min_loss_s`. A gap before the first detection doesn't count. |
| `longest_hand_gap` | s | longest stretch with no hand at all |
| `HOI_pct` | % | at least one hand in contact (after cleaning, see below) |
| `grasp_count` | count | contact episodes, both hands combined |
| `grasp_duration` | s | `total_s, mean_s, median_s, max_s` over episodes |
| `per_hand.{left,right}` | — | `tracking_losses`, `grasp_count` and `grasp_duration` per hand |

**Contact cleaning:** per hand, gaps shorter than `grasp_merge_gap_s` are bridged. Episodes shorter than `grasp_min_duration_s` are dropped.

### `sampling`, `video`, `config`, `runtime`

- `sampling`: stride, analysis fps, window, number of analysed frames.
- `video`: file name, size, frame count, whether GPMF telemetry is present.
- `config`: the complete settings used. With the same input and config, the report is reproducible.
- `runtime`: start time, elapsed time, package version, MediaPipe version, model checksum, interaction detector.

## Settings

All thresholds live in `src/probing_qc/qc/config.py`. Print them with `--dump-config`.

| Setting | Default | Notes |
|---|---|---|
| `sampling.frame_stride` | 4 | |
| `image.analysis_width` | 960 | Luma, sharpness and colour are computed at this width, so they are comparable across resolutions |
| `image.dark_luma` / `bright_luma` | 40 / 215 | |
| `image.blur_sharpness` | 100 | **uncalibrated**. Sharp GoPro frames measured 370–1300. |
| `image.cast_factor` | 1.5 | literature default |
| `hands.input_width` | 1280 | frames are downscaled before detection |
| `hands.min_*_confidence` | 0.5 | MediaPipe defaults |
| `hands.mirrored_input` | false | false for head- or chest-mounted footage |
| `hands.min_loss_s` | 0.5 | |
| `hands.grasp_curl_ratio` / `grasp_pinch_ratio` | 1.3 / 0.35 | **uncalibrated** |
| `hands.grasp_merge_gap_s` / `grasp_min_duration_s` | 0.25 / 0.3 | |

## Known limitations and next steps

1. **HOI and grasp detection is a heuristic.** `LandmarkGraspDetector` marks a hand as grasping when the fingers are curled (`curl < 1.3`) or the thumb and index finger pinch (`pinch < 0.35`). It cannot see objects, so an empty fist counts. On the sample clips it reports `HOI_pct` of about 80%. Treat these metrics as provisional until either:
   - the thresholds are calibrated on hand-labelled clips (`--frames-csv` writes `*_curl` and `*_pinch` per frame for this), or
   - a learned contact model replaces the heuristic (next section).
2. **Handedness:** MediaPipe labels hands assuming a mirrored selfie image. Frames are flipped before detection (`mirrored_input: false`). When both detections get the same label, the hand further left in the image is taken as the left hand. Labels can still swap when the hands cross.
3. **Thresholds** marked "uncalibrated" need a labelled reference set: good and bad clips per metric.
4. **IMU axes:** `up_unit_xyz` is in the GoPro IMU frame after `ORIN` reordering (see [extraction.md](extraction.md)). The mapping to image axes isn't asserted, so the report gives no pitch/roll values yet.

## Performance

Measured on CPU without hardware decoding, stride 4:

| Video | Throughput | Full-video estimate |
|---|---|---|
| GX010140, 1080p, 29.97 fps, 81 min | about 2× real time | about 40 min |
| GX010146, 2.7K, 59.94 fps, 40 min | about 11 analysed frames/s | about 55 min |

Hand detection is about 50 ms per frame and is now the main cost. To go faster:
- `--no-hands` (technical metrics only)
- a larger `--stride`
- a lower `hands.input_width` (possibly fewer detections)
- `--hwaccel d3d11va` or `--hwaccel cuda`

## Extending

**New per-frame metric family:** subclass `FrameAnalyzer` in `src/probing_qc/qc/analyzers.py`:

```python
class MotionBlurAnalyzer(FrameAnalyzer):
    name, section = "motion", "technical"

    def process(self, frame):              # frame.rgb, frame.index, frame.timestamp_s
        return {"motion_score": ...}       # flat scalars -> per-frame table columns

    def summarize(self, frames, dt):       # frames: DataFrame of all analysers' columns
        return {"motion": summarize(frames.motion_score)}
```

Register it in `build_analyzers()`. Its summary is merged into `report[section]`.

**Better hand-object contact:** implement `InteractionDetector.in_contact(hand, frame) -> bool` (see `interaction.py`), for example with the 100DOH hand-object detector or EgoHOS. Pass it to `HandAnalyzer(cfg.hands, interaction=MyDetector())`. All the `HOI_pct` and grasp metrics then use it unchanged.

**Rules for changes:**
- Keep metric functions pure (array in, number out) and unit-test them in `tests/test_qc_units.py`.
- Put new thresholds in `config.py`, never inline.
- Bump `SCHEMA_VERSION` in `pipeline.py` when you rename or remove report fields.
