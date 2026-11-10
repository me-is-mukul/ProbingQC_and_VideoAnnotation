# Architecture

## Request flow

```
Browser (QC tab)                         Next.js server (Node)                      Python
────────────────                         ─────────────────────                      ──────
SourceForm ─ file ──PUT /api/uploads──▶ UploadStore: stream body → .data/uploads/<id>/
           └ link ─────────┐
                           ▼
          POST /api/jobs ─────────────▶ JobService.create ─▶ JobStore (job.json)
                                         │                └▶ JobQueue (≤ MAX_CONCURRENT_JOBS)
                                         ▼
                                         SpawnProcessRunner ── python -m probing_qc.cli.job ──▶ download│probe│imu│qc│results
                                         │◀──────────── stdout: JSON Lines events ───────────────┘
                                         ▼
                                         parseEventLine → JobStore.appendEvent (seq) → EventHub.publish
                                                                                │
EventSource ◀── GET /api/jobs/:id/events (SSE: replay from Last-Event-ID, then live) ◀┘
   │
   ▼  sessionReducer (pure) → StageTracker + PipelineTerminal
   │
   └─ on job:succeeded ── GET /api/jobs/:id/results ─▶ results.json (~100–300 KB, gzip, cached immutable)
                              ▼
                         ResultsDashboard (selectors → SVG charts), video stays on screen
                              │
                              └─ GET /api/jobs/:id/frames ─▶ per-frame CSV (gzip, cached immutable)
                                   ▼
                              probing in the browser: lines → plan → metrics + ffmpeg command
                                   │
                                   └─ POST /api/jobs/:id/probe/imu {removed} ─▶ IMU CSV minus the red parts (streamed)
```

## Modules and their seams

| Module | Responsibility | Swap point for scale-out |
|---|---|---|
| `lib/server/config.ts` | Environment → typed config (`loadConfig` is pure) | — |
| `lib/server/data-paths.ts` | Every disk path; rejects ids that aren't UUIDs | — |
| `lib/server/uploads/upload-store.ts` | Streams uploads to disk with a byte limit; `.part` then rename | Signed-URL uploads straight to GCS |
| `lib/server/jobs/job-store.ts` | `JobStore` interface; `FileJobStore` (atomic `job.json`, append-only `events.jsonl`, serialised per job) | Firestore / Cloud SQL |
| `lib/server/jobs/event-hub.ts` | In-process pub/sub for live events | Pub/Sub / Redis |
| `lib/server/jobs/job-queue.ts` | FIFO with a concurrency limit | Cloud Tasks |
| `lib/server/jobs/process-runner.ts` | `ProcessRunner` interface; `SpawnProcessRunner` (no shell; kills the process tree on Windows) | Cloud Run Jobs / Batch |
| `lib/server/jobs/pipeline-command.ts` | Builds the Python argv (pure) | — |
| `lib/server/jobs/job-service.ts` | Lifecycle: queued → running → succeeded / failed / cancelled; records then broadcasts | — |
| `lib/server/jobs/event-stream.ts` | SSE stream: replay, live, de-duplicate by `seq`, heartbeat, close on terminal event | — |
| `lib/server/container.ts` | The only place concrete classes are chosen (one per process, survives dev reloads) | Wire the replacements here |
| `lib/server/compress.ts` | gzip for API responses (Next.js compresses pages, not route handlers) | A CDN or load balancer can take over |
| `lib/server/probe/imu-filter.ts` | Streams the IMU CSV without the removed intervals, adding `probed_time_s` | — |

Every route handler is a few lines that validate input and call one service method.

## Where work runs, and why (GCP cost)

Cloud Run bills CPU-seconds and memory while requests are in flight, plus network egress. The split follows from that:

