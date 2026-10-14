// The kill rule: a decision you write down in kit.config.json before the test starts, applied
// the same way every time you look. Pure function, unit tested in test/killrule.test.mjs.
//
// 1. Until every price has minVisitorsPerVariant visitors: NOT ENOUGH DATA.
// 2. KILL when even the best price's upper bound is below killFloorRate.
// 3. GO when a price's lower bound is above goBarRate and it has goMinSignups sign-ups.
// 4. Otherwise KEEP RUNNING, until test.maxDays have passed: then TIME UP.
// Bounds are one-sided Wilson bounds at killRule.confidence.

import { normalQuantile, wilson } from './stats.js';

export const VERDICT = Object.freeze({
  NOT_ENOUGH_DATA: 'NOT ENOUGH DATA',
  KILL: 'KILL',
  GO: 'GO',
  KEEP_RUNNING: 'KEEP RUNNING',
  TIME_UP: 'TIME UP',
});

export const percent = (rate) => `${(rate * 100).toFixed(1)}%`;

/**
 * arms: [{ id, price, visitors, signups }]
 * rule: config.killRule
 * day: day number of the test (1 on the first day), maxDays: config.test.maxDays
 * Returns { verdict, reason, armId }.
 */
export function evaluateKillRule({ arms, rule, day, maxDays }) {
  const z = normalQuantile(rule.confidence);
  const timeUp = day > maxDays;
  const min = rule.minVisitorsPerVariant;
  const inconclusive = 'so the result is inconclusive: do what you decided before the test started';

  const short = arms.filter((a) => a.visitors < min);
  if (!arms.length || short.length) {
    const status = short.map((a) => `${a.id} has ${a.visitors}`).join(', ');
    if (timeUp) {
      return {
        verdict: VERDICT.TIME_UP,
        reason: `The ${maxDays} days are over but not every price reached ${min} visitors (${status}), ${inconclusive}.`,
        armId: null,
      };
    }
    const missing = short.reduce((sum, a) => sum + (min - a.visitors), 0);
    return {
      verdict: VERDICT.NOT_ENOUGH_DATA,
      reason: `Each price needs ${min} visitors before the rule applies (${status || 'no prices yet'}), so ${missing} more visitors are needed.`,
      armId: null,
    };
  }

  const scored = arms.map((a) => ({ ...a, ...wilson(a.signups, a.visitors, z) }));
  const best = scored.reduce((top, a) => (a.p > top.p || (a.p === top.p && a.price > top.price) ? a : top));
  const highest = scored.reduce((top, a) => (a.high > top.high ? a : top));

  if (highest.high < rule.killFloorRate) {
    return {
      verdict: VERDICT.KILL,
      reason: `Every price converts below the ${percent(rule.killFloorRate)} kill floor: even the highest upper bound, ${percent(highest.high)} for ${highest.id} (${highest.signups} of ${highest.visitors}), is under it.`,
      armId: highest.id,
    };
  }

  const passing = scored.filter((a) => a.low > rule.goBarRate && a.signups >= rule.goMinSignups);
  if (passing.length) {
    const pick = passing.reduce((top, a) => (a.price * a.p > top.price * top.p ? a : top));
    return {
      verdict: VERDICT.GO,
      reason: `Price ${pick.id} clears the go bar: its lower bound of ${percent(pick.low)} is above ${percent(rule.goBarRate)}, with ${pick.signups} sign-ups.`,
      armId: pick.id,
    };
  }

  if (timeUp) {
    return {
      verdict: VERDICT.TIME_UP,
      reason: `The ${maxDays} days are over and no price crossed either bar (the best, ${best.id}, converts at ${percent(best.p)}), ${inconclusive}.`,
      armId: null,
    };
  }

  const almost = scored.find((a) => a.low > rule.goBarRate);
  const reason = almost
    ? `Price ${almost.id} is above the go bar (lower bound ${percent(almost.low)}) but has ${almost.signups} of the ${rule.goMinSignups} sign-ups the rule asks for.`
    : `The best price, ${best.id} at ${percent(best.p)} (bounds ${percent(best.low)} to ${percent(best.high)}), sits between the ${percent(rule.killFloorRate)} kill floor and the ${percent(rule.goBarRate)} go bar.`;
  return { verdict: VERDICT.KEEP_RUNNING, reason, armId: null };
}
