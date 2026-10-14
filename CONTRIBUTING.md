# Contributing

Small, focused changes are welcome. A few rules keep the kit what it is.

1. **Nothing from other companies.** The page loads no third-party script, font, image or analytics. The Content Security Policy enforces it, and the tests check it.
2. **Honest pages.** The "not available yet" notice stays before the email field, and the kit never asks for payment.
3. **Every stored field is disclosed.** A new column, cookie or kind of data also changes the privacy notice template and the README in the same pull request.
4. **Statistics come with a worked example.** A change to `src/stats.js` or `src/killrule.js` adds a test against a published value or a closed-form result.
5. **No build step and no runtime dependencies.** Plain JavaScript modules. `wrangler` is the only development dependency.
6. **One config file.** A new option goes into `kit.config.json`, with validation in `src/config.js` and a clear error message.

Before opening a pull request:

* Run `npm run check` and `npm test`. CI runs both on Node 22 and 24.
* Run `npm run dev` and try the change in a browser at <http://localhost:8787>. A test that passes is not a page that works.
* If you changed a template, a file in `public/` or `kit.config.json`, run `npm run demo:build` and commit `docs/`. CI fails when the demo is out of date.
* Do not commit `.wrangler/`, `exports/` or a `database_id` that points at your own account.

Found a security problem? Follow [SECURITY.md](SECURITY.md) and do not open a public issue.
