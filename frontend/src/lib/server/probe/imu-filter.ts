import "server-only";

import type { Interval } from "@/lib/shared/probe/intervals";
import { RemovedCursor } from "@/lib/shared/probe/imu";

import { LineSplitter } from "../jobs/line-splitter";

export const PROBED_TIME_COLUMN = "probed_time_s";
const TIME_COLUMN = "timestamp_s";

/** True when a CSV header line is the pipeline's IMU table header. */
export function isImuHeader(line: string): boolean {
  return line.split(",")[0] === TIME_COLUMN;
}

/**
 * Streaming filter for the IMU CSV (`timestamp_s,acc_x,...`). Rows whose timestamp falls
 * inside a removed interval are dropped; every kept row gets `probed_time_s`, its time on
 * the probed video's timeline (6 decimals, like the source CSV). Pure apart from state:
 * text in, text out.
 */
export class ImuCsvFilter {
  private readonly splitter = new LineSplitter();
  private readonly cursor: RemovedCursor;
  private header = true;
  private line = 0;

  constructor(removed: readonly Interval[]) {
    this.cursor = new RemovedCursor(removed);
  }

  push(chunk: string): string {
    return this.process(this.splitter.push(chunk));
  }

  flush(): string {
    return this.process(this.splitter.flush());
  }

  private process(lines: string[]): string {
    let out = "";
    for (const line of lines) {
      this.line += 1;
      if (this.header) {
        if (!isImuHeader(line)) throw new Error("Not an IMU table: the first column must be timestamp_s.");
        this.header = false;
        out += `${line},${PROBED_TIME_COLUMN}\n`;
        continue;
      }
      const comma = line.indexOf(",");
      const t = Number(comma < 0 ? line : line.slice(0, comma));
      if (!Number.isFinite(t)) throw new Error(`IMU row ${this.line} has no valid timestamp.`);
      const at = this.cursor.at(t);
      if (!at.removed) out += `${line},${at.probedTime.toFixed(6)}\n`;
    }
    return out;
  }
}

/** Wrap a text source (e.g. fs.createReadStream(file, "utf8")) as a filtered byte stream. */
export function filterImuCsv(source: AsyncIterable<string>, removed: readonly Interval[]): ReadableStream<Uint8Array> {
  const filter = new ImuCsvFilter(removed);
  const encoder = new TextEncoder();
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const { value, done } = await iterator.next();
          if (done) {
            const rest = filter.flush();
            if (rest) controller.enqueue(encoder.encode(rest));
            controller.close();
            return;
          }
          const out = filter.push(value);
          if (out) {
            controller.enqueue(encoder.encode(out));
            return;
          }
        }
      } catch (error) {
        controller.error(error);
        await iterator.return?.();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
