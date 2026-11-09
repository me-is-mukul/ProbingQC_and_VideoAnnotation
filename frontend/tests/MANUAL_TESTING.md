# Frontend manual-testing checklist

These are objectives to verify by hand, with their edge cases. **Auto** shows whether `npm test` already covers the case: ✅ covered, ◐ partly, — manual only. Python-side objectives are in [../../tests/MANUAL_TESTING.md](../../tests/MANUAL_TESTING.md).

## Setup

```bash
cd frontend && npm ci && npm run check      # everything green before you start
npm run build && npm start                  # test the production build, not just dev
```

- **Test videos:**
  - a 2 s synthetic clip: `ffmpeg -f lavfi -i testsrc2=size=320x240:rate=30:duration=2 -c:v libx264 -pix_fmt yuv420p syn.mp4`
  - a short GoPro cut that keeps GPMF: `ffmpeg -ss 600 -t 20 -i GX010140.MP4 -map 0:v:0 -map 0:3 -c copy -copy_unknown -tag:d:0 gpmd clip.mp4`
- **API checks:** use `curl` (examples below) or the browser DevTools Network tab.
- **Reproducibility:** record the commit, `npm ls next react`, browser and version, and `GET /api/health` with every bug report.

---

## 1. Shared logic (`src/lib/shared`)

| # | Objective / edge case | Expected | Auto |
|---|---|---|---|
| 1.1 | Every event type Python emits parses | stage/progress/log/result/error accepted | ✅ |
| 1.2 | Non-JSON stdout, truncated JSON, unknown type, `v: 2`, unknown stage, an array | rejected (`null`), never thrown | ✅ |
| 1.3 | A `job` event printed by Python | rejected: only the server may emit it | ✅ |
| 1.4 | Progress with `total: null` or `0` | fraction `null` (indeterminate bar) | ✅ |
| 1.5 | File names: Windows paths, `../`, reserved characters, tabs, 300 characters, `.txt`, `.mp4` alone | sanitised to one safe segment or rejected; extension kept when truncating | ✅ |
| 1.6 | URL validation: blank, `ftp:`, `file:`, embedded credentials, `localhost`, `10.x`, `169.254.169.254`, `[::1]`, `metadata.google.internal` | rejected (private hosts only when not allowed) | ✅ |
| 1.7 | Hostnames that merely look private (`172.32.0.1`, `example.com`) | accepted | ✅ |
| 1.8 | A DNS name that *resolves* to a private IP | **accepted** (known limitation: the check is literal). Mitigate with egress rules | — |
| 1.9 | Options: `"8"`, `1.5`, `-1`, `Infinity`, `"abc"`, non-boolean `hands` | parsed or rejected with a field-specific message | ✅ |
| 1.10 | Formatting: 0 B, 8.67 GB, `1:21:08`, `0 s`, `130 ms`, `12.9K`, `13.99 Mbit/s`, null → `—` | as listed | ✅ |
| 1.11 | SSE encoding with newlines in data, id or event name | data split into lines; id/event cannot inject fields | ✅ |

## 2. Server modules (`src/lib/server`)

