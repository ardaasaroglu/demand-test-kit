// Statistics for small conversion tests. Pure functions with no dependencies, unit tested in
// test/stats.test.mjs. Notation: x sign-ups out of n visitors, p = x / n.

/** z for 95% two-sided intervals. */
export const Z95 = 1.959963984540054;

/**
 * Inverse of the standard normal CDF (Acklam's algorithm, relative error under 1.2e-9).
 * normalQuantile(0.975) is about 1.96, normalQuantile(0.95) about 1.645.
 */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new RangeError(`normalQuantile needs 0 < p < 1, got ${p}`);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Wilson score interval for a proportion (Brown, Cai and DasGupta 2001 recommend it over the
 * normal interval for small n). With zero sign-ups the upper bound is z^2 / (n + z^2).
 * Pass z = normalQuantile(0.95) for one-sided 95% bounds.
 */
export function wilson(x, n, z = Z95) {
  if (n <= 0) return { p: 0, low: 0, high: 1 };
  const p = x / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { p, low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/**
 * Newcombe's hybrid score interval for the difference p1 - p2 (Newcombe 1998, method 10),
 * built from the two Wilson intervals.
 */
export function newcombe(x1, n1, x2, n2, z = Z95) {
  const a = wilson(x1, n1, z);
  const b = wilson(x2, n2, z);
  const diff = a.p - b.p;
  return {
    diff,
    low: diff - Math.sqrt((a.p - a.low) ** 2 + (b.high - b.p) ** 2),
    high: diff + Math.sqrt((a.high - a.p) ** 2 + (b.p - b.low) ** 2),
  };
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Natural log of the gamma function (Lanczos approximation, g = 7). */
export function lnGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const y = x - 1;
  let sum = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i++) sum += LANCZOS[i] / (y + i);
  const t = y + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(sum);
}

export const lnBeta = (a, b) => lnGamma(a) + lnGamma(b) - lnGamma(a + b);

/**
 * Exact probability that arm B's true rate is above arm A's, with uniform Beta(1, 1) priors
 * (Evan Miller's closed form, summed in log space).
 */
export function probBBeatsA(xA, nA, xB, nB) {
  const aA = 1 + xA;
  const bA = 1 + nA - xA;
  const aB = 1 + xB;
  const bB = 1 + nB - xB;
  let total = 0;
  for (let i = 0; i < aB; i++) {
    total += Math.exp(lnBeta(aA + i, bA + bB) - Math.log(bB + i) - lnBeta(1 + i, bB) - lnBeta(aA, bA));
  }
  return Math.min(1, Math.max(0, total));
}

/** A small seeded random number generator (mulberry32), so reports are reproducible. */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNormal(rand) {
  let spare = null;
  return function normal() {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

// Marsaglia and Tsang (2000). Shapes here are always at least 1.
function sampleGamma(shape, rand, normal) {
  if (shape < 1) {
    let u = 0;
    while (u === 0) u = rand();
    return sampleGamma(shape + 1, rand, normal) * u ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal();
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Probability that each arm is the best on value x rate, by Monte Carlo over Beta(1 + x, 1 + n - x)
 * posteriors. For a price test, value is the price, so this is "best on revenue per visitor".
 * arms: [{ x, n, value }]. Returns an array of probabilities in the same order.
 */
export function probBest(arms, { draws = 100_000, seed = 20261014 } = {}) {
  const rand = mulberry32(seed);
  const normal = makeNormal(rand);
  const wins = new Array(arms.length).fill(0);
  for (let i = 0; i < draws; i++) {
    let best = -1;
    let bestValue = -Infinity;
    for (let j = 0; j < arms.length; j++) {
      const { x, n, value } = arms[j];
      const g1 = sampleGamma(1 + x, rand, normal);
      const g2 = sampleGamma(1 + n - x, rand, normal);
      const score = value * (g1 / (g1 + g2));
      if (score > bestValue) {
        bestValue = score;
        best = j;
      }
    }
    wins[best] += 1;
  }
  return wins.map((w) => w / draws);
}

/**
 * Visitors needed per arm to detect a change from rate p1 to rate p2 with a two-sided test
 * at level alpha and the given power (fixed horizon, normal approximation).
 */
export function sampleSizePerArm(p1, p2, { alpha = 0.05, power = 0.8 } = {}) {
  const zA = normalQuantile(1 - alpha / 2);
  const zB = normalQuantile(power);
  const pBar = (p1 + p2) / 2;
  const top = zA * Math.sqrt(2 * pBar * (1 - pBar)) + zB * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((top * top) / ((p1 - p2) * (p1 - p2)));
}
