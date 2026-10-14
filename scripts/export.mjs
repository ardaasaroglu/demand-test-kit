// `npm run export` (deployed database) or `npm run export:local`: writes the waitlist to a CSV
// file in exports/, which .gitignore keeps out of git. Cells that a spreadsheet would run as a
// formula are prefixed with an apostrophe.
// Options: --out path/to/file.csv

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { toCsv } from '../src/csv.js';
import { d1Execute, flagValue, parseTarget, ROOT } from './lib/d1.mjs';

export const EXPORT_COLUMNS = ['created_at', 'email', 'name', 'answer', 'variant', 'price', 'src', 'consent_version'];

function main(argv) {
  const target = parseTarget(argv);
  const [rows] = d1Execute({
    remote: target.remote,
    sql: `SELECT ${EXPORT_COLUMNS.join(', ')} FROM signups ORDER BY created_at`,
  });
  const day = new Date().toISOString().slice(0, 10);
  const outFlag = flagValue(argv, '--out');
  const out = outFlag ? (isAbsolute(outFlag) ? outFlag : join(process.cwd(), outFlag)) : join(ROOT, 'exports', `signups-${day}.csv`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toCsv(rows, EXPORT_COLUMNS));
  console.log(`Wrote ${rows.length} sign-up${rows.length === 1 ? '' : 's'} from the ${target.label} database to ${relative(process.cwd(), out) || out}.`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
