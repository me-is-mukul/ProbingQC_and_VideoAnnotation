import { describe, expect, it } from "vitest";

import { isTerminalEvent, parseEventLine, progressFraction, toPipelineEvent } from "./events";
import {
  formatBitrate, formatBytes, formatClock, formatCompact, formatDuration, formatNumber, formatPercent, formatTimecode,
} from "./format";
import { encodeSSE, encodeSSEComment, parseSSE } from "./sse";

// ------------------------------------------------------------------ events

describe("parseEventLine (Python stdout contract)", () => {
  it("parses every event type Python emits", () => {
    const lines = [
      '{"v": 1, "t": 1.5, "type": "stage", "stage": "imu", "status": "done", "message": "ok", "data": {"samples": 3}}',
      '{"v": 1, "t": 1.5, "type": "progress", "stage": "qc", "done": 9, "total": 75, "message": "9/75", "unit": "frames"}',
      '{"v": 1, "t": 1.5, "type": "progress", "stage": "download", "done": 9, "total": null, "message": "9 B"}',
      '{"v": 1, "t": 1.5, "type": "log", "level": "warning", "logger": "imu.checks", "message": "Check gyro_bias: FAIL"}',
      '{"v": 1, "t": 1.5, "type": "result", "path": "results.json", "message": "done"}',
      '{"v": 1, "t": 1.5, "type": "error", "stage": "probe", "message": "Video not found", "error_type": "FileNotFoundError"}',
      '{"v": 1, "t": 1.5, "type": "error", "stage": null, "message": "boom"}',
    ];
    const parsed = lines.map(parseEventLine);
    expect(parsed.every(Boolean)).toBe(true);
    expect(parsed.map((e) => e!.type)).toEqual(["stage", "progress", "progress", "log", "result", "error", "error"]);
  });

  it.each([
    ["not json", "INFO: Created TensorFlow Lite XNNPACK delegate"],
    ["truncated", '{"v": 1, "t": 1, "type": "stage"'],
    ["unknown type", '{"v": 1, "t": 1, "type": "telemetry", "message": "x"}'],
    ["future version", '{"v": 2, "t": 1, "type": "log", "level": "info", "logger": "", "message": "x"}'],
    ["unknown stage", '{"v": 1, "t": 1, "type": "stage", "stage": "render", "status": "start", "message": "x"}'],
    ["bad status", '{"v": 1, "t": 1, "type": "stage", "stage": "qc", "status": "finished", "message": "x"}'],
    ["array", "[1, 2]"],
    ["job from python", '{"v": 1, "t": 1, "type": "job", "status": "succeeded", "message": "x"}'],
  ])("rejects %s", (_name, line) => {
    expect(parseEventLine(line)).toBeNull();
  });

  it("keeps seq when present and drops non-record data", () => {
    const e = toPipelineEvent({ v: 1, t: 1, seq: 7, type: "stage", stage: "qc", status: "start", message: "m", data: [1] });
    expect(e).toMatchObject({ seq: 7 });
    expect(e).not.toHaveProperty("data");
  });

  it("recognises terminal job events only", () => {
    expect(isTerminalEvent({ v: 1, t: 1, type: "job", status: "succeeded", message: "" })).toBe(true);
    expect(isTerminalEvent({ v: 1, t: 1, type: "job", status: "running", message: "" })).toBe(false);
    expect(isTerminalEvent({ v: 1, t: 1, type: "result", path: "r", message: "" })).toBe(false);
  });

  it("computes clamped progress fractions", () => {
    expect(progressFraction(5, 10)).toBe(0.5);
    expect(progressFraction(12, 10)).toBe(1);
    expect(progressFraction(5, null)).toBeNull();
    expect(progressFraction(5, 0)).toBeNull();
  });
});

// ------------------------------------------------------------------ format

describe("format", () => {
  it("bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1500)).toBe("1.50 KB");
    expect(formatBytes(8_669_285_837)).toBe("8.67 GB");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(null)).toBe("—");
  });

  it("timecode and duration", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(61.9)).toBe("1:01");
    expect(formatTimecode(4868.86)).toBe("1:21:08");
    expect(formatTimecode(Number.NaN)).toBe("—");
    expect(formatTimecode(4.137467, 2)).toBe("0:04.13");   // truncated, never later than the time
    expect(formatTimecode(4.14, 2)).toBe("0:04.14");       // 413.99999999999994 in floats
    expect(formatTimecode(3599.99, 1)).toBe("59:59.9");
    expect(formatTimecode(3600.05, 1)).toBe("1:00:00.0");
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(0.13)).toBe("130 ms");
    expect(formatDuration(12.44)).toBe("12.4 s");
    expect(formatDuration(185)).toBe("3 min 05 s");
    expect(formatDuration(4868.86)).toBe("1 h 21 min");
  });

  it("numbers, compact, percent, bitrate", () => {
    expect(formatNumber(970019)).toBe("970,019");
    expect(formatNumber(1.005, 2)).toBe("1.01");
    expect(formatCompact(1284)).toBe("1,284");
    expect(formatCompact(12_900)).toBe("12.9K");
    expect(formatCompact(4_200_000)).toBe("4.2M");
    expect(formatPercent(62.16)).toBe("62.2%");
    expect(formatBitrate(13988)).toBe("13.99 Mbit/s");
    expect(formatBitrate(850)).toBe("850 kbit/s");
    expect(formatBitrate(null)).toBe("—");
  });

  it("clock in an explicit time zone", () => {
    expect(formatClock(0, "UTC")).toBe("00:00:00");
  });
});

// ------------------------------------------------------------------ sse

describe("sse", () => {
  it("round-trips messages, including multi-line data", () => {
    const text = encodeSSE({ id: 3, data: "line1\nline2" }) + encodeSSEComment() + encodeSSE({ event: "x", data: "{}", retry: 1500 });
    expect(parseSSE(text)).toEqual([
      { id: "3", data: "line1\nline2" },
      { event: "x", retry: 1500, data: "{}" },
    ]);
  });

  it("cannot be broken by newlines in id or event names", () => {
    const text = encodeSSE({ id: "1\ndata: injected", event: "a\nb", data: "ok" });
    expect(parseSSE(text)).toEqual([{ id: "1data: injected", event: "ab", data: "ok" }]);
  });
});
