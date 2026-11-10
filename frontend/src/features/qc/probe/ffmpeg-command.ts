/**
 * The "probing command": ffmpeg invocations that remove exactly the plan's red portions.
 * Both forms were checked against ffmpeg 8.0.1 on GoPro HEVC footage (frame counts and
 * per-frame checksums of the output matched the plan).
 *
 * Exact (re-encode): split the decoded streams, `trim` each kept part by frame number
 *   (video) and `atrim` by time (audio, sample-accurate), then `concat` them. `aselect`
 *   is deliberately not used: in ffmpeg 8.0.1 it passes every audio frame regardless of
 *   its expression. Long graphs go into a script file read with `-/filter_complex`
 *   (ffmpeg 7.0+).
 * Fast (stream copy): an ffconcat list of the kept parts (`inpoint`/`outpoint`) read by
 *   the concat demuxer. Kept parts start on keyframes (see keyframes.ts). `inpoint` is
 *   rounded up and `outpoint` down to the microsecond, so the first kept frame is never
 *   skipped and the first removed frame is never included.
 */

import type { Interval } from "@/lib/shared/probe/intervals";
import { isShellSafe, probeFileNames } from "@/lib/shared/probe/names";

import type { ProbePlan } from "./plan";

export interface CommandFile {
  name: string;
  content: string;
  mime: string;
}

export interface ProbeCommand {
  /** One line, ready to paste into bash, PowerShell or cmd.exe. */
  command: string;
  /** Files the command reads; save them next to the video. */
  files: CommandFile[];
  output: string;
  notes: string[];
}

export interface CommandVideo {
  /** File name of the source video as the user has it. */
  file: string;
  /** null when unknown (results 1.0); the command then assumes an audio track. */
  hasAudio: boolean | null;
}

/** Inline graphs up to this length; cmd.exe's line limit is 8191 characters. */
export const INLINE_GRAPH_LIMIT = 3000;

export const EXACT_ENCODE_ARGS = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"];

/** Seconds with exactly 6 decimals, computed in integer microseconds. */
export function formatMicros(us: number): string {
  const whole = Math.floor(us / 1e6);
  return `${whole}.${String(us - whole * 1e6).padStart(6, "0")}`;
}

/**
 * Float noise allowance when rounding a frame time to microseconds. A frame time n·den/num
 * is either a whole number of µs or at least 1/num µs away from one (≥ 8e-6 µs for any
 * common frame rate), so 1e-6 µs absorbs float error without ever crossing a real boundary.
 */
const MICRO_TOLERANCE = 1e-6;

/** Start time of `frame`, rounded up to the microsecond (never before the frame). */
export const ceilMicros = (frame: number, fps: number) => Math.ceil((frame / fps) * 1e6 - MICRO_TOLERANCE);
/** Start time of `frame`, rounded down to the microsecond (never after the frame). */
export const floorMicros = (frame: number, fps: number) => Math.floor((frame / fps) * 1e6 + MICRO_TOLERANCE);

function quote(arg: string): string {
  return `"${arg}"`;
}

/** The input name to put in a command: the real name when it is safe to quote everywhere. */
export function commandInput(file: string): { name: string; renamed: boolean } {
  return isShellSafe(file) ? { name: file, renamed: false } : { name: "input.mp4", renamed: true };
}

function renameNote(file: string, name: string): string {
  return `The file name "${file}" contains characters that shells treat specially. Rename the video to ${name} before running the command.`;
}

function nothingToDo(plan: ProbePlan): string | null {
  if (plan.removedFrames === 0) return "Nothing is removed, so there is no command to run.";
  if (plan.keptFrames === 0 || plan.kept.length === 0) return "Every frame would be removed; move a line to keep part of the video.";
  return null;
}

/** The filter graph for exact mode (one filter chain per line when `pretty`). */
export function exactFilterGraph(kept: readonly Interval[], frameCount: number, fps: number, audio: boolean, pretty = false): string {
  const k = kept.length;
  const sep = pretty ? ";\n" : ";";
  const labels = (prefix: string) => kept.map((_, i) => `[${prefix}${i}]`).join("");
  const chains: string[] = [`[0:v:0]split=${k}${labels("v")}`];
  if (audio) chains.push(`[0:a:0]asplit=${k}${labels("a")}`);
  kept.forEach(([a, b], i) => {
    const toEnd = b >= frameCount;
    const v = [a > 0 ? `start_frame=${a}` : "", toEnd ? "" : `end_frame=${b}`].filter(Boolean).join(":");
    chains.push(`[v${i}]trim=${v},setpts=PTS-STARTPTS[w${i}]`);
    if (audio) {
      const t = [a > 0 ? `start=${formatMicros(Math.round((a / fps) * 1e6))}` : "", toEnd ? "" : `end=${formatMicros(Math.round((b / fps) * 1e6))}`]
        .filter(Boolean)
        .join(":");
      chains.push(`[a${i}]atrim=${t},asetpts=PTS-STARTPTS[b${i}]`);
    }
  });
  const inputs = kept.map((_, i) => (audio ? `[w${i}][b${i}]` : `[w${i}]`)).join("");
  chains.push(`${inputs}concat=n=${k}:v=1:a=${audio ? 1 : 0}${audio ? "[v][a]" : "[v]"}`);
  return chains.join(sep);
}