| Work | Runs on | Reason |
|---|---|---|
| Video decoding, IMU parsing, MediaPipe, statistics | **Server (Python)**, once per job | It needs FFmpeg and the models, and is the only heavy step. Each frame is decoded once, GPMF is read once and reused for orientation, and the analysis stride is user-tunable. |
| Downsampling 970k IMU rows and the per-frame table into chart series | **Server (Python, numpy)** | Milliseconds of CPU, and it shrinks the payload from more than 60 MB of CSV to about 300 KB of JSON. Egress is the expensive part, not CPU. |
| Chart rendering, smoothing, tooltips, table views, formatting | **Browser** | Free for us; the pages are static, and there's no server-side rendering per request. |
| Video playback | **Browser**, from the user's own file (blob URL) or the link's origin | Streaming a multi-GB video back from our server would be the single largest egress cost. `/api/jobs/:id/video` is only a fallback, used when the origin can't be played or for a reopened upload. |
| Report download | **Browser**, from the results already in memory | No second request |
| Probing: lines, intersection, metrics of the kept part, timeline, ffmpeg command, plan file | **Browser** | Runs on every drag; a server round trip per drag would cost CPU-seconds and feel slow. The numbers are a port of the Python metrics, checked against Python outputs in CI. |
| Frame table for probing | **Server streams the CSV the job already wrote**, gzip | About 110 bytes per analysed frame before compression (≈ 27 KB gzip-encoded to 9 KB for 300 frames), fetched once per results view and cached immutable. Nothing is recomputed. |
| Probed IMU CSV | **Server**, streamed row by row on request | The full IMU table is tens of MB, so it never goes to the browser unless asked for; nothing is stored. |
| Cutting the video | **The user's machine** (the generated ffmpeg command) | Our servers never re-encode or serve the cut video. |
| Progress | **SSE** (one long-lived request) with a 15 s heartbeat | No polling traffic. Reconnects resume with `Last-Event-ID`, so nothing is re-sent. |
| Static pages (`/qc`, `/annotation`, `/visualisations`) | Prerendered at build time | CDN-cacheable, no compute per view |
| Results JSON | gzip (about 3× smaller) and `Cache-Control: private, max-age=31536000, immutable` | A revisit is free; it is immutable once the job has finished. Route handlers are compressed by `compress.ts`; Next.js only compresses pages. |

Concurrency is capped (`MAX_CONCURRENT_JOBS`, default 1) because video QC saturates the CPU. Running jobs in parallel on one instance makes all of them slower and costs more in total.

### Deploying on GCP

The current implementation keeps state on local disk and in one Node process. That suits a single VM, or a single Cloud Run instance with **CPU always allocated**, `max-instances=1`, and `DATA_DIR` on a mounted volume. Request-scoped CPU would throttle a job that is still running after the request that started it returned. To scale out:

1. Replace `FileJobStore` with a database-backed `JobStore` and `EventHub` with Pub/Sub.
2. Replace `SpawnProcessRunner` with a runner that launches a **Cloud Run Job** (the same container running `probing-job`), which streams its stdout events to Pub/Sub.
3. Upload directly to GCS with signed URLs, so video bytes never pass through the web tier.

The interfaces above are the seams; the routes, the client and the event contract stay unchanged.

## Probing

Each image and hand chart has a draggable line, with a switch for which side it selects (below, the default, or above). The plan is built in `features/qc/probe/` from pure modules:

