// `npm run forget -- person@example.com`: deletes one person's sign-up from the deployed database,
// for a deletion request. Add --local to use the local database instead.

import { normalizeEmail } from '../src/validate.js';
import { d1Execute } from './lib/d1.mjs';

function main(argv) {
  const remote = !argv.includes('--local');
  const raw = argv.find((a) => !a.startsWith('--'));
  const email = normalizeEmail(raw ?? '');
  if (!email) throw new Error('Usage: npm run forget -- person@example.com');
  // wrangler d1 execute takes no bound parameters, so the address goes into the SQL as a literal.
  // normalizeEmail rejects double quotes. Single quotes are allowed in addresses, so they are
  // doubled here, which is how SQL escapes them inside a string.
  const literal = `'${email.replace(/'/g, "''")}'`;
  const [, [count]] = d1Execute({
    remote,
    sql: `DELETE FROM signups WHERE email = ${literal}; SELECT changes() AS n`,
  });
  const n = count?.n ?? 0;
  console.log(n ? `Deleted the sign-up for ${email} from the ${remote ? 'remote' : 'local'} database.` : `No sign-up for ${email} in the ${remote ? 'remote' : 'local'} database.`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
