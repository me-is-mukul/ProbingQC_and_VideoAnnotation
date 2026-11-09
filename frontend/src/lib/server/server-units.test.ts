import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { defaultPythonBin, loadConfig } from "./config";
import { DataPaths } from "./data-paths";
import { EventHub } from "./jobs/event-hub";
import { JobQueue } from "./jobs/job-queue";
import { LineSplitter } from "./jobs/line-splitter";
import { buildPipelineCommand } from "./jobs/pipeline-command";
import { contentRange, parseRange } from "./range";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("loadConfig", () => {
  it("applies defaults relative to cwd", () => {
    const cfg = loadConfig({}, "/app/frontend", "linux");
    expect(cfg.pipelineRoot).toBe(path.resolve("/app"));
    expect(cfg.pythonBin).toBe(path.join(path.resolve("/app"), "venv", "bin", "python"));
    expect(cfg.dataDir).toBe(path.resolve("/app/frontend/.data"));
    expect(cfg.maxConcurrentJobs).toBe(1);
    expect(cfg.allowPrivateUrls).toBe(false);
  });

  it("reads overrides", () => {
    const cfg = loadConfig({ MAX_CONCURRENT_JOBS: "3", ALLOW_PRIVATE_URLS: "true", DATA_DIR: "/data", MAX_UPLOAD_BYTES: "100" }, "/app/frontend", "linux");
    expect(cfg).toMatchObject({ maxConcurrentJobs: 3, allowPrivateUrls: true, maxUploadBytes: 100 });
    expect(cfg.dataDir).toBe(path.resolve("/data"));
  });

  it.each(["0", "-1", "1.5", "lots"])("rejects MAX_CONCURRENT_JOBS=%s", (value) => {
    expect(() => loadConfig({ MAX_CONCURRENT_JOBS: value }, "/app", "linux")).toThrow(/MAX_CONCURRENT_JOBS/);
  });

  it("uses the Windows venv layout on win32", () => {
    expect(defaultPythonBin("C:\\repo", "win32")).toMatch(/venv[\\/]Scripts[\\/]python\.exe$/);
  });
});

describe("DataPaths", () => {
  const paths = new DataPaths(path.resolve("/data"));

  it("builds job and upload paths from valid ids", () => {
    expect(paths.jobFile(ID, "events.jsonl")).toBe(path.join(path.resolve("/data"), "jobs", ID, "events.jsonl"));
    expect(paths.uploadDir(ID)).toBe(path.join(path.resolve("/data"), "uploads", ID));
  });

  it.each(["..", "../uploads", `${ID}/../x`, ""])("refuses id %j", (id) => {
    expect(() => paths.jobDir(id)).toThrow(/Invalid id/);
  });

  it("keeps relative paths inside the job folder", () => {
    expect(paths.insideJob(ID, "outputs/x.json")).toBe(path.join(paths.jobDir(ID), "outputs", "x.json"));
    expect(() => paths.insideJob(ID, "../other")).toThrow(/escapes/);
  });
});

describe("parseRange", () => {
  it.each([
    [null, 100, null],
    ["", 100, null],
    ["items=0-5", 100, null],
    ["bytes=-", 100, null],
    ["bytes=0-9", 100, { start: 0, end: 9 }],
    ["bytes=90-", 100, { start: 90, end: 99 }],
    ["bytes=90-500", 100, { start: 90, end: 99 }],
    ["bytes=-10", 100, { start: 90, end: 99 }],
    ["bytes=-500", 100, { start: 0, end: 99 }],
    ["bytes=0-1,5-6", 100, { start: 0, end: 1 }],
    ["bytes=100-", 100, "unsatisfiable"],
    ["bytes=9-3", 100, "unsatisfiable"],
    ["bytes=-0", 100, "unsatisfiable"],
    ["bytes=0-", 0, "unsatisfiable"],
  ])("%j of %d bytes", (header, size, expected) => {
    expect(parseRange(header as string | null, size)).toEqual(expected);
  });

  it("formats Content-Range", () => {
    expect(contentRange({ start: 0, end: 9 }, 100)).toBe("bytes 0-9/100");
  });
});

