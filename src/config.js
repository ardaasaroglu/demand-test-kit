// Reads kit.config.json, reports every problem at once, and returns a normalized copy.
// The Worker calls loadConfig() when it starts, so a broken config fails the deploy instead of the page.
// `npm run check` runs the same validation and also prints warnings.

export const STICKINESS_MODES = ['cookie', 'consent', 'none'];
export const BILLING_PERIODS = ['month', 'year', 'week', 'once'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VARIANT_ID_RE = /^[a-z0-9]{1,12}$/;
const OPTION_ID_RE = /^[a-z0-9_-]{1,32}$/;
const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
const IMAGE_FILE_RE = /^[A-Za-z0-9_.-]+\.(svg|png|jpe?g|webp|avif)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SHAPE = {
  product: ['name', 'tagline', 'description', 'heroImage', 'steps', 'features', 'faq'],
  test: ['startDate', 'maxDays'],
  pricing: ['currency', 'locale', 'billingPeriod', 'trialDays', 'variants'],
  killRule: ['minVisitorsPerVariant', 'killFloorRate', 'goBarRate', 'goMinSignups', 'confidence'],
  privacy: ['controllerName', 'contactEmail', 'retentionDays', 'jurisdictionNote', 'lastUpdated', 'stickiness'],
  form: ['askName', 'question', 'consentText', 'consentVersion'],
};

export class ConfigError extends Error {
  constructor(errors) {
    const count = errors.length === 1 ? '1 problem' : `${errors.length} problems`;
    super(`kit.config.json has ${count}:\n${errors.map((e) => `  * ${e}`).join('\n')}`);
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v));

function isRealDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function suggest(key, allowed) {
  const hit = allowed.find((k) => k.toLowerCase() === key.toLowerCase());
  return hit ? ` Did you mean "${hit}"?` : '';
}

/**
 * Validates a parsed kit.config.json.
 * Returns { config, errors, warnings }. `config` is a normalized copy, and is only safe to use
 * when `errors` is empty.
 */
export function validateConfig(raw) {
  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);

  if (!isObject(raw)) {
    return { config: null, errors: ['The config must be a JSON object.'], warnings };
  }

  // Unknown keys are almost always typos, and a typo silently falls back to a default.
  const checkKeys = (obj, allowed, where) => {
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) err(`Unknown key "${key}" in ${where}.${suggest(key, allowed)}`);
    }
  };
  checkKeys(raw, Object.keys(SHAPE), 'the top level');

  const section = (name) => {
    const value = raw[name];
    if (!isObject(value)) {
      err(`"${name}" must be an object.`);
      return {};
    }
    checkKeys(value, SHAPE[name], `"${name}"`);
    return value;
  };

  const text = (value, path, { min = 1, max, optional = false } = {}) => {
    if (value === undefined || value === null) {
      if (!optional) err(`${path} is required.`);
      return optional ? null : '';
    }
    if (typeof value !== 'string') {
      err(`${path} must be text (got ${show(value)}).`);
      return '';
    }
    const trimmed = value.trim();
    if (trimmed.length < min) err(`${path} must not be empty.`);
    else if (max && trimmed.length > max) err(`${path} must be at most ${max} characters (it has ${trimmed.length}).`);
    return trimmed;
  };

  const int = (value, path, min, max) => {
    if (!Number.isInteger(value) || value < min || value > max) {
      err(`${path} must be a whole number from ${min} to ${max} (got ${show(value)}).`);
      return min;
    }
    return value;
  };

  const rate = (value, path) => {
    if (typeof value !== 'number' || !(value > 0 && value < 1)) {
      err(`${path} must be a fraction between 0 and 1, for example 0.03 for 3% (got ${show(value)}).`);
      return 0;
    }
    return value;
  };

  const list = (value, path, min, max) => {
    if (!Array.isArray(value)) {
      err(`${path} must be a list.`);
      return [];
    }
    if (value.length < min || value.length > max) {
      err(`${path} must have ${min === max ? min : `${min} to ${max}`} entries (it has ${value.length}).`);
    }
    return value;
  };

  // product
  const p = section('product');
  const product = {
    name: text(p.name, 'product.name', { max: 40 }),
    tagline: text(p.tagline, 'product.tagline', { max: 120 }),
    description: text(p.description, 'product.description', { max: 300 }),
    heroImage: null,
    steps: [],
    features: [],
    faq: [],
  };
  if (p.heroImage !== undefined && p.heroImage !== null) {
    if (!isObject(p.heroImage)) err('product.heroImage must be an object with "file" and "alt", or null.');
    else {
      checkKeys(p.heroImage, ['file', 'alt'], '"product.heroImage"');
      const file = text(p.heroImage.file, 'product.heroImage.file', { max: 80 });
      if (file && !IMAGE_FILE_RE.test(file)) {
        err(`product.heroImage.file must be a file name in public/assets, such as "hero.svg" (got ${show(file)}).`);
      }
      product.heroImage = { file, alt: text(p.heroImage.alt, 'product.heroImage.alt', { max: 300 }) };
    }
  }
  if (p.steps !== undefined) {
    product.steps = list(p.steps, 'product.steps', 0, 4).map((s, i) => {
      const at = `product.steps[${i}]`;
      if (!isObject(s)) {
        err(`${at} must be an object with "title" and "text".`);
        return { title: '', text: '' };
      }
      checkKeys(s, ['title', 'text'], `"${at}"`);
      return { title: text(s.title, `${at}.title`, { max: 60 }), text: text(s.text, `${at}.text`, { max: 240 }) };
    });
  }
  if (p.features !== undefined) {
    product.features = list(p.features, 'product.features', 0, 8).map((f, i) => text(f, `product.features[${i}]`, { max: 100 }));
  }
  if (p.faq !== undefined) {
    product.faq = list(p.faq, 'product.faq', 0, 10).map((f, i) => {
      const at = `product.faq[${i}]`;
      if (!isObject(f)) {
        err(`${at} must be an object with "q" and "a".`);
        return { q: '', a: '' };
      }
      checkKeys(f, ['q', 'a'], `"${at}"`);
      return { q: text(f.q, `${at}.q`, { max: 120 }), a: text(f.a, `${at}.a`, { max: 600 }) };
    });
  }

  // test
  const t = section('test');
  const test = { startDate: null, maxDays: int(t.maxDays, 'test.maxDays', 1, 365) };
  if (t.startDate !== undefined && t.startDate !== null) {
    if (!isRealDate(t.startDate)) err(`test.startDate must be a date like "2026-11-02", or null (got ${show(t.startDate)}).`);
    else test.startDate = t.startDate;
  }
  if (Number.isInteger(t.maxDays) && t.maxDays < 7) {
    warnings.push('test.maxDays is under 7. A test shorter than a week misses the weekday and weekend mix.');
  }

  // pricing
  const pr = section('pricing');
  const pricing = {
    currency: 'USD',
    locale: 'en-US',
    billingPeriod: 'month',
    trialDays: 0,
    variants: [],
  };
  if (pr.locale !== undefined) {
    const locale = text(pr.locale, 'pricing.locale', { max: 35 });
    let ok = false;
    try {
      ok = Intl.NumberFormat.supportedLocalesOf([locale]).length > 0;
    } catch {
      ok = false;
    }
    if (locale && !ok) err(`pricing.locale must be a locale such as "en-US" or "de-DE" (got ${show(locale)}).`);
    else pricing.locale = locale;
  }
  {
    const currency = text(pr.currency, 'pricing.currency', { max: 3 });
    let ok = /^[A-Z]{3}$/.test(currency);
    if (ok) {
      try {
        new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(1);
      } catch {
        ok = false;
      }
    }
    if (!ok) err(`pricing.currency must be a three-letter currency code such as "USD" or "EUR" (got ${show(pr.currency)}).`);
    else pricing.currency = currency;
  }
  if (pr.billingPeriod !== undefined) {
    if (!BILLING_PERIODS.includes(pr.billingPeriod)) {
      err(`pricing.billingPeriod must be one of ${BILLING_PERIODS.map((b) => `"${b}"`).join(', ')} (got ${show(pr.billingPeriod)}).`);
    } else pricing.billingPeriod = pr.billingPeriod;
  }
  if (pr.trialDays !== undefined) pricing.trialDays = int(pr.trialDays, 'pricing.trialDays', 0, 365);
  {
    const seen = new Set();
    pricing.variants = list(pr.variants, 'pricing.variants', 2, 4).map((v, i) => {
      const at = `pricing.variants[${i}]`;
      if (!isObject(v)) {
        err(`${at} must be an object with "id" and "price".`);
        return { id: '', price: 0, label: null };
      }
      checkKeys(v, ['id', 'price', 'label'], `"${at}"`);
      if (typeof v.id !== 'string' || !VARIANT_ID_RE.test(v.id)) {
        err(`${at}.id must be 1 to 12 lowercase letters or digits, such as "a" (got ${show(v.id)}).`);
      } else if (seen.has(v.id)) {
        err(`${at}.id "${v.id}" is used twice. Every variant needs its own id.`);
      } else seen.add(v.id);
      if (typeof v.price !== 'number' || !(v.price > 0) || v.price > 1_000_000) {
        err(`${at}.price must be a number above 0, such as 9 or 9.5 (got ${show(v.price)}).`);
      }
      const label = v.label === undefined || v.label === null ? null : text(v.label, `${at}.label`, { max: 40 });
      return { id: String(v.id ?? ''), price: Number(v.price) || 0, label };
    });
    const prices = pricing.variants.map((v) => v.price);
    if (prices.length >= 2 && new Set(prices).size !== prices.length) {
      warnings.push('Two variants have the same price. That splits your traffic without testing anything.');
    }
  }

  // killRule
  const k = section('killRule');
  const killRule = {
    minVisitorsPerVariant: int(k.minVisitorsPerVariant, 'killRule.minVisitorsPerVariant', 10, 10_000_000),
    killFloorRate: rate(k.killFloorRate, 'killRule.killFloorRate'),
    goBarRate: rate(k.goBarRate, 'killRule.goBarRate'),
    goMinSignups: int(k.goMinSignups, 'killRule.goMinSignups', 1, 1_000_000),
    confidence: 0.95,
  };
  if (killRule.killFloorRate && killRule.goBarRate && killRule.killFloorRate >= killRule.goBarRate) {
    err(`killRule.killFloorRate (${killRule.killFloorRate}) must be below killRule.goBarRate (${killRule.goBarRate}).`);
  }
  if (k.confidence !== undefined) {
    if (typeof k.confidence !== 'number' || k.confidence < 0.8 || k.confidence > 0.999) {
      err(`killRule.confidence must be a number from 0.8 to 0.999, such as 0.95 (got ${show(k.confidence)}).`);
    } else killRule.confidence = k.confidence;
  }
  if (Number.isInteger(k.minVisitorsPerVariant) && k.minVisitorsPerVariant < 100) {
    warnings.push('killRule.minVisitorsPerVariant is under 100. With so few visitors only very large differences show up.');
  }

  // privacy
  const pv = section('privacy');
  const privacy = {
    controllerName: text(pv.controllerName, 'privacy.controllerName', { max: 100 }),
    contactEmail: text(pv.contactEmail, 'privacy.contactEmail', { max: 254 }),
    retentionDays: int(pv.retentionDays, 'privacy.retentionDays', 1, 3650),
    jurisdictionNote: text(pv.jurisdictionNote, 'privacy.jurisdictionNote', { min: 0, max: 500, optional: true }) || '',
    lastUpdated: '',
    stickiness: 'cookie',
  };
  if (privacy.contactEmail && !EMAIL_RE.test(privacy.contactEmail)) {
    err(`privacy.contactEmail must be an email address (got ${show(pv.contactEmail)}).`);
  } else if (/@example\.(com|org|net)$/i.test(privacy.contactEmail)) {
    warnings.push(`privacy.contactEmail is still the example address ${privacy.contactEmail}. Put a real address there before you share the page.`);
  }
  if (!isRealDate(pv.lastUpdated)) err(`privacy.lastUpdated must be a date like "2026-11-02" (got ${show(pv.lastUpdated)}).`);
  else privacy.lastUpdated = pv.lastUpdated;
  if (pv.stickiness !== undefined) {
    if (!STICKINESS_MODES.includes(pv.stickiness)) {
      err(`privacy.stickiness must be one of ${STICKINESS_MODES.map((m) => `"${m}"`).join(', ')} (got ${show(pv.stickiness)}).`);
    } else privacy.stickiness = pv.stickiness;
  }
  if (Number.isInteger(pv.retentionDays) && Number.isInteger(t.maxDays) && pv.retentionDays < t.maxDays) {
    err(`privacy.retentionDays (${pv.retentionDays}) is shorter than test.maxDays (${t.maxDays}). Data would be deleted before the test ends.`);
  }

  // form
  const f = section('form');
  const form = {
    askName: false,
    question: null,
    consentText: text(f.consentText, 'form.consentText', { max: 500 }),
    consentVersion: '',
  };
  if (f.askName !== undefined) {
    if (typeof f.askName !== 'boolean') err(`form.askName must be true or false (got ${show(f.askName)}).`);
    else form.askName = f.askName;
  }
  if (typeof f.consentVersion !== 'string' || !VERSION_RE.test(f.consentVersion)) {
    err(`form.consentVersion must be a short label such as "1" or "2026-11". Change it whenever you change form.consentText (got ${show(f.consentVersion)}).`);
  } else form.consentVersion = f.consentVersion;
  if (f.question !== undefined && f.question !== null) {
    const q = f.question;
    if (!isObject(q)) err('form.question must be an object with "label" and "options", or null.');
    else {
      checkKeys(q, ['label', 'required', 'options'], '"form.question"');
      const seen = new Set();
      const question = {
        label: text(q.label, 'form.question.label', { max: 120 }),
        required: false,
        options: list(q.options, 'form.question.options', 2, 8).map((o, i) => {
          const at = `form.question.options[${i}]`;
          if (!isObject(o)) {
            err(`${at} must be an object with "id" and "label".`);
            return { id: '', label: '' };
          }
          checkKeys(o, ['id', 'label'], `"${at}"`);
          if (typeof o.id !== 'string' || !OPTION_ID_RE.test(o.id)) {
            err(`${at}.id must be 1 to 32 lowercase letters, digits, "-" or "_" (got ${show(o.id)}).`);
          } else if (seen.has(o.id)) {
            err(`${at}.id "${o.id}" is used twice.`);
          } else seen.add(o.id);
          return { id: String(o.id ?? ''), label: text(o.label, `${at}.label`, { max: 80 }) };
        }),
      };
      if (q.required !== undefined) {
        if (typeof q.required !== 'boolean') err(`form.question.required must be true or false (got ${show(q.required)}).`);
        else question.required = q.required;
      }
      form.question = question;
    }
  }

  const config = { product, test, pricing, killRule, privacy, form };
  return { config: errors.length ? null : deepFreeze(config), errors, warnings };
}

/** Validates and returns the normalized config, or throws a ConfigError that lists every problem. */
export function loadConfig(raw) {
  const { config, errors } = validateConfig(raw);
  if (errors.length) throw new ConfigError(errors);
  return config;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}
