/** Display formatting. Pure, locale-fixed ("en-US") so output is identical everywhere (and in tests). */

const LOCALE = "en-US";
const DASH = "—";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return DASH;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i += 1;
  }
  return i === 0 ? `${Math.round(value)} B` : `${value.toFixed(value < 10 ? 2 : 1)} ${units[i]}`;
}

/**
 * Seconds as `m:ss` or `h:mm:ss` (video timeline style). With `fractionDigits`, the
 * fraction is truncated, never rounded up, so a time never reads later than it is:
 * formatTimecode(4.1374, 2) is "0:04.13".
 */
export function formatTimecode(seconds: number | null | undefined, fractionDigits = 0): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH;
  const scale = 10 ** fractionDigits;
  const units = Math.floor(Math.max(0, seconds) * scale + 1e-9);
  const total = Math.floor(units / scale);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const fraction = fractionDigits > 0 ? `.${String(units % scale).padStart(fractionDigits, "0")}` : "";
  const ss = `${String(s).padStart(2, "0")}${fraction}`;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Seconds as a readable duration: "850 ms", "12.4 s", "3 min 05 s", "1 h 21 min". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return DASH;
  if (seconds === 0) return "0 s";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const total = Math.round(seconds);
  if (total < 3600) return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, "0")} s`;
  return `${Math.floor(total / 3600)} h ${Math.floor((total % 3600) / 60)} min`;
}

/** Grouped number with fixed decimals: 1,284 / 12.90. */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return value.toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Auto-compact for stat tiles: 1,284 / 12.9K / 4.2M. */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  if (Math.abs(value) < 10_000) return formatNumber(value, Number.isInteger(value) ? 0 : 1);
  return new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `${value.toFixed(decimals)}%`;
}

/** Unix seconds as local wall-clock time HH:MM:SS (terminal timestamps). */
export function formatClock(unixSeconds: number, timeZone?: string): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString(LOCALE, {
    hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", ...(timeZone ? { timeZone } : {}),
  });
}

/** Bitrate in kbit/s as "13.99 Mbit/s" or "850 kbit/s". */
export function formatBitrate(kbps: number | null | undefined): string {
  if (kbps === null || kbps === undefined || !Number.isFinite(kbps)) return DASH;
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(2)} Mbit/s` : `${Math.round(kbps)} kbit/s`;
}
