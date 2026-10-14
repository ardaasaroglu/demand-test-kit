// Integration tests for the Worker with the real wrangler.jsonc and kit.config.json
// (privacy.stickiness = "cookie"). They run in the local Workers runtime with a local D1.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { CSP, SIGNUP_LIMIT } from '../src/app.js';
import { RESULTS_SQL, toReportData } from '../src/report.js';
import { IN_APP_BROWSERS } from './fixtures/user-agents.mjs';
import { BROWSER, cookieValue, db, postJson, rows, setCookies, useHarness, visit } from './helpers.mjs';

const config = JSON.parse(readFileSync(new URL('../kit.config.json', import.meta.url), 'utf8'));
const variantIds = config.pricing.variants.map((v) => v.id);
const h = useHarness(new URL('../wrangler.jsonc', import.meta.url), { before, beforeEach, after });
const server = () => h.server;

function signupBody(overrides = {}) {
  return { email: 'Grower@Example.org', name: 'Robin', answer: 'garden', consent: true, website: '', ...overrides };
}

describe('the landing page', () => {
  test('renders with a price, strict security headers and no caching', async () => {
    const { response, html, variant } = await visit(server());
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.equal(response.headers.get('content-security-policy'), CSP);
    assert.match(CSP, /default-src 'none'/);
    assert.match(CSP, /script-src 'self'/);
    assert.doesNotMatch(CSP, /unsafe-inline|unsafe-eval|https?:/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'same-origin');
    assert.match(response.headers.get('permissions-policy'), /camera=\(\)/);
    assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(variantIds.includes(variant));
    const price = config.pricing.variants.find((v) => v.id === variant).price;
    assert.match(html, new RegExp(`<span class="amount">\\$${price}</span>`));
    assert.ok(!html.includes('{{'), 'no unfilled placeholder');
  });

  test('has no inline scripts, inline styles, event handlers or third-party resources', async () => {
    const { html } = await visit(server());
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'every script has a src');
    assert.doesNotMatch(html, /<style/i);
    assert.doesNotMatch(html, /\sstyle=/i);
    assert.doesNotMatch(html, /\son[a-z]+=/i);
    for (const [, url] of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
      assert.ok(url.startsWith('/') || url.startsWith('#'), `same-origin resource: ${url}`);
    }
  });

  test('says the product is not available before the email field', async () => {
    const { html } = await visit(server());
    const notAvailable = html.indexOf('is not available yet.</strong>');
    assert.ok(notAvailable > 0);
    assert.ok(notAvailable < html.indexOf('id="f-email"'));
    assert.match(html, /We never ask for payment here/);
    assert.match(html, /Nothing is charged on this page/);
  });

  test('the consent box is unticked and the honeypot is hidden from people', async () => {
    const { html } = await visit(server());
    const box = html.match(/<input id="f-consent"[^>]*>/)[0];
    assert.doesNotMatch(box, /checked/);
    assert.match(html, /<div class="hp" aria-hidden="true">/);
    assert.match(html, /id="f-website"[^>]*tabindex="-1"/);
  });

  test('sets a sticky price cookie and records one view for a new visitor', async () => {
    const { response, view, variant } = await visit(server(), '/?src=Newsletter');
    const line = setCookies(response).find((c) => c.startsWith('dtk_variant='));
    assert.ok(line, 'cookie set');
    assert.equal(cookieValue(response, 'dtk_variant'), variant);
    for (const attr of ['Path=/', `Max-Age=${config.test.maxDays * 86400}`, 'SameSite=Lax', 'Secure', 'HttpOnly']) {
      assert.ok(line.includes(attr), `cookie has ${attr}`);
    }
    assert.match(view, /^[a-f0-9]{32}$/);
    const stored = await rows(h, 'SELECT * FROM views');
    assert.equal(stored.length, 1);
    assert.deepEqual(
      { id: stored[0].id, variant: stored[0].variant, src: stored[0].src, first: stored[0].first },
      { id: view, variant, src: 'newsletter', first: 1 },
    );
  });

  test('a returning visitor keeps the same price and counts as a repeat view', async () => {
    const first = await visit(server());
    for (let i = 0; i < 3; i++) {
      const again = await visit(server(), '/', { cookie: `dtk_variant=${first.variant}` });
      assert.equal(again.variant, first.variant);
      assert.equal(setCookies(again.response).length, 0, 'no new cookie');
    }
    const stored = await rows(h, 'SELECT first, COUNT(*) AS n FROM views GROUP BY first ORDER BY first');
    assert.deepEqual(stored.map((r) => [r.first, r.n]), [
      [0, 3],
      [1, 1],
    ]);
  });

  test('?view= only resumes a page view in consent mode, not here', async () => {
    const first = await visit(server());
    const again = await visit(server(), `/?view=${first.view}`, { cookie: `dtk_variant=${first.variant}` });
    assert.notEqual(again.view, first.view);
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM views'))[0].n, 2);
  });

  test('a cookie for a price that no longer exists gets a new price', async () => {
    const { response, variant } = await visit(server(), '/', { cookie: 'dtk_variant=zz' });
    assert.ok(variantIds.includes(variant));
    assert.equal(cookieValue(response, 'dtk_variant'), variant);
    assert.equal((await rows(h, 'SELECT first FROM views'))[0].first, 1);
  });

  test('splits new visitors evenly across the prices', async () => {
    const visits = 300;
    const seen = Object.fromEntries(variantIds.map((id) => [id, 0]));
    for (let i = 0; i < visits; i++) seen[(await visit(server())).variant] += 1;
    const expected = visits / variantIds.length;
    for (const id of variantIds) {
      // Each count is Binomial(300, 1/3): mean 100, sd 8.2. 60 and 140 are almost 5 sd away.
      assert.ok(seen[id] > expected - 40 && seen[id] < expected + 40, `${id}: ${seen[id]} of ${visits}`);
    }
    const stored = await rows(h, 'SELECT variant, COUNT(*) AS n FROM views GROUP BY variant');
    assert.equal(stored.reduce((s, r) => s + r.n, 0), visits, 'one view per GET, none for HEAD');
  });

  test('reads the link tag from ?src= or ?utm_source= and cleans it', async () => {
    const cases = [
      ['/?src=Forum', 'forum'],
      ['/?utm_source=Mailing-List_2', 'mailing-list_2'],
      ['/?src=%3Cscript%3E', 'other'],
      ['/?src=' + 'x'.repeat(40), 'other'],
      ['/', 'direct'],
    ];
    for (const [path] of cases) await visit(server(), path);
    const stored = await rows(h, 'SELECT src FROM views');
    assert.deepEqual(stored.map((r) => r.src).sort(), cases.map(([, src]) => src).sort());
  });

  test('bots, link previews and scripts are not counted and get no cookie', async () => {
    const agents = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'facebookexternalhit/1.1',
      'WhatsApp/2.23.20.0',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
      'TelegramBot (like TwitterBot)',
      'Pinterest/0.2 (+https://www.pinterest.com/bot.html)',
      'Slackbot-LinkExpanding 1.0',
      'http.rb/5.1.1 (Mastodon/4.2.10; +https://mastodon.example/)',
      'Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@example.org)',
      'curl/8.4.0',
      'python-requests/2.32',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0 Safari/537.36',
      '',
    ];
    for (const ua of agents) {
      const response = await server().fetch('/', { headers: { 'user-agent': ua } });
      const html = await response.text();
      assert.equal(response.status, 200, ua);
      assert.equal(setCookies(response).length, 0, `no cookie for ${ua}`);
      assert.match(html, /data-view=""/);
    }
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM views'))[0].n, 0);
  });

  test('people in the in-app browsers of social apps are counted and get the price cookie', async () => {
    for (const ua of IN_APP_BROWSERS) {
      const { response, view, variant } = await visit(server(), '/?src=social', { 'user-agent': ua });
      assert.match(view, /^[a-f0-9]{32}$/, ua);
      assert.equal(cookieValue(response, 'dtk_variant'), variant, ua);
    }
    const stored = await rows(h, "SELECT COUNT(*) AS n FROM views WHERE src = 'social' AND first = 1");
    assert.equal(stored[0].n, IN_APP_BROWSERS.length);
  });

  test('HEAD returns headers only and records nothing', async () => {
    const response = await server().fetch('/', { method: 'HEAD', headers: { 'user-agent': BROWSER } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
    assert.equal(setCookies(response).length, 0);
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM views'))[0].n, 0);
  });

  test('shows the cookie notice with an opt-out link', async () => {
    const { html } = await visit(server());
    assert.match(html, /One cookie remembers which price you saw/);
    assert.match(html, /<a href="\/api\/optout">Opt out of testing<\/a>/);
    assert.match(html, /<a href="\/api\/optout">Opt out of price testing<\/a>/);
    assert.doesNotMatch(html, /class="consent"/);
  });
});

