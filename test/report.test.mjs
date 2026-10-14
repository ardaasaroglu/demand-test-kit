import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { buildReport, RESULTS_SQL, testDay, toReportData } from '../src/report.js';

const config = loadConfig(JSON.parse(readFileSync(new URL('../kit.config.json', import.meta.url), 'utf8')));
const asOf = new Date('2026-10-28T12:00:00Z');

const sample = {
  variants: {
    a: { visitors: 497, views: 620, clicked: 130, signups: 49 },
    b: { visitors: 483, views: 600, clicked: 117, signups: 44 },
    c: { visitors: 470, views: 590, clicked: 84, signups: 11 },
  },
  sources: [
    { src: 'newsletter', visitors: 436, signups: 36 },
    { src: 'direct', visitors: 508, signups: 26 },
  ],
  outsideSignups: 2,
  shareClicks: 20,
  firstView: '2026-10-15T09:00:00.000Z',
};

describe('the results report', () => {
  test('prints every price with its counts, interval, revenue per 100 visitors and P(best)', () => {
    const text = buildReport({ config, data: sample, asOf, sourceLabel: 'local D1', draws: 20_000 });
    assert.match(text, /^Demand test: Fernquill$/m);
    assert.match(text, /Day 14 of 21, counted from the first recorded visit on 2026-10-15\. Data: local D1\./);
    assert.match(text, /a {2}\$4 per month +497 +130 +49 +9\.9% \(7\.5% to 12\.8%\) +\$39\.44 +0\.\d\d/);
    assert.match(text, /b {2}\$7 per month +483 +117 +44 +9\.1% \(6\.9% to 12\.0%\) +\$63\.77 +0\.\d\d/);
    assert.match(text, /c {2}\$12 per month +470 +84 +11 +2\.3% \(1\.3% to 4\.1%\) +\$28\.09 +0\.\d\d/);
    assert.match(text, /Top two by revenue per visitor: b and a\. Conversion of b minus a: -0\.7 points \(95% CI -4\.\d to \+3\.\d\)\./);
    assert.match(text, /newsletter +436 +36 +8\.3%/);
    assert.match(text, /Share-link presses: 20\. Sign-ups outside the test \(opted out of testing\): 2\./);
    assert.match(text, /VERDICT: GO/);
    assert.match(text, /Price b clears the go bar/);
    assert.match(text, /Price: b earns the most per visitor, with P\(best\) 0\.9\d\./);
  });

  test('is the same every time for the same data', () => {
    const one = buildReport({ config, data: sample, asOf, draws: 5000 });
    const two = buildReport({ config, data: sample, asOf, draws: 5000 });
    assert.equal(one, two);
  });

  test('sorts sources by visitors', () => {
    const text = buildReport({ config, data: sample, asOf, draws: 1000 });
    assert.ok(text.indexOf('direct ') < text.indexOf('newsletter '));
  });

  test('handles an empty database', () => {
    const empty = { variants: {}, sources: [], outsideSignups: 0, shareClicks: 0, firstView: null };
    const text = buildReport({ config, data: empty, asOf, draws: 1000 });
    assert.match(text, /No visits recorded yet/);
    assert.match(text, /no visitors/);
    assert.match(text, /VERDICT: NOT ENOUGH DATA/);
    assert.match(text, /600 more visitors are needed/);
    assert.doesNotMatch(text, /0\.\d\d$/m, 'no P(best) without visitors');
    assert.doesNotMatch(text, /Top two/);
  });

  test('leaves out prices that are no longer in the config, and says so', () => {
    const data = { ...sample, variants: { ...sample.variants, old: { visitors: 50, views: 50, clicked: 3, signups: 2 } } };
    const text = buildReport({ config, data, asOf, draws: 1000 });
    assert.match(text, /Left out: data for old, which is no longer in kit\.config\.json\./);
  });

  test('counts days from test.startDate when it is set', () => {
    const dated = loadConfig({ ...JSON.parse(readFileSync(new URL('../kit.config.json', import.meta.url), 'utf8')), test: { startDate: '2026-10-01', maxDays: 21 } });
    const text = buildReport({ config: dated, data: sample, asOf, draws: 1000 });
    assert.match(text, /Day 28 of 21, started 2026-10-01\./);
  });

  test('uses only plain characters and no dashes as punctuation', () => {
    const text = buildReport({ config, data: sample, asOf, draws: 1000 });
    assert.doesNotMatch(text, /[\u2013\u2014]/);
  });
});

describe('testDay', () => {
  test('is 1 on the start day and counts calendar days in UTC', () => {
    assert.equal(testDay('2026-10-14', new Date('2026-10-14T23:59:00Z')), 1);
    assert.equal(testDay('2026-10-14T18:00:00.000Z', new Date('2026-10-15T00:01:00Z')), 2);
    assert.equal(testDay(null, new Date()), null);
  });
});

describe('the results query', () => {
  test('aggregates in SQL, one scan per table, and maps the rows', () => {
    assert.equal(RESULTS_SQL.trim().split(';').length, 3);
    assert.doesNotMatch(RESULTS_SQL, /SELECT \*/);
    const data = toReportData([
      [
        { variant: 'a', src: 'direct', visitors: 6, views: 8, first_view: '2026-10-03T10:00:00.000Z' },
        { variant: 'a', src: 'share', visitors: 4, views: 4, first_view: '2026-10-02T10:00:00.000Z' },
        { variant: 'b', src: 'direct', visitors: 9, views: 9, first_view: '2026-10-04T10:00:00.000Z' },
      ],
      [
        { variant: 'a', clicked: 4, shares: 1 },
        { variant: 'b', clicked: 0, shares: 4 },
      ],
      [
        { variant: 'b', src: 'direct', signups: 1 },
        { variant: 'b', src: 'share', signups: 1 },
        { variant: null, src: 'forum', signups: 3 },
      ],
    ]);
    assert.deepEqual(data.variants, {
      a: { visitors: 10, views: 12, clicked: 4, signups: 0 },
      b: { visitors: 9, views: 9, clicked: 0, signups: 2 },
    });
    assert.deepEqual(data.sources, [
      { src: 'direct', visitors: 15, signups: 1 },
      { src: 'share', visitors: 4, signups: 1 },
    ]);
    assert.equal(data.outsideSignups, 3);
    assert.equal(data.shareClicks, 5);
    assert.equal(data.firstView, '2026-10-02T10:00:00.000Z');
  });
});
