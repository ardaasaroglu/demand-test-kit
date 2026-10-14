# Security

The kit collects email addresses for a waitlist, so this page says plainly what it stores, how it protects that data, and where the protection stops.

## What it stores

In the D1 database on your own Cloudflare account:

* **Views:** the price shown, the link tag, the time, a random page-view number and whether the visitor was new. No IP address, no user agent, no identifier that follows a person between visits.
* **Button presses:** the page view they belong to and the type, at most one row per page view and type.
* **Sign-ups:** the email address, the optional name and answer, the price shown, the link tag, the consent version and the time.

A scheduled job deletes rows older than `privacy.retentionDays` once a day. Request logs (`invocation_logs`) are switched off in `wrangler.jsonc`, so Cloudflare's Workers Logs keep only the error messages the code writes. The code never logs form fields.

## How it is protected

* **No way to read data back over the web.** There is no admin page and no API that returns stored rows. Results and exports run on your machine with your own `wrangler login`.
* **Strict headers on every response.** A Content Security Policy with `default-src 'none'` and no inline script or style, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`, `Referrer-Policy: same-origin`, a restrictive `Permissions-Policy` and HSTS. Static files get their headers from `public/_headers`.
* **Escaped output.** Every value from `kit.config.json` is HTML-escaped. A test fills every text field with markup and checks that none of it survives.
* **Checked input.** POST endpoints refuse requests whose `Origin` is another site, cap body size (1 KB for events, 8 KB for sign-ups), accept only allowlisted event types, and take the price and link tag of a sign-up from the stored page view, not from the browser.
* **Addresses stay out of URLs.** The sign-up form uses POST, and its button stays disabled until the page script runs. An email address never ends up in a URL or in browser history.
* **No list enumeration.** A repeat sign-up gets the same answer as a new one.
* **Bot friction.** A hidden honeypot field, and a speed bump of 5 sign-ups per IP address per 10 minutes. The speed bump keeps a salted SHA-256 hash of the IP address in memory only, never in the database.
* **Safe exports.** The CSV export prefixes cells that a spreadsheet would run as a formula.
* **Random numbers from the platform.** Page-view numbers come from `crypto.randomUUID()`, and prices are assigned with `crypto.getRandomValues()` without modulo bias.

## Where it stops

* The speed bump lives in one Worker instance, and Cloudflare runs many. It slows a script down. It does not stop a determined one. For real abuse, add Cloudflare Turnstile or a rate limiting rule in your Cloudflare dashboard.
* There is no email confirmation, so anyone can type someone else's address. The kit never sends email to it.
* The kit adds no encryption of its own. The data is as safe as your Cloudflare account: turn on two-factor authentication.
* The bot filter reads the user agent, so a bot that pretends to be a browser is counted.

## Reporting a vulnerability

Report it privately at <https://github.com/ardaasaroglu/demand-test-kit/security/advisories/new>. Please do not open a public issue for a security problem.

That link works only while private vulnerability reporting is enabled in this repository's settings. If it shows an error, open an issue asking for a private contact, and leave out any details of the problem.