export function exactCommand(plan: ProbePlan, video: CommandVideo): ProbeCommand | { unavailable: string } {
  const blocked = nothingToDo(plan);
  if (blocked) return { unavailable: blocked };
  const names = probeFileNames(video.file);
  const input = commandInput(video.file);
  const audio = video.hasAudio !== false;
  const inlineGraph = exactFilterGraph(plan.kept, plan.frameCount, plan.fps, audio);
  const inline = inlineGraph.length <= INLINE_GRAPH_LIMIT;
  const graphArg = inline ? ["-filter_complex", quote(inlineGraph)] : ["-/filter_complex", quote(names.filterScript)];
  const maps = audio ? ["-map", quote("[v]"), "-map", quote("[a]")] : ["-map", quote("[v]")];
  const encode = audio ? EXACT_ENCODE_ARGS : EXACT_ENCODE_ARGS.slice(0, 8);
  const command = ["ffmpeg", "-i", quote(input.name), ...graphArg, ...maps, ...encode, "-movflags", "+faststart", quote(names.output)].join(" ");

  const notes = [
    `Re-encodes to H.264 (CRF 18) ${audio ? "and AAC audio " : ""}with frame-accurate cuts; change the codec options to taste.`,
    "Output keeps the video and audio streams only; cut telemetry separately with the probed IMU CSV.",
  ];
  if (video.hasAudio === null) notes.push("These results don't record whether the video has audio; the command assumes it does.");
  if (!inline) notes.unshift(`The cut list is long, so the filter graph is in ${names.filterScript}. Save it next to the video. Needs ffmpeg 7.0 or newer.`);
  if (input.renamed) notes.unshift(renameNote(video.file, input.name));
  const files = inline ? [] : [{ name: names.filterScript, content: `${exactFilterGraph(plan.kept, plan.frameCount, plan.fps, audio, true)}\n`, mime: "text/plain" }];
  return { command, files, output: names.output, notes };
}

/** ffconcat single-quoted string (a quote becomes '\''). */
function ffconcatQuote(name: string): string {
  return `'${name.replace(/'/g, "'\\''")}'`;
}

export function fastConcatList(plan: ProbePlan, inputName: string): string {
  const lines = ["ffconcat version 1.0"];
  for (const [a, b] of plan.kept) {
    lines.push(`file ${ffconcatQuote(inputName)}`);
    if (a > 0) lines.push(`inpoint ${formatMicros(ceilMicros(a, plan.fps))}`);
    if (b < plan.frameCount) lines.push(`outpoint ${formatMicros(floorMicros(b, plan.fps))}`);
  }
  return `${lines.join("\n")}\n`;
}

export function fastCommand(plan: ProbePlan, video: CommandVideo): ProbeCommand | { unavailable: string } {
  if (plan.mode !== "fast") return { unavailable: "Fast cuts aren't available for this video." };
  const blocked = nothingToDo(plan);
  if (blocked) return { unavailable: blocked };
  const names = probeFileNames(video.file);
  const input = commandInput(video.file);
  const command = [
    "ffmpeg", "-f", "concat", "-safe", "0", "-i", quote(names.concatList),
    "-map", "0:v:0", "-map", quote("0:a:0?"), "-c", "copy", "-movflags", "+faststart", quote(names.output),
  ].join(" ");
  const notes = [
    `Lossless and fast: copies the original streams. Save ${names.concatList} in the same folder as the video and run the command there.`,
    "Kept parts start on the next keyframe, so a little more is removed than the lines select (shown hatched on the timeline).",
    "Audio is cut on its own packet boundaries, so it can shift by up to one audio frame (about 21 ms) at each cut.",
    "Output keeps the video and audio streams only; cut telemetry separately with the probed IMU CSV.",
  ];
  if (input.renamed) notes.unshift(renameNote(video.file, input.name));
  return {
    command,
    files: [{ name: names.concatList, content: fastConcatList(plan, input.name), mime: "text/plain" }],
    output: names.output,
    notes,
  };
}
