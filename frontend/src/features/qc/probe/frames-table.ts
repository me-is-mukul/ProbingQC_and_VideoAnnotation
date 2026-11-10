/**
 * The per-frame QC table (`outputs/<stem>_qc_frames.csv`, one row per analysed frame) as
 * typed columns. Floats are stored with 4 decimals; empty cells (NaN) become NaN and
 * Python booleans ("True"/"False") become 1/0.
 */

import { err, ok, type Result } from "@/lib/shared/result";

import type { HandColumns, ImageColumns } from "./metrics";

export const IMAGE_COLUMNS = ["luminance", "sharpness", "blockiness", "cast_offset", "cast_factor", "cast_hue_deg"] as const;
export const HAND_COLUMNS = ["left", "right", "left_contact", "right_contact"] as const;

export interface FramesTable {
  rows: number;
  /** Source frame number of each analysed frame (the `frame` column). */
  frame: Int32Array;
  image: ImageColumns;
  /** null when hand tracking was off for the job. */
  hands: HandColumns | null;
}

function cell(text: string): number {
  if (text === "" || text === "nan" || text === "NaN") return Number.NaN;
  if (text === "True") return 1;
  if (text === "False") return 0;
  return Number(text);
}

/** Parse the CSV. Errors name the problem (missing column, bad number, ragged row). */
export function parseFramesCsv(text: string): Result<FramesTable> {
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return err("The frame table is empty.");
  const header = lines[0]!.split(",");
  const index = new Map(header.map((name, i) => [name, i]));
  const required = ["frame", ...IMAGE_COLUMNS];
  const missing = required.filter((c) => !index.has(c));
  if (missing.length) return err(`The frame table has no ${missing.join(", ")} column.`);
  const hasHands = HAND_COLUMNS.every((c) => index.has(c));

  const rows = lines.length - 1;
  const wanted = [...IMAGE_COLUMNS, ...(hasHands ? HAND_COLUMNS : [])];
  const columns = Object.fromEntries(wanted.map((c) => [c, new Float64Array(rows)])) as Record<string, Float64Array>;
  const frame = new Int32Array(rows);
  const frameAt = index.get("frame")!;
  const positions = wanted.map((c) => [columns[c]!, index.get(c)!] as const);

  for (let r = 0; r < rows; r += 1) {
    const fields = lines[r + 1]!.split(",");
    if (fields.length !== header.length) return err(`Row ${r + 1} has ${fields.length} fields, expected ${header.length}.`);
    const f = Number(fields[frameAt]);
    if (!Number.isInteger(f) || f < 0) return err(`Row ${r + 1} has an invalid frame number.`);
    if (r > 0 && f <= frame[r - 1]!) return err(`Frame numbers must increase (row ${r + 1}).`);
    frame[r] = f;
    for (const [target, at] of positions) {
      const v = cell(fields[at]!);
      if (Number.isNaN(v) && fields[at] !== "" && fields[at] !== "nan" && fields[at] !== "NaN") {
        return err(`Row ${r + 1} has a non-numeric value "${fields[at]!.slice(0, 20)}".`);
      }
      target[r] = v;
    }
  }

  return ok({
    rows,
    frame,
    image: Object.fromEntries(IMAGE_COLUMNS.map((c) => [c, columns[c]!])) as unknown as ImageColumns,
    hands: hasHands ? (Object.fromEntries(HAND_COLUMNS.map((c) => [c, columns[c]!])) as unknown as HandColumns) : null,
  });
}
