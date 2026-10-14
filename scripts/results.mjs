// `npm run results` (deployed database) or `npm run results:local` (the one `npm run dev` uses).
// Reads aggregate counts only, so a large table costs one scan per run, and prints the report.
// Options: --as-of 2026-11-02 evaluates the rule as of that day instead of today.

import { loadConfig } from '../src/config.js';
import { buildReport, RESULTS_SQL, toReportData } from '../src/report.js';
import { d1Execute, flagValue, parseTarget, readConfigFile } from './lib/d1.mjs';

function main(argv) {
  const target = parseTarget(argv);
  const asOfFlag = flagValue(argv, '--as-of');
  const asOf = asOfFlag ? new Date(`${asOfFlag}T12:00:00Z`) : new Date();
  if (Number.isNaN(asOf.getTime())) throw new Error(`--as-of needs a date like 2026-11-02 (got ${asOfFlag}).`);
  const config = loadConfig(readConfigFile());
  const data = toReportData(d1Execute({ remote: target.remote, sql: RESULTS_SQL }));
  console.log(buildReport({ config, data, asOf, sourceLabel: target.label }));
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
