// Test-only Worker entry: the real app built from variations of kit.config.json.

import raw from '../../../kit.config.json';
import landing from '../../../src/templates/landing.html';
import privacy from '../../../src/templates/privacy.html';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config.js';

function make(change) {
  const config = structuredClone(raw);
  change(config);
  return createApp(loadConfig(config), { landing, privacy });
}

const apps = {
  consent: make((c) => {
    c.privacy.stickiness = 'consent';
  }),
  none: make((c) => {
    c.privacy.stickiness = 'none';
  }),
  // Every text a maker can type, filled with markup that must come out escaped.
  hostile: make((c) => {
    c.product.name = '<script>alert(1)</script>';
    c.product.tagline = '"><img src=x onerror=alert(2)>';
    c.product.description = "Fish & chips 'quoted' <b>bold</b>";
    c.product.heroImage.alt = '" onload="alert(3)';
    c.product.steps[0].title = '<iframe src=//evil.example>';
    c.product.features[0] = '<style>body{display:none}</style>';
    c.product.faq[0] = { q: '<u>question</u>', a: "' onmouseover='alert(4)" };
    c.pricing.variants[0].label = '<svg onload=alert(5)>';
    c.privacy.controllerName = '<i>Evil & Co</i>';
    c.privacy.jurisdictionNote = '<a href="javascript:alert(6)">x</a>';
    c.form.consentText = '{{name}} <a href=x>agree</a>';
    c.form.question.label = '<h1>Where</h1>';
    c.form.question.options[0].label = '"><script>alert(7)</script>';
  }),
  // A maker without the optional parts: no name field, no question, no hero image, no lists.
  minimal: make((c) => {
    c.product.heroImage = null;
    c.product.steps = [];
    c.product.features = [];
    c.product.faq = [];
    c.form.askName = false;
    c.form.question = null;
    c.pricing.trialDays = 0;
    c.pricing.currency = 'EUR';
    c.pricing.locale = 'de-DE';
    c.pricing.billingPeriod = 'year';
    c.pricing.variants = [
      { id: 'low', price: 49.5, label: 'Early' },
      { id: 'high', price: 99 },
    ];
  }),
};

export default {
  fetch(request, env, ctx) {
    const app = apps[request.headers.get('x-test-config') ?? 'consent'];
    if (!app) return new Response('unknown test config', { status: 400 });
    return app.fetch(request, env, ctx);
  },
};