| # | Objective / edge case | Expected | Auto |
|---|---|---|---|
| 2.1 | Config defaults; `MAX_CONCURRENT_JOBS=0`, `-1`, `1.5`, `lots` | defaults applied; invalid values throw at startup | ✅ |
| 2.2 | `PYTHON_BIN` missing or wrong `PIPELINE_ROOT` | `/api/health` → 503 with the problem; QC tab shows a banner | ◐ |
| 2.3 | `DataPaths` with `..`, `id/../x`, empty id | throws; `insideJob("../x")` throws | ✅ |
| 2.4 | Range: none, `bytes=0-9`, open-ended, suffix, past end, reversed, multi-range, size 0 | 200 / 206 / first range / 416 as listed | ✅ |
| 2.5 | Line splitter: `\r\n` split across chunks, lone `\r`, 10 KB line without a newline, UTF-8 `²` | correct lines; runaway lines capped | ✅ |
| 2.6 | Command builder: URL with spaces, `&`, `$(...)` | passed as one argv item, never through a shell | ✅ |
| 2.7 | Queue: FIFO, concurrency 1, a throwing task, removing a running task | next task still runs; remove returns false | ✅ |
| 2.8 | Store: 25 concurrent appends; torn final line after a crash; stray file in `jobs/` | seq 1..25 without gaps; torn line skipped; stray ignored | ✅ |
| 2.9 | Service: success, Python error event, interpreter missing, cancel queued, cancel running, cancel finished (409), results before success (409) | statuses and messages as tested | ✅ |
| 2.10 | Restart the server while a job runs | that job becomes `failed` ("Server restarted") on the next start; the UI shows it | ◐ |
| 2.11 | Upload: header `Content-Length` over the limit; body over the limit; empty; client abort | 413 / 413 / 400 / 499; no files left in `.data/uploads` | ✅ |
| 2.12 | SSE: replay from `Last-Event-ID`; already finished; live with duplicate delivery; client disconnect; heartbeat | exact sequence; closes after the terminal event; unsubscribes | ✅ |
| 2.13 | Two browser tabs watching one job | both receive every event; closing one doesn't affect the other | — |

## 3. API (production build, `curl`)

```bash
B=http://localhost:3000/api
curl -s $B/health
curl -s -X PUT --data-binary @syn.mp4 -H "X-File-Name: syn.mp4" $B/uploads           # -> uploadId
curl -s -X POST -H "Content-Type: application/json" -d '{"source":{"kind":"upload","uploadId":"<id>"},"options":{"frameStride":6}}' $B/jobs
curl -N $B/jobs/<job>/events                                                          # watch it run
curl -s -H "Last-Event-ID: 5" -N $B/jobs/<job>/events                                 # resumes at 6
curl -s -D - -o /dev/null -H "Range: bytes=0-99" $B/jobs/<job>/video                   # 206
```

| # | Objective / edge case | Expected | Auto |
|---|---|---|---|
| 3.1 | Full upload → job → SSE → results | stages in order; `results.json` loads | ✅ (integration) |
| 3.2 | `X-File-Name` missing, not URI-encoded, or `notes.txt` | 400 with a clear message | ◐ |
| 3.3 | `POST /api/jobs` with invalid JSON, unknown upload id, private URL, `source.kind: "path"` | 400 / 404 / 400 / 400 | ◐ |
| 3.4 | Malformed job id in any `/api/jobs/:id/*` route | 404, never a filesystem error | ◐ |
| 3.5 | `GET /results` while running | 409 | ✅ |
| 3.6 | Results response headers | `Cache-Control: private, max-age=31536000, immutable`; gzip when the client accepts it | — |
| 3.7 | 4-GB+ upload | memory flat (stream), progress bar moves, file intact (`sha256sum` matches) | — |
| 3.8 | URL job against a 404 link | job `failed`, `error.stage = "download"`, message includes 404 | — |
| 3.9 | URL job against an HTML page (not a video) | fails in `probe` with "No video stream" | — |

## 4. QC tab: input

| # | Objective / edge case | Expected | Auto |
|---|---|---|---|
| 4.1 | Start is disabled until a file or link is given | ✓ | ✅ |
| 4.2 | Drop a `.mkv` or `.txt` | inline error, nothing selected | — |
| 4.3 | Drop several files at once | only the first is taken | — |
| 4.4 | Link mode: `ftp://`, blank, bare text | inline error, no request sent | ✅ |
| 4.5 | Options: "First minute" preset, then clear the field | preset highlight follows the fields | ◐ |
| 4.6 | Options: stride `0`, start `-1` | error under the options, no job created | ✅ |
| 4.7 | Hand tracking off | results have no Hands section; terminal says "hand tracking disabled" | ✅ (render) |
| 4.8 | Keyboard only: tab through segmented control, dropzone, options, Start | all reachable, visible focus ring, arrow keys switch the segment | — |

## 5. QC tab: processing