| Step | Module | Rule |
|---|---|---|
| Chart values | `results/chart-data.ts` | One definition per chart. The sections draw these values and the plan selects on the same arrays, so what is under a line on screen is exactly what is selected. Hand charts are one chart per hand. |
| Chart point → frames | `probe/selection.ts` | A point is one preview bucket: from its first analysed frame to the next point's first analysed frame (each analysed frame stands for the `stride − 1` frames after it). Frame numbers come from the frames CSV. |
| Selection | `probe/selection.ts` | Strictly below / above the line. A missing value is never selected. |
| Plan | `probe/plan.ts` | Removed = intersection of the selections of every *active* line (an untouched line takes no part). Everything is in integer frame numbers. Time outside the analysed window is always kept. |
| Lossless mode | `probe/keyframes.ts` | Kept parts start on the next keyframe, so more is removed, never less. Disabled for videos with B-frames and for results without a keyframe index (1.0). |
| Metrics of the kept part | `probe/metrics.ts`, `numeric.ts`, `stats.ts` | Port of the Python image and hand metrics, including numpy's pairwise summation and percentile interpolation and CPython's rounding. `frontend/tests/fixtures/probe-parity.json` is generated by `tests/probe_parity.py` from the real Python functions, and the TypeScript must match it exactly. The CSV stores 4 decimals, so a frame within 0.00005 of a threshold could count differently from the report. With no line set, the page shows the report's own figures. |
| Command | `probe/ffmpeg-command.ts` | Exact: `split` → `trim` by frame number / `atrim` by time → `concat`, re-encoded (H.264 CRF 18, AAC); graphs over 3,000 characters go into a script file read with `-/filter_complex` (ffmpeg 7.0+). `aselect` is avoided: in ffmpeg 8.0.1 it passes every audio frame. Lossless: an ffconcat list with `inpoint` rounded up and `outpoint` rounded down to the microsecond. |
| IMU | `lib/shared/probe/imu.ts` | A sample is removed when its `timestamp_s` (seconds since the recording started) falls in a removed interval; kept rows get `probed_time_s`. Refused for trimmed clips, whose IMU clock doesn't start with the video. |

Verified on GoPro HEVC with ffmpeg 8.0.1 (`tests/integration/probe.integration.test.ts` repeats it on a synthetic clip): the exact output has exactly the planned number of frames and each frame at a cut is the planned source frame; every frame of the lossless output is bit-identical to the planned source frame.

## State on the client

`features/qc/state/session.ts` is a pure reducer with phases `idle → uploading → queued → processing → loadingResults → done | failed | cancelled`. It ignores events whose `seq` it has already applied (reconnect replays) and events that arrive after a reset. `QCWorkspace.tsx` is the only component with side effects: XHR upload, job creation, EventSource, results fetch, video seeking, and the `?job=<id>` address-bar state. That state makes a page reload or a shared link reopen a job by replaying its events.

## Security

- **SSRF:** links to localhost, private IPv4/IPv6 ranges and the GCP metadata host are rejected unless `ALLOW_PRIVATE_URLS=true`. This is a literal hostname check; for untrusted users, also restrict egress at the network layer (DNS rebinding).
- **Paths:** ids must be UUID v4; upload file names are sanitised to one safe segment; all paths go through `DataPaths`.
- **Processes:** arguments are passed as an array (no shell), and URLs are one argument.
- **Uploads:** only `.mp4` and `.mov`, size-limited while streaming, and partial files are deleted.
- **Headers:** `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`. Error responses never include stack traces.
- **Probing:** output paths come from the job's own `results.json` and are confined to the job folder. Removed-interval lists are validated (sorted, disjoint, ≤ 100,000, body ≤ 8 MB). The generated command quotes only names that are literal inside double quotes in bash, PowerShell and cmd.exe, and otherwise asks the user to rename the file to `input.mp4`.
- **No authentication yet.** Put the app behind IAP or the company SSO before exposing it.

## Charts

The charts are hand-rolled SVG (`components/charts/`) with no chart library: a small bundle and full control. Scales, ticks, paths and nearest-point lookup in `scales.ts` are pure and unit-tested. The visual rules come from the dataviz guidance:

- Thin 2 px lines and hairline grids, with one y-axis per chart (small multiples, never dual axes).
- A legend for two or more series; direct end labels only when they don't collide.
- A crosshair tooltip that lists every series, keyboard navigation, and a polite live region.
- A table view on every chart.
- Status shown as icon + label, never colour alone.

The three series colours (`#FF4D00`, `#3987E5`, `#199E70`) passed the palette validator on the `#111111` chart surface (all-pairs CVD ΔE ≥ 12, contrast ≥ 3:1). A fourth series must be folded or faceted, not given a new hue.
