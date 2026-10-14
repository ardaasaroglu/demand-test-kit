// `npm run demo:build`: writes the static demo in docs/ for GitHub Pages. It renders the example
// page with the same code as the Worker, fixed on one price, with the form in demo mode: it checks
// the input, shows the thank-you state and sends nothing. CI fails if docs/ is out of date.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { describeVariant, escapeHtml, renderLanding, renderPrivacy } from '../src/render.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEMO_URL = 'https://ardaasaroglu.github.io/demand-test-kit/';
const REPO_URL = 'https://github.com/ardaasaroglu/demand-test-kit';

/** Returns the two demo pages as strings, rendered from kit.config.json and the templates. */
export function renderDemo() {
  const config = loadConfig(JSON.parse(readFileSync(join(ROOT, 'kit.config.json'), 'utf8')));
  const templates = {
    landing: readFileSync(join(ROOT, 'src/templates/landing.html'), 'utf8'),
    privacy: readFileSync(join(ROOT, 'src/templates/privacy.html'), 'utf8'),
  };
  const variant = config.pricing.variants[1] ?? config.pricing.variants[0];
  const demoBar = `<div class="demo-bar" role="region" aria-label="Demo notice"><strong>Demo: nothing is sent.</strong> A static copy of the example page, fixed on price ${escapeHtml(variant.id)} (${escapeHtml(describeVariant(config.pricing, variant))}). <a href="${REPO_URL}">Get the kit on GitHub</a><span class="demo-note" id="demo-note" role="status"></span></div>`;
  const landing = renderLanding(config, templates.landing, {
    variantId: variant.id,
    viewId: '',
    src: 'direct',
    base: '',
    homeHref: 'index.html',
    privacyHref: 'privacy.html',
    signupAction: '#',
    optOutHref: '#',
    consentAction: '#',
    shareUrl: `${DEMO_URL}?src=share`,
    pageUrl: DEMO_URL,
    ogImageUrl: `${DEMO_URL}assets/og.png`,
    demo: true,
    demoBar,
    optedOut: false,
    consented: false,
    showBanner: false,
  });
  const privacy = renderPrivacy(config, templates.privacy, { base: '', homeHref: 'index.html', demoBar });
  return { 'index.html': landing, 'privacy.html': privacy };
}

function main() {
  const docs = join(ROOT, 'docs');
  mkdirSync(join(docs, 'assets'), { recursive: true });
  for (const [name, html] of Object.entries(renderDemo())) writeFileSync(join(docs, name), html);
  writeFileSync(join(docs, '.nojekyll'), '');
  const assets = join(ROOT, 'public/assets');
  for (const file of readdirSync(assets)) copyFileSync(join(assets, file), join(docs, 'assets', file));
  copyFileSync(join(ROOT, 'public/favicon.ico'), join(docs, 'favicon.ico'));
  console.log('Wrote docs/index.html, docs/privacy.html and docs/assets/.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
