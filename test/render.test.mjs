import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { renderDemo } from '../scripts/build-demo.mjs';
import { loadConfig } from '../src/config.js';
import { escapeHtml, fill, formatPrice, renderLanding, renderPrivacy } from '../src/render.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const raw = JSON.parse(read('kit.config.json'));
const templates = { landing: read('src/templates/landing.html'), privacy: read('src/templates/privacy.html') };
const withMode = (stickiness) => loadConfig({ ...raw, privacy: { ...raw.privacy, stickiness } });
const NBSP = String.fromCharCode(0xa0);
const EURO = String.fromCharCode(0x20ac);
const POUND = String.fromCharCode(0xa3);
const livePage = {
  variantId: 'b',
  viewId: 'f'.repeat(32),
  src: 'direct',
  base: '/',
  homeHref: '/',
  privacyHref: '/privacy',
  optOutHref: '/api/optout',
  consentAction: '/api/consent',
  shareUrl: 'https://example.org/?src=share',
  pageUrl: 'https://example.org/',
  ogImageUrl: 'https://example.org/assets/og.png',
  demo: false,
  optedOut: false,
  consented: false,
  showBanner: true,
};

describe('template helpers', () => {
  test('escapeHtml escapes the five HTML characters', () => {
    assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(7), '7');
  });

  test('fill escapes {{key}}, inserts {{{key}}} as is, and refuses a missing value', () => {
    assert.equal(fill('<p>{{a}}</p>{{{b}}}', { a: '<b>', b: '<i>ok</i>' }), '<p>&lt;b&gt;</p><i>ok</i>');
    assert.throws(() => fill('{{missing}}', {}), /Template placeholder "missing" has no value/);
    assert.equal(fill('{{a}}', { a: '{{b}}', b: 'no' }), '{{b}}', 'a value is never filled again');
  });

  test('formatPrice follows the currency and locale', () => {
    const usd = { currency: 'USD', locale: 'en-US' };
    assert.equal(formatPrice(usd, 7), '$7');
    assert.equal(formatPrice(usd, 7.5), '$7.50');
    assert.equal(formatPrice({ currency: 'GBP', locale: 'en-GB' }, 12), `${POUND}12`);
    assert.equal(formatPrice({ currency: 'EUR', locale: 'de-DE' }, 49.5), `49,50${NBSP}${EURO}`);
  });
});

describe('the templates', () => {
  test('have no inline scripts, inline styles or event handler attributes', () => {
    for (const [name, html] of Object.entries(templates)) {
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, name);
      assert.doesNotMatch(html, /<style|\sstyle=|\son[a-z]+=/i, name);
    }
  });

  test('render with every placeholder filled, in every mode and state', () => {
    for (const mode of ['cookie', 'consent', 'none']) {
      const config = withMode(mode);
      for (const state of [{}, { optedOut: true }, { consented: true }, { demo: true, demoBar: '<div></div>' }]) {
        const html = renderLanding(config, templates.landing, { ...livePage, ...state });
        assert.ok(!html.includes('{{'), `${mode} ${JSON.stringify(state)}`);
        assert.ok(!html.includes('undefined'), `${mode} ${JSON.stringify(state)}`);
      }
      const privacy = renderPrivacy(config, templates.privacy, { base: '/', homeHref: '/' });
      assert.ok(!privacy.includes('{{') && !privacy.includes('undefined'), mode);
    }
  });

  test('show the assigned price, the trial and a label when there is one', () => {
    const config = loadConfig({
      ...raw,
      pricing: {
        ...raw.pricing,
        variants: [
          { id: 'a', price: 4 },
          { id: 'b', price: 9.5, label: 'Plot plan' },
        ],
      },
    });
    const html = renderLanding(config, templates.landing, livePage);
    assert.match(html, /<p class="plan-name">Plot plan<\/p>/);
    assert.match(html, /<span class="amount">\$9\.50<\/span> <span class="period">per month<\/span>/);
    assert.match(html, /14-day free trial when it launches/);
    assert.match(html, /data-variant="b"/);
  });

  test('an unknown variant id falls back to the first price', () => {
    const html = renderLanding(withMode('cookie'), templates.landing, { ...livePage, variantId: 'zz' });
    assert.match(html, /data-variant="a"/);
  });

  test('the consent banner appears only in consent mode, for a person who has not chosen', () => {
    const banner = /class="consent"/;
    assert.match(renderLanding(withMode('consent'), templates.landing, livePage), banner);
    assert.doesNotMatch(renderLanding(withMode('consent'), templates.landing, { ...livePage, consented: true }), banner);
    assert.doesNotMatch(renderLanding(withMode('consent'), templates.landing, { ...livePage, showBanner: false }), banner);
    assert.doesNotMatch(renderLanding(withMode('cookie'), templates.landing, livePage), banner);
    assert.doesNotMatch(renderLanding(withMode('none'), templates.landing, livePage), banner);
  });
});

describe('the static demo', () => {
  const demo = renderDemo();

  test('docs/ matches what npm run demo:build writes', () => {
    assert.equal(read('docs/index.html'), demo['index.html'], 'run npm run demo:build');
    assert.equal(read('docs/privacy.html'), demo['privacy.html'], 'run npm run demo:build');
    for (const file of readdirSync(new URL('../public/assets', import.meta.url))) {
      const source = readFileSync(new URL(`../public/assets/${file}`, import.meta.url));
      const copy = readFileSync(new URL(`../docs/assets/${file}`, import.meta.url));
      assert.ok(source.equals(copy), `docs/assets/${file} is out of date: run npm run demo:build`);
    }
  });

  test('says nothing is sent, records nothing and loads only relative files', () => {
    const html = demo['index.html'];
    assert.match(html, /Demo: nothing is sent\./);
    assert.match(html, /data-mode="demo"/);
    assert.match(html, /data-view=""/);
    assert.match(html, /<a href="#" data-demo-note="[^"]+">Opt out of testing<\/a>/);
    assert.doesNotMatch(html, /class="consent"/);
    for (const [, url] of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
      assert.ok(!url.startsWith('/'), `relative path on GitHub Pages: ${url}`);
    }
    assert.match(html, /<meta property="og:image" content="https:\/\/ardaasaroglu\.github\.io\/demand-test-kit\/assets\/og\.png">/);
    assert.match(demo['privacy.html'], /Demo: nothing is sent\./);
  });
});
