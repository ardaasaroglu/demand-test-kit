import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { evaluateKillRule, VERDICT } from '../src/killrule.js';

const rule = { minVisitorsPerVariant: 200, killFloorRate: 0.02, goBarRate: 0.04, goMinSignups: 10, confidence: 0.95 };
const arm = (id, price, visitors, signups) => ({ id, price, visitors, signups });
const evaluate = (arms, { day = 10, maxDays = 21, r = rule } = {}) => evaluateKillRule({ arms, rule: r, day, maxDays });

describe('the kill rule', () => {
  test('NOT ENOUGH DATA until every price has the minimum sample, and says what is missing', () => {
    const out = evaluate([arm('a', 4, 250, 30), arm('b', 7, 143, 20), arm('c', 12, 150, 1)]);
    assert.equal(out.verdict, VERDICT.NOT_ENOUGH_DATA);
    assert.match(out.reason, /b has 143, c has 150/);
    assert.match(out.reason, /107 more visitors/);
  });

  test('NOT ENOUGH DATA with no arms or no visitors at all', () => {
    assert.equal(evaluate([]).verdict, VERDICT.NOT_ENOUGH_DATA);
    assert.equal(evaluate([arm('a', 4, 0, 0), arm('b', 7, 0, 0)]).verdict, VERDICT.NOT_ENOUGH_DATA);
  });

  test('a strong early result still waits for the minimum sample', () => {
    const out = evaluate([arm('a', 4, 120, 40), arm('b', 7, 120, 38)]);
    assert.equal(out.verdict, VERDICT.NOT_ENOUGH_DATA);
  });

  test('KILL when even the best upper bound is under the floor (0 of 150 example)', () => {
    const r = { ...rule, minVisitorsPerVariant: 150 };
    const out = evaluate([arm('a', 4, 150, 0), arm('b', 7, 150, 0)], { r });
    assert.equal(out.verdict, VERDICT.KILL);
    assert.match(out.reason, /1\.8%/);
    assert.match(out.reason, /2\.0% kill floor/);
  });

  test('the README example: with the default rule, 0 of 150 waits and 0 of 200 is a KILL at 1.3%', () => {
    assert.equal(evaluate([arm('a', 4, 150, 0), arm('b', 7, 150, 0)]).verdict, VERDICT.NOT_ENOUGH_DATA);
    const out = evaluate([arm('a', 4, 200, 0), arm('b', 7, 200, 0)]);
    assert.equal(out.verdict, VERDICT.KILL);
    assert.match(out.reason, /1\.3% for a \(0 of 200\)/);
  });

  test('no KILL while one price could still be above the floor', () => {
    const r = { ...rule, minVisitorsPerVariant: 150 };
    const out = evaluate([arm('a', 4, 150, 0), arm('b', 7, 150, 2)], { r });
    assert.notEqual(out.verdict, VERDICT.KILL);
  });

  test('GO when a lower bound clears the bar with enough sign-ups, and it names that price', () => {
    const out = evaluate([arm('a', 4, 400, 40), arm('b', 7, 400, 12), arm('c', 12, 400, 3)]);
    assert.equal(out.verdict, VERDICT.GO);
    assert.equal(out.armId, 'a');
    assert.match(out.reason, /Price a clears the go bar/);
    assert.match(out.reason, /40 sign-ups/);
  });

  test('GO picks the passing price that earns most per visitor', () => {
    const out = evaluate([arm('a', 4, 400, 44), arm('b', 7, 400, 40)]);
    assert.equal(out.verdict, VERDICT.GO);
    assert.equal(out.armId, 'b');
  });

  test('no GO with too few sign-ups, even above the bar', () => {
    const r = { ...rule, minVisitorsPerVariant: 60, goMinSignups: 25 };
    const out = evaluate([arm('a', 4, 60, 20), arm('b', 7, 60, 2)], { r });
    assert.equal(out.verdict, VERDICT.KEEP_RUNNING);
    assert.match(out.reason, /20 of the 25 sign-ups/);
  });

  test('KEEP RUNNING between the bars, with the best price in the reason', () => {
    const out = evaluate([arm('a', 4, 300, 12), arm('b', 7, 300, 9)]);
    assert.equal(out.verdict, VERDICT.KEEP_RUNNING);
    assert.match(out.reason, /The best price, a at 4\.0%/);
  });

  test('TIME UP after maxDays when neither bar was crossed', () => {
    const out = evaluate([arm('a', 4, 300, 12), arm('b', 7, 300, 9)], { day: 22 });
    assert.equal(out.verdict, VERDICT.TIME_UP);
    assert.match(out.reason, /The 21 days are over/);
  });

  test('the last day still counts as running', () => {
    assert.equal(evaluate([arm('a', 4, 300, 12), arm('b', 7, 300, 9)], { day: 21 }).verdict, VERDICT.KEEP_RUNNING);
  });

  test('TIME UP when the time ran out before the minimum sample', () => {
    const out = evaluate([arm('a', 4, 120, 6), arm('b', 7, 90, 2)], { day: 30 });
    assert.equal(out.verdict, VERDICT.TIME_UP);
    assert.match(out.reason, /not every price reached 200 visitors/);
  });

  test('a clear result still counts after the time is up', () => {
    assert.equal(evaluate([arm('a', 4, 400, 40), arm('b', 7, 400, 30)], { day: 40 }).verdict, VERDICT.GO);
    const r = { ...rule, minVisitorsPerVariant: 150 };
    assert.equal(evaluate([arm('a', 4, 400, 0), arm('b', 7, 400, 1)], { day: 40, r }).verdict, VERDICT.KILL);
  });

  test('a higher confidence makes the bars harder to cross', () => {
    const arms = [arm('a', 4, 400, 24), arm('b', 7, 400, 10)];
    assert.equal(evaluate(arms).verdict, VERDICT.GO);
    assert.equal(evaluate(arms, { r: { ...rule, confidence: 0.99 } }).verdict, VERDICT.KEEP_RUNNING);
  });

  test('every reason is a single sentence with no dashes', () => {
    const cases = [
      evaluate([arm('a', 4, 10, 1), arm('b', 7, 10, 0)]),
      evaluate([arm('a', 4, 10, 1), arm('b', 7, 10, 0)], { day: 99 }),
      evaluate([arm('a', 4, 400, 0), arm('b', 7, 400, 0)]),
      evaluate([arm('a', 4, 400, 40), arm('b', 7, 400, 30)]),
      evaluate([arm('a', 4, 300, 12), arm('b', 7, 300, 9)]),
      evaluate([arm('a', 4, 300, 12), arm('b', 7, 300, 9)], { day: 99 }),
    ];
    for (const { reason } of cases) {
      assert.equal(reason.split(/\.\s/).length, 1, reason);
      assert.ok(reason.endsWith('.'), reason);
      assert.doesNotMatch(reason, /[\u2013\u2014]/, reason);
    }
  });
});
