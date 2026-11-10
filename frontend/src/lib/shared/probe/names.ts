/**
 * File names for everything a probe produces, derived from the video's name. Shared so
 * the browser's command and the API's download use the same names.
 */

/** Characters that are literal inside double quotes in bash, PowerShell and cmd.exe alike. */
const SHELL_SAFE = /^[A-Za-z0-9 ._+\-=@,()[\]{}#~&;'^]+$/;

/** True when `name` can be written as "name" in bash, PowerShell and cmd.exe unchanged. */
export function isShellSafe(name: string): boolean {
  return SHELL_SAFE.test(name) && !name.startsWith("-");
}

/** The name without its extension, reduced to characters that are safe everywhere. */
export function safeStem(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "") || "video";
  const clean = stem.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[-.]+/, "");
  return clean || "video";
}

export function probeFileNames(videoFile: string) {
  const stem = safeStem(videoFile);
  return {
    output: `${stem}_probed.mp4`,
    filterScript: `${stem}_probe_filter.txt`,
    concatList: `${stem}_probe.ffconcat`,
    plan: `${stem}_probe_plan.json`,
    imu: `${stem}_imu_probed.csv`,
  };
}
