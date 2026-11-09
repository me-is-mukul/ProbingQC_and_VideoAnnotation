import type { JobOptions } from "@/lib/shared/types";

/** A process to start: no shell is involved, so arguments are never re-parsed. */
export interface Command {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface PipelineCommandInput {
  pythonBin: string;
  pipelineRoot: string;
  jobDir: string;
  /** Exactly one of a local video path or a URL to download. */
  video?: string;
  url?: string;
  options: JobOptions;
}

/** Build the `python -m probing_qc.cli.job ...` invocation for a job. Pure. */
export function buildPipelineCommand(input: PipelineCommandInput): Command {
  if ((input.video === undefined) === (input.url === undefined)) {
    throw new Error("Exactly one of video or url is required");
  }
  const args = ["-m", "probing_qc.cli.job", "--job-dir", input.jobDir];
  if (input.video !== undefined) args.push("--video", input.video);
  else args.push("--url", input.url!);

  const o = input.options;
  if (o.frameStride !== undefined) args.push("--stride", String(o.frameStride));
  if (o.startS !== undefined) args.push("--start", String(o.startS));
  if (o.maxSeconds !== undefined) args.push("--max-seconds", String(o.maxSeconds));
  if (!o.hands) args.push("--no-hands");
  if (!o.imu) args.push("--no-imu");

  return {
    command: input.pythonBin,
    args,
    cwd: input.pipelineRoot,
    env: {
      PYTHONUNBUFFERED: "1",       // events arrive as they happen
      PYTHONIOENCODING: "utf-8",   // "m/s²" must survive a Windows console codepage
      GLOG_minloglevel: "2",       // quiet MediaPipe
      TF_CPP_MIN_LOG_LEVEL: "2",
    },
  };
}
