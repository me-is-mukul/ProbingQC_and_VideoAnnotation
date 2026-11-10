# Probing QC: web interface

A Next.js (App Router) and TypeScript front end for the probing QC pipeline. It has three tabs:

| Tab | Status |
|---|---|
| **QC** | Upload a video or paste a link. The pipeline (metadata → IMU → video QC) runs on the server, an on-screen terminal streams every step live, and the results appear as charts below the video. **Probing:** drag a line on any image or hand chart to select what to remove; the figures update for the part that is kept, a red timeline shows what will be cut, and the page writes the ffmpeg command (exact or lossless) plus a matching cut of the IMU data. |
| **Annotation** | Placeholder ("under working") |
| **Visualisations** | Placeholder ("under working") |

The design is dark-only: black, orange `#FF4D00`, greys and white, with system fonts and short ease-out animations. Animations are disabled when the user has reduced motion turned on.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for how the pieces fit together and why work is split between server and browser the way it is (GCP cost). See **[tests/MANUAL_TESTING.md](tests/MANUAL_TESTING.md)** for the manual test checklist.

## Prerequisites

- **Node.js** 20.9 or newer (validated on 22.17)
- **The Python pipeline** installed in the repo's venv (see the root [README](../README.md)): `pip install -r requirements.txt && pip install -e ".[dev]"`
- **FFmpeg** (`ffmpeg`, `ffprobe`) on `PATH`

## Run it

```bash
cd frontend
npm ci                       # exact versions from package-lock.json
cp .env.example .env.local   # optional; the defaults work for this repo layout
npm run dev                  # http://localhost:3000

npm run build && npm start   # production
```

`GET /api/health` reports configuration problems, for example a missing Python interpreter. The QC tab shows them as a banner.

## Configuration (`.env.local`)

| Variable | Default | Meaning |
|---|---|---|
| `PIPELINE_ROOT` | `..` | Repo root containing `src/probing_qc` |
| `PYTHON_BIN` | `<root>/venv/Scripts/python.exe` (Windows), `<root>/venv/bin/python` | Interpreter with `probing_qc` installed |
| `DATA_DIR` | `./.data` | Uploads and job folders (git-ignored) |
| `MAX_UPLOAD_BYTES` | 20 GiB | Upload size limit |
| `MAX_CONCURRENT_JOBS` | 1 | Jobs processed at once; the rest wait in a queue |
| `ALLOW_PRIVATE_URLS` | `false` | Allow links to localhost or private networks (SSRF guard) |

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` / `npm start` | Production build (`output: "standalone"`) and server |
| `npm test` | All Vitest tests. They include a Python integration test, which is skipped when the venv or FFmpeg is missing. |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Next.js core-web-vitals and TypeScript rules) |
| `npm run check` | typecheck + lint + test, for CI |

## Layout

```
src/
├── app/                         routes (thin: no logic beyond wiring)
│   ├── qc/ annotation/ visualisations/   the three tabs
│   └── api/                     route handlers → lib/server
│       ├── uploads/             PUT   raw-body upload, streamed to disk
│       ├── jobs/                POST  start a job
│       └── jobs/[id]/           GET status · DELETE cancel · events (SSE) · results · video (Range)
│                                · frames (per-frame CSV) · probe/imu (POST: IMU CSV minus removed time)
├── lib/
│   ├── shared/                  isomorphic: types, event parser, validation, formatting, SSE codec
│   ├── server/                  server only: config, paths, job store/queue/service, process runner, uploads
│   └── client/                  browser API client (fetch + XHR upload progress)
├── features/qc/                 the QC tab
│   ├── state/                   pure reducer (session), terminal lines, options, URL state
│   ├── components/              SourceForm, UploadDropzone, OptionsPanel, StageTracker, PipelineTerminal, VideoStage
│   ├── results/                 ResultsDashboard + one component per section, chart definitions, pure selectors
│   ├── probe/                   probing: lines reducer, plan, keyframes, metric port, ffmpeg command, panel, timeline
│   └── QCWorkspace.tsx          the only component with side effects
├── components/                  reusable UI: layout, ui primitives, charts (SVG, no chart library)
├── hooks/                       useJobEvents (SSE), useElementWidth
└── config/navigation.ts         the tab list
tests/                           fixtures, test doubles, Python integration test, MANUAL_TESTING.md
```

Tests sit next to the code they cover (`*.test.ts[x]`). Component tests opt into jsdom with a `/** @vitest-environment jsdom */` docblock; everything else runs in Node.

## Conventions

- **Server and client stay separate.** `lib/server/**` imports `server-only`, and ESLint forbids importing it outside `app/api` and other server modules.
- **Logic lives in pure functions** (`lib/shared`, `features/*/state`, `features/*/results/selectors.ts`, `components/charts/scales.ts`). Components render and wire; they don't compute. New logic needs a unit test.
- **Validation is shared.** The browser validates for instant feedback, and the API validates again with the same functions as the authority.
- **Every chart has a table view**, and a legend whenever it shows two or more series. Series colours come from `components/charts/palette.ts` in fixed order. That palette is validated for colour-vision deficiency (CVD), so don't add colours ad hoc.
- **Contract changes** to events or `results.json` need matching changes in Python and TypeScript. See [../docs/job.md](../docs/job.md).
- **Metric changes** in Python (image or hand metrics) need the probe port updated: regenerate `tests/fixtures/probe-parity.json` with `python tests/probe_parity.py` (from the repo root) and make `npm test` pass. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#probing).