| # | Objective / edge case | Expected | Auto |
|---|---|---|---|
| 5.1 | Upload progress | Source step active, bar fills, one updating terminal line | ✅ (reducer) |
| 5.2 | Stage tracker | steps turn active → ✓ in order; skipped steps show "–"; the description changes per stage | ✅ |
| 5.3 | Terminal | timestamps, tags, in-place progress line, colour by tone, blinking cursor while live | ◐ |
| 5.4 | Scroll the terminal up during a run | stops following; "Jump to latest" appears and works | — |
| 5.5 | "Native output" toggle | shows or hides raw stderr (MediaPipe/FFmpeg) lines | ✅ |
| 5.6 | Cancel during upload | upload aborted, back to the idle form | — |
| 5.7 | Cancel during processing | Python and FFmpeg processes end (check Task Manager / `ps`); status Cancelled | ◐ |
| 5.8 | Reload the page mid-run (`/qc?job=<id>`) | job reopens; terminal replays from the start; video plays from `/api/jobs/:id/video` | ◐ |
| 5.9 | Drop the network for 30 s mid-run (DevTools offline) | EventSource reconnects; no duplicate or missing lines | — |
| 5.10 | Pipeline failure (corrupt file) | failed stage marked ✕, error message under the tracker, "New analysis" available | ✅ (reducer) |
| 5.11 | Two jobs at once with `MAX_CONCURRENT_JOBS=1` | second shows "Queued behind 1 job" and starts after the first | ✅ (service) |

## 6. QC tab: video and results

| # | Objective / edge case | Expected | Auto |
|---|---|---|---|
| 6.1 | Uploaded video plays from a `blob:` URL (Network tab: no `/video` requests) | ✓ | — |
| 6.2 | HEVC in Firefox / headless | "This browser can't play the video (HEVC)" message; results unaffected | — |
| 6.3 | Click a chart point or press Enter on a focused chart | video seeks there; scrolls into view if off-screen | ✅ (Enter) |
| 6.4 | Playhead line moves on every frame-related chart while the video plays | ✓ | — |
| 6.5 | Trimmed GoPro clip (IMU timestamps start at 600 s) | IMU charts say "original recording time (trimmed clip)" and do not seek | ✅ (selector) |
| 6.6 | Tooltip near the right edge | flips to the left of the crosshair, never clipped | — |
| 6.7 | Table toggle on each chart | shows every point; gaps shown as `—` | ✅ |
| 6.8 | Integrity flags: clean / decode errors / missing frames / no GPMF / failed IMU check | good / critical / warning / neutral / warning, each with icon + text | ✅ |
| 6.9 | Hands: 0/1 per-frame flags | 1 s rolling share, readable trend; legend for two series; end labels only when they don't collide | ✅ (selector) |
| 6.10 | "Download report" | saves `<stem>_qc.json` with no network request | — |
| 6.11 | Very long video (81 min) | about 1500 points per chart; page stays responsive while the video plays | — |

## 7. Layout, motion and accessibility

| # | Objective / edge case | Expected | Auto |
|---|---|---|---|
| 7.1 | 390 px wide (phone) | no horizontal scroll (`scrollWidth == innerWidth`); tabs fit; charts inside their cards | — |
| 7.2 | 1440 px and 2560 px | content capped at 1180 px, centred | — |
| 7.3 | `prefers-reduced-motion: reduce` | no entrance animations, no pulsing dots | — |
| 7.4 | Screen reader on a chart | group label explains the keys; values announced via the live region | ◐ |
| 7.5 | Tabs: active pill slides; `aria-current="page"` on the active tab | ✓ | ✅ |
| 7.6 | Annotation / Visualisations | "Under working" placeholder | ✅ |
| 7.7 | Unknown route `/xyz` | 404 page with a link back to QC | — |
| 7.8 | Response headers on pages | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` | — |

## Known limitations to re-check after changes

- Job state lives on local disk and in one Node process. Multi-instance deployment needs the swaps listed in `docs/ARCHITECTURE.md`.
- There is no authentication. Do not expose the app publicly without IAP or SSO.
- The SSRF guard is a literal hostname check.
- Uploaded videos and job folders are never deleted automatically; plan a retention job for `DATA_DIR`.
