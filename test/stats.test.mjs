import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { lnGamma, mulberry32, newcombe, normalQuantile, probBBeatsA, probBest, sampleSizePerArm, wilson, Z95 } from '../src/stats.js';

const close = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} +/- ${tolerance}, got ${actual}`);

describe('normalQuantile', () => {
  test('matches the standard values', () => {
    close(normalQuantile(0.975), 1.959964, 1e-6);
    close(normalQuantile(0.95), 1.644854, 1e-6);
    close(normalQuantile(0.8), 0.841621, 1e-6);
    close(normalQuantile(0.995), 2.575829, 1e-6);
    close(normalQuantile(0.5), 0, 1e-12);
    close(normalQuantile(0.01), -2.326348, 1e-6);
  });

  test('rejects probabilities outside (0, 1)', () => {
    for (const p of [0, 1, -0.1, 1.5, Number.NaN]) assert.throws(() => normalQuantile(p), RangeError);
  });
});

describe('wilson', () => {
  test('with zero sign-ups the upper bound is z^2 / (n + z^2)', () => {
    for (const n of [10, 150, 1000]) {
      for (const z of [Z95, normalQuantile(0.95)]) {
        const w = wilson(0, n, z);
        close(w.high, (z * z) / (n + z * z), 1e-12, `n=${n}`);
        close(w.low, 0, 1e-12);
      }
    }
  });

  test('0 of 150 has a one-sided 95% upper bound of 1.77%', () => {
    close(wilson(0, 150, normalQuantile(0.95)).high, 0.0177, 0.00005);
  });

  test('matches a textbook interval: 16 of 200', () => {
    const w = wilson(16, 200);
    assert.equal(w.p, 0.08);
    close(w.low, 0.0498, 0.0001);
    close(w.high, 0.126, 0.0001);
  });

  test('all sign-ups gives an upper bound of 1 and no visitors gives [0, 1]', () => {
    close(wilson(20, 20).high, 1, 1e-12);
    assert.deepEqual(wilson(0, 0), { p: 0, low: 0, high: 1 });
  });

  test('the interval always contains the observed rate and stays inside [0, 1]', () => {
    for (let n = 1; n <= 60; n += 7) {
      for (let x = 0; x <= n; x++) {
        const w = wilson(x, n);
        assert.ok(w.low >= 0 && w.high <= 1 && w.low <= w.p + 1e-12 && w.p <= w.high + 1e-12, `${x}/${n}`);
      }
    }
  });
});

describe('newcombe', () => {
  test('16/200 vs 8/200: difference +4 points, interval -0.8 to +9.0 points', () => {
    const d = newcombe(16, 200, 8, 200);
    close(d.diff, 0.04, 1e-12);
    close(d.low, -0.008, 0.0005);
    close(d.high, 0.09, 0.0005);
  });

  test('is symmetric when the arms are swapped', () => {
    const a = newcombe(30, 400, 12, 380);
    const b = newcombe(12, 380, 30, 400);
    close(a.low, -b.high, 1e-12);
    close(a.high, -b.low, 1e-12);
  });
});

describe('probBBeatsA', () => {
  test('16/200 beats 8/200 with probability about 0.952', () => {
    close(probBBeatsA(8, 200, 16, 200), 0.952, 0.001);
  });

  test('identical arms give 0.5, and the two directions add up to 1', () => {
    close(probBBeatsA(10, 100, 10, 100), 0.5, 1e-9);
    close(probBBeatsA(8, 200, 16, 200) + probBBeatsA(16, 200, 8, 200), 1, 1e-9);
  });

  test('lnGamma is exact on factorials', () => {
    close(lnGamma(1), 0, 1e-12);
    close(lnGamma(5), Math.log(24), 1e-12);
    close(lnGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-12);
    close(lnGamma(171), 706.5730622457874, 1e-8);
  });
});

describe('probBest', () => {
  test('agrees with the closed form for two arms', () => {
    const [a, b] = probBest([
      { x: 8, n: 200, value: 1 },
      { x: 16, n: 200, value: 1 },
    ]);
    close(b, probBBeatsA(8, 200, 16, 200), 0.005);
    close(a + b, 1, 1e-12);
  });

  test('three prices: a 3x conversion gap but no revenue winner', () => {
    // $9 at 16/200, $19 at 8/200, $29 at 5/200: revenue per visitor 0.72, 0.76 and 0.725.
    const p = probBest([
      { x: 16, n: 200, value: 9 },
      { x: 8, n: 200, value: 19 },
      { x: 5, n: 200, value: 29 },
    ]);
    close(p[0], 0.21, 0.015, '$9');
    close(p[1], 0.38, 0.015, '$19');
    close(p[2], 0.41, 0.015, '$29');
    assert.ok(Math.max(...p) < 0.5, 'no price is even a favourite');
  });

  test('is reproducible for a seed and changes with it', () => {
    const arms = [
      { x: 12, n: 150, value: 5 },
      { x: 7, n: 150, value: 9 },
    ];
    assert.deepEqual(probBest(arms, { seed: 7 }), probBest(arms, { seed: 7 }));
    assert.notDeepEqual(probBest(arms, { seed: 7, draws: 2000 }), probBest(arms, { seed: 8, draws: 2000 }));
  });

  test('mulberry32 returns numbers in [0, 1)', () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 10_000; i++) {
      const r = rand();
      assert.ok(r >= 0 && r < 1);
    }
  });
});

describe('sampleSizePerArm', () => {
  test('matches the minimum-sample table at alpha 0.05 and 80% power', () => {
    assert.equal(sampleSizePerArm(0.05, 0.1), 435);
    assert.equal(sampleSizePerArm(0.03, 0.06), 749);
    assert.equal(sampleSizePerArm(0.02, 0.04), 1141);
    assert.equal(sampleSizePerArm(0.05, 0.075), 1471);
  });

  test('is close to the 16 p(1 - p) / delta^2 rule of thumb', () => {
    const n = sampleSizePerArm(0.1, 0.12);
    const thumb = (16 * 0.11 * 0.89) / 0.0004;
    assert.ok(Math.abs(n - thumb) / thumb < 0.05, `${n} vs ${thumb}`);
  });
});
