// `npm run check`: validates kit.config.json and prints every problem and warning.
// `npm run dev` and `npm run deploy` run it first. CI runs it too.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateConfig } from '../src/config.js';
import { ROOT } from './lib/d1.mjs';

const file = resolve(ROOT, process.argv[2] ?? 'kit.config.json');
let raw;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`Could not read ${file}: ${error.message}`);
  process.exit(1);
}

const { errors, warnings } = validateConfig(raw);
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  console.error(`kit.config.json has ${errors.length === 1 ? '1 problem' : `${errors.length} problems`}:`);
  for (const e of errors) console.error(`  * ${e}`);
  process.exit(1);
}
console.log('kit.config.json is valid.');
