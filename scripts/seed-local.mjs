// `npm run seed:local`: fills the LOCAL database with simulated visits, clicks and sign-ups, so
// you can try `npm run results:local` and `npm run export:local` before you have real traffic.
// It replaces everything in the local database. It never touches the deployed one.
// The numbers are made up: three prices with different true conversion rates, five link tags,
// 14 days ending today. The same seed always gives the same counts.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { mulberry32 } from '../src/stats.js';
import { applyMigrations, d1Execute, readConfigFile } from './lib/d1.mjs';

const VISITORS = 1450;
const DAYS = 14;
// Simulated true conversion rate for each price, in config order. Extra prices get the last rate.
const RATES = [0.085, 0.07, 0.035, 0.03];
const SOURCES = [
  { src: 'newsletter', weight: 0.3, lift: 1.35 },
  { src: 'direct', weight: 0.33, lift: 0.75 },
  { src: 'forum', weight: 0.22, lift: 1.1 },
  { src: 'share', weight: 0.08, lift: 1.3 },
  { src: 'social', weight: 0.07, lift: 0.6 },
];

const config = loadConfig(readConfigFile());
const rand = mulberry32(42);
const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
const pick = (items) => {
  let r = rand() * items.reduce((s, i) => s + i.weight, 0);
  for (const item of items) if ((r -= item.weight) <= 0) return item;
  return items.at(-1);
};
const sql = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const end = Date.now();
const start = end - (DAYS - 1) * 86_400_000 - (end % 86_400_000);
const views = [];
const events = [];
const signups = [];
const answers = config.form.question?.options.map((o) => o.id) ?? [];

for (let i = 0; i < VISITORS; i++) {
  const index = Math.floor(rand() * config.pricing.variants.length);
  const variant = config.pricing.variants[index];
  const source = pick(SOURCES);
  const at = start + Math.floor(rand() * (end - start));
  const id = hex(32);
  views.push([id, new Date(at).toISOString(), variant.id, source.src, 1]);
  if (rand() < 0.25) views.push([hex(32), new Date(Math.min(end, at + 3_600_000 + rand() * 86_400_000)).toISOString(), variant.id, source.src, 0]);
  const joins = rand() < Math.min(0.95, RATES[Math.min(index, RATES.length - 1)] * source.lift);
  if (joins || rand() < 0.18) {
    events.push([id, rand() < 0.6 ? 'cta_click' : 'price_click', new Date(at + 20_000).toISOString(), variant.id, source.src]);
  }
  if (joins) {
    const email = `simulated-${String(signups.length + 1).padStart(4, '0')}@example.com`;
    const answer = answers.length && rand() < 0.8 ? answers[Math.floor(rand() * answers.length)] : null;
    signups.push([email, new Date(at + 90_000).toISOString(), null, answer, variant.id, variant.price, source.src, id, config.form.consentVersion]);
    if (rand() < 0.2) events.push([id, 'share_click', new Date(at + 120_000).toISOString(), variant.id, source.src]);
  }
}

function inserts(table, columns, rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 200) {
    const values = rows.slice(i, i + 200).map((r) => `(${r.map(sql).join(', ')})`).join(',\n');
    out.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values};`);
  }
  return out.join('\n');
}

const script = [
  'DELETE FROM events;',
  'DELETE FROM views;',
  'DELETE FROM signups;',
  inserts('views', ['id', 'created_at', 'variant', 'src', 'first'], views),
  inserts('events', ['view_id', 'type', 'created_at', 'variant', 'src'], events),
  inserts('signups', ['email', 'created_at', 'name', 'answer', 'variant', 'price', 'src', 'view_id', 'consent_version'], signups),
].join('\n');

const dir = mkdtempSync(join(tmpdir(), 'demand-test-kit-'));
const file = join(dir, 'seed.sql');
try {
  writeFileSync(file, script);
  applyMigrations({ remote: false });
  d1Execute({ remote: false, file });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`Local database replaced with simulated data: ${views.length} views, ${events.length} button presses, ${signups.length} sign-ups.`);
console.log('Now run: npm run results:local');
