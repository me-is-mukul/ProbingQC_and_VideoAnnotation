/** Form model for processing options: text fields as typed, converted and validated on submit. */

import type { Result } from "@/lib/shared/result";
import type { JobOptions } from "@/lib/shared/types";
import { validateJobOptions } from "@/lib/shared/validation";

export interface OptionsDraft {
  frameStride: string;
  startS: string;
  maxSeconds: string;
  hands: boolean;
  imu: boolean;
}

export const DEFAULT_OPTIONS_DRAFT: OptionsDraft = { frameStride: "", startS: "", maxSeconds: "", hands: true, imu: true };

/** Presets offered as one-tap choices. */
export const OPTION_PRESETS: ReadonlyArray<{ id: string; label: string; draft: Partial<OptionsDraft> }> = [
  { id: "full", label: "Full video", draft: { startS: "", maxSeconds: "" } },
  { id: "quick", label: "First minute", draft: { startS: "", maxSeconds: "60" } },
];

const blankToUndefined = (s: string) => (s.trim() === "" ? undefined : s.trim());

export function draftToOptions(draft: OptionsDraft): Result<JobOptions> {
  return validateJobOptions({
    frameStride: blankToUndefined(draft.frameStride),
    startS: blankToUndefined(draft.startS),
    maxSeconds: blankToUndefined(draft.maxSeconds),
    hands: draft.hands,
    imu: draft.imu,
  });
}
