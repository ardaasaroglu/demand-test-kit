// Turns the HTML templates in src/templates into pages. Pure functions: the Worker and the
// demo build (scripts/build-demo.mjs) both call them, so the live page and the demo match.
//
// Template syntax: {{key}} inserts an HTML-escaped value. {{{key}}} inserts HTML that this file
// built itself, from escaped parts. A placeholder without a value throws, so a page can never
// ship with a raw {{...}} in it.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function fill(template, values) {
  return template.replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (_, raw, escaped) => {
    const key = raw ?? escaped;
    if (!Object.hasOwn(values, key)) throw new Error(`Template placeholder "${key}" has no value.`);
    return raw ? String(values[key]) : escapeHtml(values[key]);
  });
}

export function formatPrice(pricing, amount) {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat(pricing.locale, {
    style: 'currency',
    currency: pricing.currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

const PERIODS = { month: 'per month', year: 'per year', week: 'per week', once: 'one-time payment' };
export const periodText = (period) => PERIODS[period] ?? '';

/** One short line per variant, such as "a: $4 per month". Used by the scripts. */
export function describeVariant(pricing, variant) {
  const label = variant.label ? ` (${variant.label})` : '';
  return `${formatPrice(pricing, variant.price)} ${periodText(pricing.billingPeriod)}${label}`;
}

function stepsSection(steps) {
  if (!steps.length) return '';
  const items = steps
    .map(
      (s, i) => `
        <li class="step">
          <span class="step-number" aria-hidden="true">${i + 1}</span>
          <h3>${escapeHtml(s.title)}</h3>
          <p>${escapeHtml(s.text)}</p>
        </li>`,
    )
    .join('');
  return `
  <section class="section" aria-labelledby="how-title">
    <div class="wrap">
      <h2 id="how-title">How it works</h2>
      <ol class="steps">${items}
      </ol>
    </div>
  </section>`;
}

function featureList(features) {
  if (!features.length) return '';
  const items = features.map((f) => `<li>${escapeHtml(f)}</li>`).join('');
  return `<ul class="features">${items}</ul>`;
}

function faqSection(faq) {
  if (!faq.length) return '';
  const items = faq
    .map(
      (f) => `
        <details class="faq-item">
          <summary>${escapeHtml(f.q)}</summary>
          <p>${escapeHtml(f.a)}</p>
        </details>`,
    )
    .join('');
  return `
  <section class="section" aria-labelledby="faq-title">
    <div class="wrap narrow">
      <h2 id="faq-title">Questions</h2>
      <div class="faq">${items}
      </div>
    </div>
  </section>`;
}

function heroImage(product, base) {
  if (!product.heroImage) return '';
  const { file, alt } = product.heroImage;
  return `<div class="hero-art"><img src="${escapeHtml(`${base}assets/${file}`)}" alt="${escapeHtml(alt)}" width="560" height="440"></div>`;
}

function nameField(form) {
  if (!form.askName) return '';
  return `
          <div class="field">
            <label for="f-name">Name <span class="optional">(optional)</span></label>
            <input id="f-name" name="name" type="text" autocomplete="given-name" maxlength="80" aria-describedby="e-name">
            <p class="error" id="e-name" data-error-for="name"></p>
          </div>`;
}

function questionField(form) {
  const q = form.question;
  if (!q) return '';
  const options = q.options
    .map(
      (o) => `
              <label class="choice"><input type="radio" name="answer" value="${escapeHtml(o.id)}"${q.required ? ' required' : ''}> <span>${escapeHtml(o.label)}</span></label>`,
    )
    .join('');
  const hint = q.required ? '' : ' <span class="optional">(optional)</span>';
  return `
          <fieldset class="field" aria-describedby="e-answer">
            <legend>${escapeHtml(q.label)}${hint}</legend>
            <div class="choices">${options}
            </div>
            <p class="error" id="e-answer" data-error-for="answer"></p>
          </fieldset>`;
}

/**
 * What the visitor is told about the price test, near the price.
 * state: { optedOut, consented, demo }
 */
function testNotice(config, page) {
  const mode = config.privacy.stickiness;
  const optOut = (label) => `<a href="${escapeHtml(page.optOutHref)}"${page.demo ? ' data-demo-note="On a live page this link takes you out of the price test."' : ''}>${label}</a>`;
  let text;
  if (mode === 'cookie' && page.optedOut) {
    text = 'You opted out of price testing. You see the standard price, and your visits are not recorded.';
  } else if (mode === 'cookie') {
    text = `We are testing a few planned prices. One cookie remembers which price you saw, so it stays the same when you come back. It is not shared with anyone. ${optOut('Opt out of testing')}.`;
  } else if (mode === 'consent' && page.consented) {
    text = `We are testing a few planned prices. With your permission, one cookie remembers which price you saw. ${optOut('Remove the cookie')}.`;
  } else if (mode === 'consent') {
    text = 'We are testing a few planned prices, so another visitor may see a different one.';
  } else {
    text = 'We are testing a few planned prices, so another visitor may see a different one. This site sets no cookies.';
  }
  return `<p class="test-notice">${text} <a href="${escapeHtml(page.privacyHref)}#cookies">How the test works</a>.</p>`;
}

function footerLinks(config, page) {
  const mode = config.privacy.stickiness;
  const demo = page.demo ? ' data-demo-note="On a live page this link takes you out of the price test."' : '';
  if (mode === 'cookie' && !page.optedOut) return `<a href="${escapeHtml(page.optOutHref)}"${demo}>Opt out of price testing</a>`;
  if (mode === 'consent' && page.consented) return `<a href="${escapeHtml(page.optOutHref)}"${demo}>Remove the price cookie</a>`;
  return '';
}

function consentBanner(config, page) {
  if (config.privacy.stickiness !== 'consent' || page.consented || page.optedOut || page.demo || !page.showBanner) return '';
  return `
<div class="consent" role="region" aria-label="Cookie choice">
  <form class="consent-inner" method="post" action="${escapeHtml(page.consentAction)}">
    <p>We are testing a few planned prices. May we set one cookie so you see the same price next time? It stores only which price you saw. <a href="${escapeHtml(page.privacyHref)}#cookies">Details</a></p>
    <input type="hidden" name="variant" value="${escapeHtml(page.variantId)}">
    <input type="hidden" name="view" value="${escapeHtml(page.viewId ?? '')}">
    <div class="consent-actions">
      <button class="btn btn-small" type="submit" name="choice" value="allow">Allow</button>
      <button class="btn btn-small btn-ghost" type="submit" name="choice" value="decline">No thanks</button>
    </div>
  </form>
</div>`;
}

/**
 * Renders the landing page.
 * page: {
 *   variantId, viewId, src, base, homeHref, privacyHref, signupAction, optOutHref, consentAction,
 *   shareUrl, pageUrl, ogImageUrl, demo, demoBar, optedOut, consented, showBanner
 * }
 */
export function renderLanding(config, template, page) {
  const { product, pricing, form } = config;
  const variant = pricing.variants.find((v) => v.id === page.variantId) ?? pricing.variants[0];
  const trial = pricing.trialDays > 0 ? `<p class="trial">${pricing.trialDays}-day free trial when it launches</p>` : '';
  const planName = variant.label ? `<p class="plan-name">${escapeHtml(variant.label)}</p>` : '';
  return fill(template, {
    name: product.name,
    tagline: product.tagline,
    description: product.description,
    base: page.base,
    homeHref: page.homeHref,
    privacyHref: page.privacyHref,
    signupAction: page.signupAction,
    pageUrl: page.pageUrl,
    ogImageUrl: page.ogImageUrl,
    shareUrl: page.shareUrl,
    viewId: page.viewId ?? '',
    variantId: variant.id,
    src: page.src ?? 'direct',
    mode: page.demo ? 'demo' : 'live',
    price: formatPrice(pricing, variant.price),
    period: periodText(pricing.billingPeriod),
    controllerName: config.privacy.controllerName,
    consentText: form.consentText,
    demoBar: page.demoBar ?? '',
    heroImage: heroImage(product, page.base),
    stepsSection: stepsSection(product.steps),
    planName,
    trialLine: trial,
    featureList: featureList(product.features),
    testNotice: testNotice(config, page),
    faqSection: faqSection(product.faq),
    nameField: nameField(form),
    questionField: questionField(form),
    footerLinks: footerLinks(config, page),
    consentBanner: consentBanner(config, page),
  });
}

function cookieSection(config) {
  const { stickiness } = config.privacy;
  const days = config.test.maxDays;
  if (stickiness === 'none') {
    return `<p>This site sets no cookies and stores nothing on your device. Each visit is assigned a price on its own, so you may see a different price when you come back.</p>`;
  }
  const variantRow = `
        <tr>
          <th scope="row"><code>dtk_variant</code></th>
          <td>Remembers which planned price you were shown, so it stays the same when you come back. It holds only that letter, no identifier.</td>
          <td>${days} ${days === 1 ? 'day' : 'days'}</td>
          <td>${stickiness === 'consent' ? 'Only after you choose Allow' : 'On your first visit'}</td>
        </tr>`;
  const optOutRow =
    stickiness === 'cookie'
      ? `
        <tr>
          <th scope="row"><code>dtk_optout</code></th>
          <td>Remembers that you opted out of price testing.</td>
          <td>1 year</td>
          <td>Only if you opt out</td>
        </tr>`
      : '';
  const intro =
    stickiness === 'consent'
      ? '<p>This site asks before it sets a cookie. If you choose No thanks, nothing is stored on your device and each visit is assigned a price on its own.</p>'
      : '<p>This site sets one cookie so you see the same price each time you visit. You can opt out of price testing with the link at the bottom of the page. You then see the standard price and your visits are not recorded.</p>';
  return `${intro}
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Cookie</th><th scope="col">Purpose</th><th scope="col">Lasts</th><th scope="col">Set</th></tr></thead>
        <tbody>${variantRow}${optOutRow}
        </tbody>
      </table>
    </div>
    <p>Both are first-party cookies. They are not used to follow you on other sites.</p>`;
}

function joinFields(form) {
  const parts = ['your email address'];
  if (form.askName) parts.push('your name, if you give it');
  if (form.question) parts.push(`your answer to "${escapeHtml(form.question.label)}", if you give one`);
  parts.push('the price you were shown', 'the link tag of your visit', 'the version of the consent text you agreed to', 'the time');
  return parts.map((p) => `<li>${p}</li>`).join('');
}

/** Renders the privacy notice. page: { base, homeHref, demoBar } */
export function renderPrivacy(config, template, page) {
  const { product, privacy } = config;
  return fill(template, {
    name: product.name,
    base: page.base,
    homeHref: page.homeHref,
    demoBar: page.demoBar ?? '',
    controllerName: privacy.controllerName,
    contactEmail: privacy.contactEmail,
    retentionDays: String(privacy.retentionDays),
    jurisdictionNote: privacy.jurisdictionNote,
    lastUpdated: privacy.lastUpdated,
    joinFields: joinFields(config.form),
    cookieSection: cookieSection(config),
  });
}
