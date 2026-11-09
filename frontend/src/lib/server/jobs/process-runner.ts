import "server-only";

import { spawn } from "node:child_process";

import { LineSplitter } from "./line-splitter";
import type { Command } from "./pipeline-command";

export interface ProcessExit {
  exitCode: number | null;
  signal: string | null;
  /** Set when the process could not be started at all (e.g. interpreter missing). */
  spawnError?: string;
}

export interface ProcessHandlers {
  onStdoutLine(line: string): void;
  onStderrLine(line: string): void;
}

export interface ProcessHandle {
  readonly pid: number | undefined;
  /** Stop the process and its children. Safe to call more than once. */
  kill(): void;
  readonly exited: Promise<ProcessExit>;
}

/** Starts external processes. Swap for a stub in tests, or a Cloud Run Jobs client in production. */
export interface ProcessRunner {
  start(command: Command, handlers: ProcessHandlers): ProcessHandle;
}

export class SpawnProcessRunner implements ProcessRunner {
  start(cmd: Command, handlers: ProcessHandlers): ProcessHandle {
    const child = spawn(cmd.command, cmd.args, {
      cwd: cmd.cwd,
      env: { ...process.env, ...cmd.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const out = new LineSplitter();
    const err = new LineSplitter();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => out.push(chunk).forEach(handlers.onStdoutLine));
    child.stderr.on("data", (chunk: string) => err.push(chunk).forEach(handlers.onStderrLine));

    const exited = new Promise<ProcessExit>((resolve) => {
      let settled = false;
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        resolve({ exitCode: null, signal: null, spawnError: error.message });
      });
      child.once("close", (code, signal) => {
        if (settled) return;
        settled = true;
        out.flush().forEach(handlers.onStdoutLine);
        err.flush().forEach(handlers.onStderrLine);
        resolve({ exitCode: code, signal });
      });
    });

    let killed = false;
    return {
      pid: child.pid,
      exited,
      kill: () => {
        if (killed || child.exitCode !== null || child.pid === undefined) return;
        killed = true;
        killTree(child.pid, () => child.kill("SIGTERM"));
      },
    };
  }
}

/**
 * Kill a process together with the FFmpeg child it spawned. On Windows a plain kill only
 * ends the parent, so `taskkill /T` is used; elsewhere SIGTERM reaches Python, whose
 * FrameSampler terminates FFmpeg as the pipe closes.
 */
function killTree(pid: number, fallback: () => void): void {
  if (process.platform !== "win32") {
    fallback();
    return;
  }
  const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  killer.once("error", fallback);
}
