import "server-only";

import { getConfig, type ServerConfig } from "./config";
import { DataPaths } from "./data-paths";
import { EventHub } from "./jobs/event-hub";
import { JobQueue } from "./jobs/job-queue";
import { JobService } from "./jobs/job-service";
import { FileJobStore } from "./jobs/job-store";
import { SpawnProcessRunner } from "./jobs/process-runner";
import { UploadStore } from "./uploads/upload-store";

/** Process-wide service graph. The only place concrete implementations are chosen. */
export interface Services {
  config: ServerConfig;
  paths: DataPaths;
  uploads: UploadStore;
  jobs: JobService;
  ready: Promise<void>;
}

export function createServices(config: ServerConfig): Services {
  const paths = new DataPaths(config.dataDir);
  const uploads = new UploadStore(paths, config.maxUploadBytes);
  const jobs = new JobService({
    store: new FileJobStore(paths),
    hub: new EventHub(),
    queue: new JobQueue(config.maxConcurrentJobs),
    runner: new SpawnProcessRunner(),
    uploads,
    paths,
    pythonBin: config.pythonBin,
    pipelineRoot: config.pipelineRoot,
  });
  const ready = jobs
    .recoverInterrupted()
    .then((n) => {
      if (n) console.warn(`[jobs] marked ${n} interrupted job(s) as failed`);
    })
    .catch((error) => console.error("[jobs] recovery failed", error));
  return { config, paths, uploads, jobs, ready };
}

// Kept on globalThis so Next's dev-mode module reloads don't create a second job runner.
const globalKey = Symbol.for("probing-qc.services");
type GlobalWithServices = typeof globalThis & { [globalKey]?: Services };

export async function getServices(): Promise<Services> {
  const g = globalThis as GlobalWithServices;
  g[globalKey] ??= createServices(getConfig());
  await g[globalKey].ready;
  return g[globalKey];
}
