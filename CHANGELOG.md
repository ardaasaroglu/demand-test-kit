# Changelog

## 0.1.0 (2026-10-14)

First public release.

* A landing page for a product that does not exist yet, written from `kit.config.json`, with an example for a fictional gardening app.
* A price test across 2 to 4 planned prices, split evenly, with three cookie modes: a sticky cookie with a one-click opt-out, a consent banner, or no cookie at all.
* A waitlist with an email address, an optional name, one optional question and an unticked consent box. Repeat sign-ups are ignored without saying so. A honeypot field and a per-IP speed bump slow down bots.
* Link tags with `?src=` (or `?utm_source=`), and a share link tagged `share` after joining.
* `npm run results`: visitors, clicks and sign-ups per price, conversion with Wilson intervals, revenue per 100 visitors, P(best) on revenue per visitor, Newcombe's interval for the top two, a source table, and a verdict from a kill rule set in advance.
* `npm run export` with a CSV formula guard, and `npm run forget` for deletion requests.
* A privacy notice generated from the config, and a daily job that deletes rows older than the retention period.
* A Content Security Policy with no inline code, no third-party requests, and security headers on every response.
* Tests with `node:test` and wrangler's `createTestHarness`, and a static demo on GitHub Pages.
