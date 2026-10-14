// Runs SQL against the kit's D1 database through the wrangler CLI in node_modules.
// Remote reads use your own `wrangler login`. Nothing here stores or prints credentials.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function wranglerBin() {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('wrangler/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return join(dirname(pkgPath), pkg.bin.wrangler);
}

/** Reads --local or --remote from the arguments. Exactly one is required. */
export function parseTarget(argv) {
  const local = argv.includes('--local');
  const remote = argv.includes('--remote');
  if (local === remote) {
    throw new Error('Pass exactly one of --local (the database `npm run dev` uses) or --remote (the deployed one).');
  }
  return { remote, label: remote ? 'remote D1' : 'local D1' };
}

/** Returns the value after a flag such as --out, or undefined. */
export function flagValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Applies migrations that have not run yet. */
export function applyMigrations({ remote }) {
  const result = spawnSync(process.execPath, [wranglerBin(), 'd1', 'migrations', 'apply', 'DB', remote ? '--remote' : '--local'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`wrangler d1 migrations apply failed:\n${result.stderr || result.stdout}`);
}

/**
 * Runs one or more SQL statements (separated by semicolons) or a SQL file, and returns one
 * array of rows per statement.
 */
export function d1Execute({ remote, sql, file }) {
  const args = [wranglerBin(), 'd1', 'execute', 'DB', remote ? '--remote' : '--local', '--json'];
  if (file) args.push('--file', file);
  else args.push('--command', sql);
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) {
    const text = `${result.stdout}\n${result.stderr}`;
    if (/no such table/i.test(text)) {
      throw new Error(
        remote
          ? 'The remote database has no tables yet. Run `npm run deploy`, which applies the migrations.'
          : 'The local database has no tables yet. Run `npm run dev` once, or `npx wrangler d1 migrations apply DB --local`.',
      );
    }
    throw new Error(`wrangler d1 execute failed:\n${text.trim()}`);
  }
  const parsed = JSON.parse(result.stdout);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((r) => r.results ?? []);
}

export function readConfigFile() {
  return JSON.parse(readFileSync(join(ROOT, 'kit.config.json'), 'utf8'));
}
