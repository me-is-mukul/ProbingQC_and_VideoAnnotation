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
   └─ on job:succeeded ── GET /api/jobs/:id/results ─▶ results.json (~100–300 KB, cached immutable)
                              ▼
                         ResultsDashboard (selectors → SVG charts), video stays on screen
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
| Progress | **SSE** (one long-lived request) with a 15 s heartbeat | No polling traffic. Reconnects resume with `Last-Event-ID`, so nothing is re-sent. |
| Static pages (`/qc`, `/annotation`, `/visualisations`) | Prerendered at build time | CDN-cacheable, no compute per view |
| Results JSON | `Cache-Control: private, max-age=31536000, immutable` | A revisit is free; it is immutable once the job has finished. |

Concurrency is capped (`MAX_CONCURRENT_JOBS`, default 1) because video QC saturates the CPU. Running jobs in parallel on one instance makes all of them slower and costs more in total.

### Deploying on GCP

The current implementation keeps state on local disk and in one Node process. That suits a single VM, or a single Cloud Run instance with **CPU always allocated**, `max-instances=1`, and `DATA_DIR` on a mounted volume. Request-scoped CPU would throttle a job that is still running after the request that started it returned. To scale out:

1. Replace `FileJobStore` with a database-backed `JobStore` and `EventHub` with Pub/Sub.
2. Replace `SpawnProcessRunner` with a runner that launches a **Cloud Run Job** (the same container running `probing-job`), which streams its stdout events to Pub/Sub.
3. Upload directly to GCS with signed URLs, so video bytes never pass through the web tier.

The interfaces above are the seams; the routes, the client and the event contract stay unchanged.

## State on the client

`features/qc/state/session.ts` is a pure reducer with phases `idle → uploading → queued → processing → loadingResults → done | failed | cancelled`. It ignores events whose `seq` it has already applied (reconnect replays) and events that arrive after a reset. `QCWorkspace.tsx` is the only component with side effects: XHR upload, job creation, EventSource, results fetch, video seeking, and the `?job=<id>` address-bar state. That state makes a page reload or a shared link reopen a job by replaying its events.

## Security

- **SSRF:** links to localhost, private IPv4/IPv6 ranges and the GCP metadata host are rejected unless `ALLOW_PRIVATE_URLS=true`. This is a literal hostname check; for untrusted users, also restrict egress at the network layer (DNS rebinding).
- **Paths:** ids must be UUID v4; upload file names are sanitised to one safe segment; all paths go through `DataPaths`.
- **Processes:** arguments are passed as an array (no shell), and URLs are one argument.
- **Uploads:** only `.mp4` and `.mov`, size-limited while streaming, and partial files are deleted.
- **Headers:** `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`. Error responses never include stack traces.
- **No authentication yet.** Put the app behind IAP or the company SSO before exposing it.

## Charts

The charts are hand-rolled SVG (`components/charts/`) with no chart library: a small bundle and full control. Scales, ticks, paths and nearest-point lookup in `scales.ts` are pure and unit-tested. The visual rules come from the dataviz guidance:

- Thin 2 px lines and hairline grids, with one y-axis per chart (small multiples, never dual axes).
- A legend for two or more series; direct end labels only when they don't collide.
- A crosshair tooltip that lists every series, keyboard navigation, and a polite live region.
- A table view on every chart.
- Status shown as icon + label, never colour alone.

The three series colours (`#FF4D00`, `#3987E5`, `#199E70`) passed the palette validator on the `#111111` chart surface (all-pairs CVD ΔE ≥ 12, contrast ≥ 3:1). A fourth series must be folded or faceted, not given a new hue.
