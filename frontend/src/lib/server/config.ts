import "server-only";

import fs from "node:fs";
import path from "node:path";

/** Server configuration, read once from the environment (see .env.example). */
export interface ServerConfig {
  /** Repo root containing src/probing_qc. */
  pipelineRoot: string;
  /** Python interpreter with probing_qc installed. */
  pythonBin: string;
  /** Root for uploads/ and jobs/. */
  dataDir: string;
  maxUploadBytes: number;
  maxConcurrentJobs: number;
  allowPrivateUrls: boolean;
  platform: NodeJS.Platform;
}

type Env = Record<string, string | undefined>;

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got "${value}"`);
  return n;
}

export function defaultPythonBin(pipelineRoot: string, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? path.join(pipelineRoot, "venv", "Scripts", "python.exe")
    : path.join(pipelineRoot, "venv", "bin", "python");
}

/** Pure: build the config from an env map (testable without touching process.env). */
export function loadConfig(env: Env, cwd: string, platform: NodeJS.Platform = process.platform): ServerConfig {
  const pipelineRoot = path.resolve(cwd, env.PIPELINE_ROOT || "..");
  return {
    pipelineRoot,
    pythonBin: env.PYTHON_BIN ? path.resolve(cwd, env.PYTHON_BIN) : defaultPythonBin(pipelineRoot, platform),
    dataDir: path.resolve(cwd, env.DATA_DIR || ".data"),
    maxUploadBytes: positiveInt(env.MAX_UPLOAD_BYTES, 20 * 1024 ** 3, "MAX_UPLOAD_BYTES"),
    maxConcurrentJobs: positiveInt(env.MAX_CONCURRENT_JOBS, 1, "MAX_CONCURRENT_JOBS"),
    allowPrivateUrls: env.ALLOW_PRIVATE_URLS === "true",
    platform,
  };
}

/** Problems that would make every job fail; reported by /api/health. */
export function configProblems(cfg: ServerConfig): string[] {
  const problems: string[] = [];
  if (!fs.existsSync(path.join(cfg.pipelineRoot, "src", "probing_qc"))) {
    problems.push(`PIPELINE_ROOT does not contain src/probing_qc: ${cfg.pipelineRoot}`);
  }
  if (!fs.existsSync(cfg.pythonBin)) problems.push(`Python interpreter not found: ${cfg.pythonBin}`);
  return problems;
}

let cached: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  cached ??= loadConfig(process.env, process.cwd());
  return cached;
}
