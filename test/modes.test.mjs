// Integration tests for the other stickiness modes ("consent" and "none"), HTML escaping of
// every config value, and a config without the optional parts. One test Worker serves several
// configs, chosen per request (see test/fixtures/modes/worker.js).

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { BROWSER, cookieValue, nextIp, rows, setCookies, useHarness, visit } from './helpers.mjs';

const h = useHarness(new URL('./fixtures/modes/wrangler.jsonc', import.meta.url), { before, beforeEach, after });
const as = (mode, headers = {}) => ({ 'x-test-config': mode, ...headers });
const page = (mode, path = '/', headers = {}) => visit(h.server, path, as(mode, headers));

function post(mode, path, body, { form = false, headers = {} } = {}) {
  return h.server.fetch(path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      'user-agent': BROWSER,
      'cf-connecting-ip': nextIp(),
      ...as(mode, headers),
    },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
}

describe('consent mode', () => {
  test('sets no cookie until the visitor allows it, and shows the question', async () => {
    const { response, html, variant, view } = await page('consent');
    assert.equal(setCookies(response).length, 0);
    assert.match(html, /<div class="consent" role="region" aria-label="Cookie choice">/);
    assert.match(html, new RegExp(`<input type="hidden" name="variant" value="${variant}">`));
    assert.match(html, new RegExp(`<input type="hidden" name="view" value="${view}">`));
    assert.match(html, /value="allow">Allow<\/button>/);
    assert.match(html, /value="decline">No thanks<\/button>/);
    assert.doesNotMatch(html, /Opt out of/);
    const [row] = await rows(h, 'SELECT id, first FROM views');
    assert.deepEqual({ ...row }, { id: view, first: 1 });
  });

  test('Allow sets the price cookie, for fetch and for a plain form post', async () => {
    const json = await post('consent', '/api/consent', { choice: 'allow', variant: 'b' });
    assert.equal(json.status, 204);
    assert.equal(cookieValue(json, 'dtk_variant'), 'b');
    const form = await post('consent', '/api/consent', { choice: 'allow', variant: 'c' }, { form: true });
    assert.equal(form.status, 303);
    assert.equal(form.headers.get('location'), '/');
    assert.equal(cookieValue(form, 'dtk_variant'), 'c');
  });

  test('without JavaScript, No thanks goes back to the same price and page view', async () => {
    const first = await page('consent', '/?src=forum');
    const decline = await post('consent', '/api/consent', { choice: 'decline', variant: first.variant, view: first.view }, { form: true });
    assert.equal(decline.status, 303);
    assert.equal(decline.headers.get('location'), `/?view=${first.view}`);
    assert.equal(setCookies(decline).length, 0);
    const back = await page('consent', `/?view=${first.view}`);
    assert.equal(back.variant, first.variant);
    assert.equal(back.view, first.view, 'the same page view, so a sign-up keeps its link tag');
    assert.equal(setCookies(back.response).length, 0);
    assert.doesNotMatch(back.html, /class="consent"/, 'the question is not asked again right away');
    const stored = await rows(h, 'SELECT id, first FROM views');
    assert.deepEqual(stored.map((r) => ({ ...r })), [{ id: first.view, first: 1 }], 'counted once');
  });

  test('without JavaScript, Allow goes back to the same page view with the cookie set', async () => {
    const first = await page('consent');
    const allow = await post('consent', '/api/consent', { choice: 'allow', variant: first.variant, view: first.view }, { form: true });
    assert.equal(allow.headers.get('location'), `/?view=${first.view}`);
    assert.equal(cookieValue(allow, 'dtk_variant'), first.variant);
    const back = await page('consent', `/?view=${first.view}`, { cookie: `dtk_variant=${first.variant}` });
    assert.equal(back.view, first.view);
    assert.match(back.html, /Remove the cookie/);
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM views'))[0].n, 1);
  });

  test('a ?view= that is unknown, malformed or does not match the cookie is ignored', async () => {
    const first = await page('consent');
    const other = first.variant === 'a' ? 'b' : 'a';
    for (const [path, headers] of [
      [`/?view=${'0'.repeat(32)}`, {}],
      ['/?view=not-a-view', {}],
      [`/?view=${first.view}`, { cookie: `dtk_variant=${other}` }],
    ]) {
      const again = await page('consent', path, headers);
      assert.notEqual(again.view, first.view, path);
      assert.match(again.view, /^[a-f0-9]{32}$/, path);
    }
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM views'))[0].n, 4);
  });

  test('No thanks stores nothing, and bad input is refused', async () => {
    const decline = await post('consent', '/api/consent', { choice: 'decline', variant: 'b' });
    assert.equal(decline.status, 204);
    assert.equal(setCookies(decline).length, 0);
    for (const body of [{ choice: 'allow', variant: 'zz' }, { choice: 'maybe' }, {}]) {
      const response = await post('consent', '/api/consent', body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(setCookies(response).length, 0);
    }
    const cross = await post('consent', '/api/consent', { choice: 'allow', variant: 'b' }, { headers: { origin: 'https://evil.example' } });
    assert.equal(cross.status, 403);
  });

  test('after Allow the price stays, the question is gone and the cookie can be removed', async () => {
    const { response, html, variant } = await page('consent', '/', { cookie: 'dtk_variant=c' });
    assert.equal(variant, 'c');
    assert.equal(setCookies(response).length, 0, 'the cookie is not renewed');
    assert.doesNotMatch(html, /class="consent"/);
    assert.match(html, /<a href="\/api\/optout">Remove the cookie<\/a>/);
    assert.equal((await rows(h, 'SELECT first FROM views'))[0].first, 0);

    const removed = await h.server.fetch('/api/optout', { redirect: 'manual', headers: as('consent', { cookie: 'dtk_variant=c', 'user-agent': BROWSER }) });
    assert.equal(removed.status, 303);
    const cookies = setCookies(removed);
    assert.equal(cookies.length, 1);
    assert.match(cookies[0], /^dtk_variant=; .*Max-Age=0/);
  });

  test('without the cookie, each visit is assigned and counted on its own', async () => {
    for (let i = 0; i < 4; i++) await page('consent');
    assert.equal((await rows(h, 'SELECT SUM(first) AS n FROM views'))[0].n, 4);
  });

  test('the privacy notice says the cookie is only set after Allow', async () => {
    const { html } = await page('consent', '/privacy');
    assert.match(html, /Only after you choose Allow/);
    assert.match(html, /This site asks before it sets a cookie/);
    assert.doesNotMatch(html, /dtk_optout/);
  });

  test('a bot is not asked and not counted', async () => {
    const response = await h.server.fetch('/', { headers: as('consent', { 'user-agent': 'Twitterbot/1.0' }) });
    const html = await response.text();
    assert.doesNotMatch(html, /class="consent"/);
    assert.equal((await rows(h, 'SELECT COUNT(*) AS n FROM views'))[0].n, 0);
  });
});

describe('none mode', () => {
  test('never sets a cookie and ignores one the browser sends', async () => {
    for (let i = 0; i < 5; i++) {
      const { response, html } = await page('none', '/', { cookie: 'dtk_variant=a; dtk_optout=1' });
      assert.equal(setCookies(response).length, 0);
      assert.match(html, /This site sets no cookies/);
      assert.doesNotMatch(html, /class="consent"/);
      assert.doesNotMatch(html, /api\/optout/);
    }
    const stored = await rows(h, 'SELECT SUM(first) AS n FROM views');
    assert.equal(stored[0].n, 5, 'every visit counts as new, and an opt-out cookie means nothing here');
  });

  test('the opt-out and consent endpoints set nothing', async () => {
    const optout = await h.server.fetch('/api/optout', { redirect: 'manual', headers: as('none', { cookie: 'dtk_variant=a', 'user-agent': BROWSER }) });
    assert.equal(optout.status, 303);
    assert.equal(setCookies(optout).length, 0);
    const consent = await post('none', '/api/consent', { choice: 'allow', variant: 'a' });
    assert.equal(consent.status, 404);
    assert.equal(setCookies(consent).length, 0);
  });

  test('the privacy notice says no cookies are set and has no cookie table', async () => {
    const { html } = await page('none', '/privacy');
    assert.match(html, /This site sets no cookies and stores nothing on your device/);
    assert.doesNotMatch(html, /<table>/);
  });

  test('sign-ups still carry the price of their view', async () => {
    const { view, variant } = await page('none', '/?src=forum');
    const response = await post('none', '/api/signup', { email: 'a@example.org', consent: true, view });
    assert.equal(response.status, 200);
    const [row] = await rows(h, 'SELECT variant, src FROM signups');
    assert.deepEqual({ ...row }, { variant, src: 'forum' });
  });
});

describe('escaping', () => {
  test('every config text is escaped on the landing page', async () => {
    const { html } = await page('hostile', '/', { cookie: '' });
    for (const raw of ['<script>alert(1)</script>', '<img src=x onerror', '<iframe', '<style>body', '<svg onload', '<u>question</u>', '<h1>Where</h1>', '<b>bold</b>']) {
      assert.ok(!html.includes(raw), `raw markup leaked: ${raw}`);
    }
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('&quot;&gt;&lt;img src=x onerror=alert(2)&gt;'));
    assert.ok(html.includes('Fish &amp; chips &#39;quoted&#39;'));
    assert.ok(html.includes('alt="&quot; onload=&quot;alert(3)"'));
    assert.ok(html.includes('&#39; onmouseover=&#39;alert(4)'));
    assert.ok(html.includes('&lt;i&gt;Evil &amp; Co&lt;/i&gt;'));
    // A placeholder typed into a config value is shown as text, never filled in.
    assert.ok(html.includes('{{name}} &lt;a href=x&gt;agree&lt;/a&gt;'));
    const tags = html.match(/<[a-z][^>]*>/gi);
    // Quoted attribute values are text: a value cannot break out because " is escaped.
    for (const tag of tags) assert.doesNotMatch(tag.replace(/"[^"]*"/g, '""'), /\son[a-z]+\s*=/i, `event handler in a real tag: ${tag}`);
    assert.equal((html.match(/<script/g) || []).length, 1, 'only the app.js script tag');
  });

  test('every config text is escaped on the privacy notice', async () => {
    const { html } = await page('hostile', '/privacy');
    assert.ok(!html.includes('<i>Evil'));
    assert.ok(!html.includes('<a href="javascript:'));
    assert.ok(html.includes('&lt;a href=&quot;javascript:alert(6)&quot;&gt;x&lt;/a&gt;'));
    assert.ok(html.includes('&lt;h1&gt;Where&lt;/h1&gt;'));
    assert.equal((html.match(/<script/g) || []).length, 0);
  });
});

describe('a config without the optional parts', () => {
  test('renders without name, question, hero, steps, features, FAQ or trial', async () => {
    const { html, variant } = await page('minimal');
    assert.ok(!html.includes('{{'));
    assert.doesNotMatch(html, /id="f-name"/);
    assert.doesNotMatch(html, /name="answer"/);
    assert.doesNotMatch(html, /class="hero-art"/);
    assert.doesNotMatch(html, /How it works/);
    assert.doesNotMatch(html, /class="features"/);
    assert.doesNotMatch(html, /Questions/);
    assert.doesNotMatch(html, /free trial/);
    // The page text is English, so the language stays "en" whatever locale formats the price.
    assert.match(html, /<html lang="en">/);
    assert.match(html, /per year/);
    // German formatting puts a no-break space (U+00A0) before the euro sign.
    const nbsp = String.fromCharCode(0xa0);
    const expected = variant === 'low' ? `49,50${nbsp}EUR` : `99${nbsp}EUR`;
    assert.ok(html.includes(`<span class="amount">${expected.replace('EUR', String.fromCharCode(0x20ac))}</span>`), `price for ${variant}`);
    if (variant === 'low') assert.match(html, /<p class="plan-name">Early<\/p>/);
  });

  test('accepts a sign-up with just an email address and consent', async () => {
    const { view } = await page('minimal');
    const response = await post('minimal', '/api/signup', { email: 'solo@example.org', consent: true, view, name: 'ignored', answer: 'ignored' });
    assert.equal(response.status, 200);
    const [row] = await rows(h, 'SELECT name, answer FROM signups');
    assert.deepEqual({ ...row }, { name: null, answer: null }, 'fields the config does not ask for are not stored');
  });
});