describe("LineSplitter", () => {
  it("splits on \\n, \\r\\n and lone \\r across chunk boundaries", () => {
    const s = new LineSplitter();
    expect(s.push("a\nb")).toEqual(["a"]);
    expect(s.push("c\r")).toEqual([]);            // could be the start of \r\n
    expect(s.push("\nd\re\n\n")).toEqual(["bc", "d", "e"]);
    expect(s.push("tail")).toEqual([]);
    expect(s.flush()).toEqual(["tail"]);
    expect(s.flush()).toEqual([]);
  });

  it("caps runaway lines", () => {
    const s = new LineSplitter(4);
    expect(s.push("abcdefghij")).toEqual(["abcd", "efgh"]);
    expect(s.flush()).toEqual(["ij"]);
  });

  it("handles multi-byte text untouched", () => {
    const s = new LineSplitter();
    expect(s.push("units m/s²\n")).toEqual(["units m/s²"]);
  });
});

describe("buildPipelineCommand", () => {
  const base = { pythonBin: "/venv/bin/python", pipelineRoot: "/repo", jobDir: "/data/jobs/x" };

  it("builds a local-video command with options", () => {
    const cmd = buildPipelineCommand({ ...base, video: "/data/up/a.mp4", options: { frameStride: 8, startS: 0, maxSeconds: 60, hands: false, imu: true } });
    expect(cmd.command).toBe("/venv/bin/python");
    expect(cmd.cwd).toBe("/repo");
    expect(cmd.args).toEqual([
      "-m", "probing_qc.cli.job", "--job-dir", "/data/jobs/x", "--video", "/data/up/a.mp4",
      "--stride", "8", "--start", "0", "--max-seconds", "60", "--no-hands",
    ]);
    expect(cmd.env).toMatchObject({ PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" });
  });

  it("passes URLs as a single argument (no shell, no splitting)", () => {
    const url = "https://x.org/a b.mp4?x=1&y=$(rm -rf)";
    const cmd = buildPipelineCommand({ ...base, url, options: { hands: true, imu: false } });
    expect(cmd.args).toEqual(["-m", "probing_qc.cli.job", "--job-dir", "/data/jobs/x", "--url", url, "--no-imu"]);
  });

  it("requires exactly one source", () => {
    expect(() => buildPipelineCommand({ ...base, options: { hands: true, imu: true } })).toThrow();
    expect(() => buildPipelineCommand({ ...base, video: "a", url: "b", options: { hands: true, imu: true } })).toThrow();
  });
});

describe("JobQueue", () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("runs at most `concurrency` tasks, in FIFO order", async () => {
    const q = new JobQueue(1);
    const order: string[] = [];
    const a = deferred();
    const b = deferred();
    q.enqueue("a", async () => {
      order.push("a");
      await a.promise;
    });
    q.enqueue("b", async () => {
      order.push("b");
      await b.promise;
    });
    expect(order).toEqual(["a"]);
    expect([q.runningCount, q.pendingCount, q.position("b")]).toEqual([1, 1, 1]);
    a.resolve();
    await vi.waitFor(() => expect(order).toEqual(["a", "b"]));
    b.resolve();
    await vi.waitFor(() => expect(q.runningCount).toBe(0));
  });

  it("removes pending tasks but not running ones", () => {
    const q = new JobQueue(1);
    q.enqueue("a", () => new Promise(() => {}));
    q.enqueue("b", async () => {});
    expect(q.remove("a")).toBe(false);
    expect(q.remove("b")).toBe(true);
    expect(q.remove("zzz")).toBe(false);
  });

  it("keeps draining after a task throws", async () => {
    const q = new JobQueue(1);
    const ran: string[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    q.enqueue("a", async () => {
      throw new Error("boom");
    });
    q.enqueue("b", async () => {
      ran.push("b");
    });
    await vi.waitFor(() => expect(ran).toEqual(["b"]));
  });

  it("rejects a non-positive concurrency", () => {
    expect(() => new JobQueue(0)).toThrow();
  });
});

describe("EventHub", () => {
  const event = { v: 1, t: 1, seq: 1, type: "log", level: "info", logger: "", message: "x" } as const;

  it("delivers to subscribers of that job only, until unsubscribed", () => {
    const hub = new EventHub();
    const a = vi.fn();
    const b = vi.fn();
    const off = hub.subscribe("job-a", a);
    hub.subscribe("job-b", b);
    hub.publish("job-a", event);
    off();
    hub.publish("job-a", event);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(hub.listenerCount("job-a")).toBe(0);
  });

  it("isolates a throwing listener", () => {
    const hub = new EventHub();
    const good = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hub.subscribe("j", () => {
      throw new Error("bad listener");
    });
    hub.subscribe("j", good);
    hub.publish("j", event);
    expect(good).toHaveBeenCalledOnce();
  });
});
