/**
 * numpy- and CPython-compatible numerics, so metrics recomputed in the browser match the
 * Python report bit for bit (checked by probe-parity.json, generated from the real Python).
 *
 * - `pairwiseSum` is numpy's float64 reduction (pairwise, 8 accumulators, 128-element blocks).
 *   numpy 2.x sums a contiguous array in one pass of this algorithm (verified on numpy 2.5).
 * - `percentileLinear` is `np.percentile(..., method="linear")`, including numpy's `_lerp`.
 * - `pyRound` / `pyRoundInt` are CPython's `round()`: correctly rounded, ties to even.
 */

const PW_BLOCKSIZE = 128;

/** numpy's pairwise summation over `a[start, start + n)`. */
export function pairwiseSum(a: ArrayLike<number>, start = 0, n = a.length - start): number {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i += 1) res += a[start + i]!;
    return res;
  }
  if (n <= PW_BLOCKSIZE) {
    let r0 = a[start]!, r1 = a[start + 1]!, r2 = a[start + 2]!, r3 = a[start + 3]!;
    let r4 = a[start + 4]!, r5 = a[start + 5]!, r6 = a[start + 6]!, r7 = a[start + 7]!;
    let i = 8;
    for (; i < n - (n % 8); i += 8) {
      const j = start + i;
      r0 += a[j]!; r1 += a[j + 1]!; r2 += a[j + 2]!; r3 += a[j + 3]!;
      r4 += a[j + 4]!; r5 += a[j + 5]!; r6 += a[j + 6]!; r7 += a[j + 7]!;
    }
    let res = ((r0 + r1) + (r2 + r3)) + ((r4 + r5) + (r6 + r7));
    for (; i < n; i += 1) res += a[start + i]!;
    return res;
  }
  let n2 = Math.trunc(n / 2);
  n2 -= n2 % 8;
  return pairwiseSum(a, start, n2) + pairwiseSum(a, start + n2, n - n2);
}

/** `arr.mean()` for a float64 array (NaN-free input). */
export function mean(a: ArrayLike<number>): number {
  return pairwiseSum(a) / a.length;
}

/** `arr.std()` (population, ddof = 0), computed the way numpy's `_var` does. */
export function std(a: ArrayLike<number>): number {
  const m = mean(a);
  const sq = new Float64Array(a.length);
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i]! - m;
    sq[i] = d * d;
  }
  return Math.sqrt(pairwiseSum(sq) / a.length);
}

/** numpy's `_lerp`: a + (b - a)·t, recomputed from b for t ≥ 0.5 (keeps monotonicity). */
function lerp(a: number, b: number, t: number): number {
  const diff = b - a;
  return t >= 0.5 ? b - diff * (1 - t) : a + diff * t;
}

/** `np.percentile(sorted, p)` with the default linear method; `sorted` ascending, NaN-free. */
export function percentileLinear(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  const q = p / 100;
  const virtual = (n - 1) * q;
  let prev = Math.floor(virtual);
  let next = prev + 1;
  const gamma = virtual - prev;
  prev = Math.min(Math.max(prev, 0), n - 1);
  next = Math.min(Math.max(next, 0), n - 1);
  return lerp(sorted[prev]!, sorted[next]!, gamma);
}

/** CPython `round(x, digits)` for floats: exact-value rounding with ties to even. */
export function pyRound(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  // toFixed rounds the exact binary value; it only differs from CPython on exact ties
  // (it picks the larger magnitude). 100 digits hold the full expansion of any value
  // large enough to tie at `digits` places.
  const expansion = Math.abs(x).toFixed(100);
  const [, frac = ""] = expansion.split(".");
  const tail = frac.slice(digits);
  const isTie = tail[0] === "5" && /^0*$/.test(tail.slice(1));
  if (isTie) {
    const truncated = expansion.slice(0, expansion.indexOf(".") + (digits ? digits + 1 : 0));
    const lastDigit = Number(truncated.replace(".", "").slice(-1));
    if (lastDigit % 2 === 0) return Number((x < 0 ? "-" : "") + truncated);
  }
  return Number(x.toFixed(digits));
}

/** CPython `round(x)` to an integer: ties to even (Math.round rounds ties up). */
export function pyRoundInt(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