describe('opting out of testing', () => {
  test('GET /api/optout sets the opt-out cookie, clears the price cookie and goes home', async () => {
    const response = await server().fetch('/api/optout', { headers: { 'user-agent': BROWSER, cookie: 'dtk_variant=b' }, redirect: 'manual' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/');
    const cookies = setCookies(response);
    assert.ok(cookies.some((c) => c.startsWith('dtk_optout=1;') && c.includes('Max-Age=31536000') && c.includes('HttpOnly')));
    assert.ok(cookies.some((c) => c.startsWith('dtk_variant=;') && c.includes('Max-Age=0')));
  });

  test('POST /api/optout answers 204', async () => {
    const response = await server().fetch('/api/optout', { method: 'POST', headers: { 'user-agent': BROWSER } });
    assert.equal(response.status, 204);
    assert.equal(cookieValue(response, 'dtk_optout'), '1');
  });

  test('an opted-out visitor sees the standard price, gets no cookie and is not counted', async () => {
    const { response, html, view, variant } = await visit(server(), '/', { cookie: 'dtk_optout=1; dtk_variant=c' });
    assert.equal(variant, variantIds[0]);
    assert.equal(view, '');
    assert.equal(setCookies(response).length, 0);
    assert.match(html, /You opted out of price testing/);
    assert.doesNotMatch(html, /Opt out of price testing/);
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM views'))[0].n, 0);
  });

  test('an opted-out visitor can still join, outside the test', async () => {
    const response = await postJson(server(), '/api/signup', signupBody({ view: '', variant: variantIds[0], src: 'forum' }), {
      cookie: 'dtk_optout=1',
    });
    assert.equal(response.status, 200);
    const [row] = await rows(h, 'SELECT variant, price, src, view_id FROM signups');
    assert.deepEqual({ ...row }, { variant: null, price: config.pricing.variants[0].price, src: 'forum', view_id: null });
  });
});

describe('button events', () => {
  test('records a press against the stored view, once per view and type', async () => {
    const { view, variant } = await visit(server(), '/?src=forum');
    for (let i = 0; i < 3; i++) {
      const response = await postJson(server(), '/api/event', { type: 'cta_click', view });
      assert.equal(response.status, 204);
    }
    await postJson(server(), '/api/event', { type: 'price_click', view });
    const stored = await rows(h, 'SELECT type, variant, src FROM events ORDER BY type');
    assert.deepEqual(stored.map((r) => ({ ...r })), [
      { type: 'cta_click', variant, src: 'forum' },
      { type: 'price_click', variant, src: 'forum' },
    ]);
  });

  test('accepts the text/plain body that sendBeacon sends', async () => {
    const { view } = await visit(server());
    const response = await server().fetch('/api/event', {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': BROWSER },
      body: JSON.stringify({ type: 'share_click', view }),
    });
    assert.equal(response.status, 204);
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM events'))[0].n, 1);
  });

  test('ignores an unknown view without saying so', async () => {
    const response = await postJson(server(), '/api/event', { type: 'cta_click', view: 'f'.repeat(32) });
    assert.equal(response.status, 204);
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM events'))[0].n, 0);
  });

  test('rejects event types outside the allowlist and malformed bodies', async () => {
    const { view } = await visit(server());
    for (const body of [{ type: 'purchase', view }, { type: 'cta_click', view: 'nope' }, { type: 'cta_click' }, 'not json', '[1,2]']) {
      const response = await postJson(server(), '/api/event', body);
      assert.equal(response.status, 400, JSON.stringify(body));
    }
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM events'))[0].n, 0);
  });

  test('refuses a request from another site and an oversized body', async () => {
    const { view } = await visit(server());
    const cross = await postJson(server(), '/api/event', { type: 'cta_click', view }, { origin: 'https://evil.example' });
    assert.equal(cross.status, 403);
    const big = await postJson(server(), '/api/event', { type: 'cta_click', view, pad: 'x'.repeat(2000) });
    assert.equal(big.status, 413);
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM events'))[0].n, 0);
  });
});

describe('waitlist sign-up', () => {
  test('stores a valid sign-up with the price and link tag of its view', async () => {
    const { view, variant } = await visit(server(), '/?src=newsletter');
    const response = await postJson(server(), '/api/signup', signupBody({ view, variant: 'c', src: 'forged' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    const [row] = await rows(h, 'SELECT * FROM signups');
    const price = config.pricing.variants.find((v) => v.id === variant).price;
    assert.equal(row.email, 'grower@example.org');
    assert.equal(row.name, 'Robin');
    assert.equal(row.answer, 'garden');
    assert.equal(row.variant, variant, 'variant comes from the stored view, not the request');
    assert.equal(row.price, price);
    assert.equal(row.src, 'newsletter');
    assert.equal(row.view_id, view);
    assert.equal(row.consent_version, config.form.consentVersion);
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('a repeat sign-up answers ok and keeps the first row', async () => {
    const { view } = await visit(server());
    const first = await postJson(server(), '/api/signup', signupBody({ view }));
    const second = await postJson(server(), '/api/signup', signupBody({ view, email: '  GROWER@example.ORG ', name: 'Someone else' }));
    assert.deepEqual(await first.json(), { ok: true });
    assert.deepEqual(await second.json(), { ok: true });
    assert.equal(second.status, first.status);
    const stored = await rows(h, 'SELECT email, name FROM signups');
    assert.deepEqual(stored.map((r) => ({ ...r })), [{ email: 'grower@example.org', name: 'Robin' }]);
  });

  test('requires a plausible email address', async () => {
    for (const email of ['', 'not-an-email', 'a@b', 'two@@example.org', 'space in@example.org', 'dot..dot@example.org', 42]) {
      const response = await postJson(server(), '/api/signup', signupBody({ email }));
      assert.equal(response.status, 422, String(email));
      const out = await response.json();
      assert.equal(out.ok, false);
      assert.ok(out.errors.email);
    }
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM signups'))[0].n, 0);
  });

  test('requires explicit consent: the boolean true, nothing else', async () => {
    for (const consent of [false, 'true', 'on', 1, undefined]) {
      const response = await postJson(server(), '/api/signup', signupBody({ consent }));
      assert.equal(response.status, 422, String(consent));
      assert.ok((await response.json()).errors.consent);
    }
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM signups'))[0].n, 0);
  });

  test('checks the answer and the name', async () => {
    const bad = await postJson(server(), '/api/signup', signupBody({ answer: 'moon' }));
    assert.equal(bad.status, 422);
    assert.ok((await bad.json()).errors.answer);
    const long = await postJson(server(), '/api/signup', signupBody({ name: 'n'.repeat(81) }));
    assert.equal(long.status, 422);
    assert.ok((await long.json()).errors.name);
    const optional = await postJson(server(), '/api/signup', signupBody({ answer: '', name: '' }));
    assert.equal(optional.status, 200, 'the question and name are optional in the example');
    const [row] = await rows(h, 'SELECT name, answer FROM signups');
    assert.deepEqual({ ...row }, { name: null, answer: null });
  });

  test('cleans control characters out of the name', async () => {
    const response = await postJson(server(), '/api/signup', signupBody({ name: ' Ro\u0000bin \n\t Ash ' }));
    assert.equal(response.status, 200);
    assert.equal((await rows(h, 'SELECT name FROM signups'))[0].name, 'Ro bin Ash');
  });

  test('the honeypot answers ok and stores nothing', async () => {
    const response = await postJson(server(), '/api/signup', signupBody({ website: 'https://spam.example' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM signups'))[0].n, 0);
  });

  test(`the speed bump stops the ${SIGNUP_LIMIT + 1}th sign-up from one IP address`, async () => {
    for (let i = 0; i < SIGNUP_LIMIT; i++) {
      const ok = await postJson(server(), '/api/signup', signupBody({ email: `person${i}@example.org` }), { 'cf-connecting-ip': '203.0.113.7' });
      assert.equal(ok.status, 200);
    }
    const blocked = await postJson(server(), '/api/signup', signupBody({ email: 'one-more@example.org' }), { 'cf-connecting-ip': '203.0.113.7' });
    assert.equal(blocked.status, 429);
    assert.match((await blocked.json()).error, /Too many sign-ups/);
    const other = await postJson(server(), '/api/signup', signupBody({ email: 'neighbour@example.org' }), { 'cf-connecting-ip': '198.51.100.9' });
    assert.equal(other.status, 200, 'another address is not affected');
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM signups'))[0].n, SIGNUP_LIMIT + 1);
  });

  test('invalid attempts do not use up the speed bump', async () => {
    for (let i = 0; i < SIGNUP_LIMIT + 2; i++) {
      await postJson(server(), '/api/signup', signupBody({ email: 'typo' }), { 'cf-connecting-ip': '203.0.113.8' });
    }
    const ok = await postJson(server(), '/api/signup', signupBody(), { 'cf-connecting-ip': '203.0.113.8' });
    assert.equal(ok.status, 200);
  });

  test('refuses another site, a form post, a non-object body and an oversized body', async () => {
    const cross = await postJson(server(), '/api/signup', signupBody(), { origin: 'https://evil.example' });
    assert.equal(cross.status, 403);
    const { url } = await h.server.listen();
    const sameOrigin = await postJson(server(), '/api/signup', signupBody(), { origin: url.origin });
    assert.equal(sameOrigin.status, 200, 'a request from the page itself is accepted');
    const form = await server().fetch('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': BROWSER },
      body: 'email=form-post%40example.org&consent=on',
    });
    assert.equal(form.status, 400);
    assert.match(form.headers.get('content-type'), /^text\/plain/);
    const formText = await form.text();
    assert.match(formText, /needs JavaScript/);
    assert.ok(!formText.includes('form-post'), 'the address is not echoed');
    const array = await postJson(server(), '/api/signup', '[]');
    assert.equal(array.status, 400);
    const big = await postJson(server(), '/api/signup', signupBody({ name: 'x'.repeat(9000) }));
    assert.equal(big.status, 413);
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM signups'))[0].n, 1);
  });

  test('the form posts to the API, so the email address is never put in a URL', async () => {
    const { html } = await visit(server());
    const form = html.match(/<form id="signup"[^>]*>/)[0];
    assert.match(form, /\smethod="post"/, 'GET is the default, so the method must be explicit');
    assert.match(form, /\saction="\/api\/signup"/);
  });

  test('the submit button stays disabled until the page script turns it on', async () => {
    const { html } = await visit(server());
    assert.match(html, /<button class="btn btn-wide" type="submit" disabled>Join the waitlist<\/button>/);
    assert.match(html, /<noscript>[^<]*<p class="fine">The form needs JavaScript/);
    const script = await server().fetch('/assets/app.js');
    assert.match(await script.text(), /submit\.disabled = false;/);
  });
});

describe('the privacy notice', () => {
  test('fills every placeholder from the config', async () => {
    const response = await server().fetch('/privacy', { headers: { 'user-agent': BROWSER } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-security-policy'), CSP);
    const html = await response.text();
    assert.ok(!html.includes('{{'));
    const p = config.privacy;
    assert.ok(html.includes(p.controllerName));
    assert.ok(html.includes(`mailto:${p.contactEmail}`));
    assert.ok(html.includes(`${p.retentionDays} days after they were collected`));
    assert.ok(html.includes(`Last updated ${p.lastUpdated}`));
    assert.ok(html.includes(p.jurisdictionNote));
    assert.match(html, /<code>dtk_variant<\/code>/);
    assert.match(html, /<code>dtk_optout<\/code>/);
    assert.ok(html.includes(`${config.test.maxDays} days`));
    assert.match(html, /Cloudflare/);
    assert.match(html, /your answer to "Where do you grow\?"/);
    assert.match(html, /your name, if you give it/);
    assert.match(html, /id="cookies"/);
  });

  test('is not counted as a visit', async () => {
    await server().fetch('/privacy', { headers: { 'user-agent': BROWSER } });
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM views'))[0].n, 0);
  });
});

describe('routing and static files', () => {
  test('unknown pages and API routes are 404, wrong methods are 405', async () => {
    const page = await server().fetch('/nope');
    assert.equal(page.status, 404);
    const api = await server().fetch('/api/nope', { method: 'POST' });
    assert.equal(api.status, 404);
    assert.match(api.headers.get('content-type'), /application\/json/);
    const method = await server().fetch('/api/signup');
    assert.equal(method.status, 405);
    assert.equal(method.headers.get('allow'), 'POST');
    const put = await server().fetch('/', { method: 'PUT' });
    assert.equal(put.status, 405);
  });

  test('the consent endpoint is off in cookie mode', async () => {
    const response = await postJson(server(), '/api/consent', { choice: 'allow', variant: 'a' });
    assert.equal(response.status, 404);
    assert.equal(setCookies(response).length, 0);
  });

  test('static files are served with their own security headers', async () => {
    for (const path of ['/assets/style.css', '/assets/app.js', '/assets/favicon.svg', '/assets/hero.svg', '/assets/og.png', '/favicon.ico', '/robots.txt']) {
      const response = await server().fetch(path);
      await response.arrayBuffer();
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
      assert.match(response.headers.get('content-security-policy'), /default-src 'none'/, path);
    }
    const headersFile = await server().fetch('/_headers');
    await headersFile.arrayBuffer();
    assert.equal(headersFile.status, 404, 'the _headers file itself is not served');
  });

  test('templates are bundled into the Worker, not served as files', async () => {
    for (const path of ['/templates/landing.html', '/src/templates/landing.html', '/kit.config.json']) {
      const response = await server().fetch(path);
      await response.arrayBuffer();
      assert.equal(response.status, 404, path);
    }
  });
});

describe('the daily clean-up', () => {
  test('deletes rows older than privacy.retentionDays and keeps newer ones', async () => {
    const DB = await db(h);
    const now = Date.parse('2026-10-14T03:17:00Z');
    const old = new Date(now - (config.privacy.retentionDays + 1) * 86_400_000).toISOString();
    const fresh = new Date(now - 86_400_000).toISOString();
    await DB.batch([
      DB.prepare("INSERT INTO views VALUES ('old', ?, 'a', 'direct', 1)").bind(old),
      DB.prepare("INSERT INTO views VALUES ('new', ?, 'a', 'direct', 1)").bind(fresh),
      DB.prepare("INSERT INTO events VALUES ('old', 'cta_click', ?, 'a', 'direct')").bind(old),
      DB.prepare("INSERT INTO events VALUES ('new', 'cta_click', ?, 'a', 'direct')").bind(fresh),
      DB.prepare("INSERT INTO signups (email, created_at, src, consent_version) VALUES ('old@example.org', ?, 'direct', '1')").bind(old),
      DB.prepare("INSERT INTO signups (email, created_at, src, consent_version) VALUES ('new@example.org', ?, 'direct', '1')").bind(fresh),
    ]);
    const result = await h.worker.scheduled({ cron: '17 3 * * *', scheduledTime: new Date(now) });
    assert.equal(result.outcome, 'ok');
    assert.deepEqual((await rows(h, 'SELECT id FROM views')).map((r) => r.id), ['new']);
    assert.deepEqual((await rows(h, 'SELECT view_id FROM events')).map((r) => r.view_id), ['new']);
    assert.deepEqual((await rows(h, 'SELECT email FROM signups')).map((r) => r.email), ['new@example.org']);
  });
});

describe('the schema', () => {
  test('each insert writes one row, with no extra index rows', async () => {
    const DB = await db(h);
    const view = await DB.prepare("INSERT INTO views VALUES ('v1', 't', 'a', 'direct', 1)").run();
    assert.equal(view.meta.rows_written, 1);
    const event = await DB.prepare("INSERT OR IGNORE INTO events SELECT id, 'cta_click', 't', variant, src FROM views WHERE id = 'v1'").run();
    assert.equal(event.meta.rows_written, 1);
    const signup = await DB.prepare("INSERT INTO signups (email, created_at, src, consent_version) VALUES ('a@example.org', 't', 'direct', '1')").run();
    assert.equal(signup.meta.rows_written, 1);
  });
});

describe('the results query against D1', () => {
  test('counts what the Worker recorded, in one grouped scan per table', async () => {
    const one = await visit(server(), '/?src=newsletter');
    await visit(server(), '/', { cookie: `dtk_variant=${one.variant}` });
    const two = await visit(server(), '/?src=forum');
    await postJson(server(), '/api/event', { type: 'cta_click', view: one.view });
    await postJson(server(), '/api/event', { type: 'price_click', view: one.view });
    await postJson(server(), '/api/event', { type: 'share_click', view: two.view });
    await postJson(server(), '/api/signup', signupBody({ view: one.view }));
    await postJson(server(), '/api/signup', signupBody({ email: 'outside@example.org', view: '' }));

    const DB = await db(h);
    const statements = RESULTS_SQL.split(';').map((q) => q.trim()).filter(Boolean);
    const results = [];
    const reads = [];
    for (const sql of statements) {
      const result = await DB.prepare(sql).all();
      results.push(result.results);
      reads.push(result.meta.rows_read);
    }
    const data = toReportData(results);
    const expected = Object.fromEntries(variantIds.map((id) => [id, { visitors: 0, views: 0, clicked: 0, signups: 0 }]));
    expected[one.variant].visitors += 1;
    expected[one.variant].views += 2;
    expected[one.variant].clicked += 1;
    expected[one.variant].signups += 1;
    expected[two.variant].visitors += 1;
    expected[two.variant].views += 1;
    for (const id of variantIds) assert.deepEqual(data.variants[id] ?? { visitors: 0, views: 0, clicked: 0, signups: 0 }, expected[id], id);
    assert.equal(data.outsideSignups, 1);
    assert.equal(data.shareClicks, 1);
    // The repeat visit came without a tag, so "direct" has a view but no new visitor.
    assert.deepEqual(
      data.sources.sort((a, b) => a.src.localeCompare(b.src)),
      [
        { src: 'direct', visitors: 0, signups: 0 },
        { src: 'forum', visitors: 1, signups: 0 },
        { src: 'newsletter', visitors: 1, signups: 1 },
      ],
    );
    // 3 views, 3 events and 2 sign-ups. The cost grows with the table, not faster: the local
    // runtime counts two reads per stored row for a grouped scan.
    assert.deepEqual(reads, [6, 6, 4]);
  });
});

