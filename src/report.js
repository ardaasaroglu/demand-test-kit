// Turns aggregate counts into the plain-text report that `npm run results` prints.
// Pure function, unit tested in test/report.test.mjs. scripts/results.mjs does the database reads.

import { evaluateKillRule, percent, VERDICT } from './killrule.js';
import { describeVariant } from './render.js';
import { newcombe, probBest, wilson, Z95 } from './stats.js';

export const REPORT_DRAWS = 100_000;
export const REPORT_SEED = 20261014;

const DAY_MS = 86_400_000;

function money(pricing, amount) {
  return new Intl.NumberFormat(pricing.locale, {
    style: 'currency',
    currency: pricing.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

const points = (d) => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}`;

function table(header, rows, align) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) =>
    cells
      .map((c, i) => (align[i] === 'r' ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  return [line(header), ...rows.map(line)].join('\n');
}

// Aggregate queries for `npm run results`: three statements, each scanning one table once and
// returning a few rows per price and link tag, however large the test gets.
export const RESULTS_SQL = `
SELECT variant, src, SUM(first) AS visitors, COUNT(*) AS views, MIN(created_at) AS first_view FROM views GROUP BY variant, src;
SELECT variant, COUNT(DISTINCT CASE WHEN type IN ('cta_click', 'price_click') THEN view_id END) AS clicked, SUM(type = 'share_click') AS shares FROM events GROUP BY variant;
SELECT variant, src, COUNT(*) AS signups FROM signups GROUP BY variant, src`;

/** Maps the rows of RESULTS_SQL, one array per statement, to the input of buildReport. */
export function toReportData([views, events, signups]) {
  const variants = {};
  const sources = new Map();
  const slot = (id) => (variants[id] ??= { visitors: 0, views: 0, clicked: 0, signups: 0 });
  const source = (src) => {
    if (!sources.has(src)) sources.set(src, { src, visitors: 0, signups: 0 });
    return sources.get(src);
  };
  let firstView = null;
  for (const r of views) {
    const v = slot(r.variant);
    v.visitors += r.visitors ?? 0;
    v.views += r.views ?? 0;
    source(r.src).visitors += r.visitors ?? 0;
    if (r.first_view && (!firstView || r.first_view < firstView)) firstView = r.first_view;
  }
  let shareClicks = 0;
  for (const r of events) {
    slot(r.variant).clicked += r.clicked ?? 0;
    shareClicks += r.shares ?? 0;
  }
  // A sign-up without a variant came from a visitor who opted out of testing: outside the test.
  let outsideSignups = 0;
  for (const r of signups) {
    if (r.variant === null || r.variant === undefined) {
      outsideSignups += r.signups ?? 0;
      continue;
    }
    slot(r.variant).signups += r.signups ?? 0;
    source(r.src).signups += r.signups ?? 0;
  }
  return { variants, sources: [...sources.values()], outsideSignups, shareClicks, firstView };
}

/** Day number of the test on `asOf` (1 on the start day), or null when it has not started. */
export function testDay(startIso, asOf) {
  if (!startIso) return null;
  const start = Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${asOf.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.floor((today - start) / DAY_MS) + 1;
}

/**
 * data: {
 *   variants: { [id]: { visitors, views, clicked, signups } },
 *   sources: [{ src, visitors, signups }],
 *   outsideSignups, shareClicks, firstView (ISO or null)
 * }
 */
export function buildReport({ config, data, asOf = new Date(), sourceLabel = 'D1', draws = REPORT_DRAWS, seed = REPORT_SEED }) {
  const { pricing, killRule, test } = config;
  const out = [];
  const start = test.startDate ?? (data.firstView ? data.firstView.slice(0, 10) : null);
  const day = testDay(start, asOf);

  out.push(`Demand test: ${config.product.name}`);
  if (day === null) out.push(`No visits recorded yet. Data: ${sourceLabel}.`);
  else {
    const from = test.startDate ? `started ${start}` : `counted from the first recorded visit on ${start}`;
    out.push(`Day ${day} of ${test.maxDays}, ${from}. Data: ${sourceLabel}.`);
  }
  out.push('');

  const arms = pricing.variants.map((v) => {
    const row = data.variants[v.id] ?? {};
    return {
      id: v.id,
      price: v.price,
      variant: v,
      visitors: row.visitors ?? 0,
      clicked: row.clicked ?? 0,
      signups: row.signups ?? 0,
    };
  });
  // With no visitors on some price, P(best) would only reflect the prior, so it is left blank.
  const everyArmSeen = arms.every((a) => a.visitors > 0);
  const pBest = everyArmSeen
    ? probBest(arms.map((a) => ({ x: Math.min(a.signups, a.visitors), n: a.visitors, value: a.price })), { draws, seed })
    : arms.map(() => null);

  out.push('PRICES');
  out.push(
    table(
      ['Price', 'Visitors', 'Clicked join', 'Sign-ups', 'Conversion (95% CI)', 'Per 100 visitors', 'P(best)'],
      arms.map((a, i) => {
        const w = wilson(a.signups, a.visitors, Z95);
        const conv = a.visitors ? `${percent(w.p)} (${percent(w.low)} to ${percent(w.high)})` : 'no visitors';
        const per100 = a.visitors ? money(pricing, w.p * a.price * 100) : '';
        return [`${a.id}  ${describeVariant(pricing, a.variant)}`, a.visitors, a.clicked, a.signups, conv, per100, pBest[i] === null ? '' : pBest[i].toFixed(2)];
      }),
      ['l', 'r', 'r', 'r', 'l', 'r', 'r'],
    ),
  );
  out.push('');
  out.push('Clicked join: page views where a join button was pressed. Per 100 visitors: conversion x price,');
  out.push('the revenue 100 visitors would bring if every sign-up paid. P(best): the chance each price earns');
  out.push(`the most per visitor (${draws.toLocaleString('en-US')} simulated draws, seed ${seed}).`);

  const ranked = arms
    .map((a, i) => ({ ...a, rpv: a.visitors ? (a.signups / a.visitors) * a.price : 0, pBest: pBest[i] }))
    .sort((x, y) => y.rpv - x.rpv);
  if (ranked.length >= 2 && ranked[0].visitors && ranked[1].visitors) {
    const [top, next] = ranked;
    const d = newcombe(top.signups, top.visitors, next.signups, next.visitors, Z95);
    out.push('');
    out.push(
      `Top two by revenue per visitor: ${top.id} and ${next.id}. Conversion of ${top.id} minus ${next.id}: ${points(d.diff)} points (95% CI ${points(d.low)} to ${points(d.high)}).`,
    );
  }

  const unknown = Object.keys(data.variants).filter((id) => !pricing.variants.some((v) => v.id === id));
  if (unknown.length) {
    out.push(`Left out: data for ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is' : 'are'} no longer in kit.config.json.`);
  }

  out.push('');
  out.push('SOURCES');
  if (!data.sources.length) out.push('No visits yet.');
  else {
    const sources = [...data.sources].sort((a, b) => b.visitors - a.visitors || b.signups - a.signups || a.src.localeCompare(b.src));
    out.push(
      table(
        ['Source', 'Visitors', 'Sign-ups', 'Conversion'],
        sources.map((s) => [s.src, s.visitors, s.signups, s.visitors ? percent(s.signups / s.visitors) : '']),
        ['l', 'r', 'r', 'r'],
      ),
    );
  }
  out.push(`Share-link presses: ${data.shareClicks ?? 0}. Sign-ups outside the test (opted out of testing): ${data.outsideSignups ?? 0}.`);

  const rule = evaluateKillRule({ arms, rule: killRule, day: day ?? 0, maxDays: test.maxDays });
  const conf = Math.round(killRule.confidence * 1000) / 10;
  out.push('');
  out.push('KILL RULE (set in kit.config.json before the test)');
  out.push(
    `Kill under ${percent(killRule.killFloorRate)}. Go over ${percent(killRule.goBarRate)} with at least ${killRule.goMinSignups} sign-ups. Applies after ${killRule.minVisitorsPerVariant} visitors per price. One-sided ${conf}% bounds.`,
  );
  out.push('');
  out.push(`VERDICT: ${rule.verdict}`);
  out.push(rule.reason);

  if (rule.verdict === VERDICT.NOT_ENOUGH_DATA) {
    out.push('Price: compare prices only after every price has the minimum sample.');
  } else {
    const leader = ranked.reduce((a, b) => ((b.pBest ?? 0) > (a.pBest ?? 0) ? b : a));
    if (leader.pBest === null) {
      out.push('Price: every price needs visitors before prices can be compared.');
    } else if (leader.pBest >= killRule.confidence) {
      out.push(`Price: ${leader.id} earns the most per visitor, with P(best) ${leader.pBest.toFixed(2)}.`);
    } else {
      out.push(`Price: no clear winner. ${leader.id} leads with P(best) ${leader.pBest.toFixed(2)}, and the rule asks for ${killRule.confidence}.`);
    }
  }
  return out.join('\n');
}
