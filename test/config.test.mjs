import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { ConfigError, loadConfig, validateConfig } from '../src/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const example = () => JSON.parse(readFileSync(join(ROOT, 'kit.config.json'), 'utf8'));

function errorsFor(change) {
  const raw = example();
  change(raw);
  return validateConfig(raw).errors;
}

function assertError(change, pattern) {
  const errors = errorsFor(change);
  assert.ok(errors.some((e) => pattern.test(e)), `expected an error matching ${pattern}, got:\n${errors.join('\n')}`);
}

describe('the example config', () => {
  test('is valid, with one warning about the example contact address', () => {
    const { config, errors, warnings } = validateConfig(example());
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /you@example\.com/);
    assert.ok(Object.isFrozen(config) && Object.isFrozen(config.pricing.variants[0]));
  });

  test('fills defaults for optional fields', () => {
    const raw = example();
    delete raw.pricing.locale;
    delete raw.pricing.billingPeriod;
    delete raw.pricing.trialDays;
    delete raw.privacy.stickiness;
    delete raw.killRule.confidence;
    delete raw.form.askName;
    delete raw.form.question;
    delete raw.product.steps;
    const config = loadConfig(raw);
    assert.equal(config.pricing.locale, 'en-US');
    assert.equal(config.pricing.billingPeriod, 'month');
    assert.equal(config.pricing.trialDays, 0);
    assert.equal(config.privacy.stickiness, 'cookie');
    assert.equal(config.killRule.confidence, 0.95);
    assert.equal(config.form.askName, false);
    assert.equal(config.form.question, null);
    assert.deepEqual(config.product.steps, []);
  });

  test('trims text values', () => {
    const raw = example();
    raw.product.name = '  Fernquill  ';
    assert.equal(loadConfig(raw).product.name, 'Fernquill');
  });
});

describe('config validation', () => {
  test('lists every problem at once', () => {
    const raw = example();
    raw.pricing.variants = [{ id: 'a', price: 4 }];
    raw.killRule.goBarRate = 2;
    raw.privacy.stickiness = 'always';
    let thrown;
    try {
      loadConfig(raw);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof ConfigError);
    assert.equal(thrown.errors.length, 3);
    assert.match(thrown.message, /kit\.config\.json has 3 problems:/);
  });

  test('catches typos in key names and suggests the right one', () => {
    assertError((c) => {
      c.killrule = c.killRule;
      delete c.killRule;
    }, /Unknown key "killrule" in the top level\. Did you mean "killRule"\?/);
    assertError((c) => {
      c.pricing.Variants = [];
    }, /Unknown key "Variants" in "pricing"\. Did you mean "variants"\?/);
    assertError((c) => {
      c.pricing.variants[0].cost = 3;
    }, /Unknown key "cost" in "pricing\.variants\[0\]"/);
  });

  test('needs 2 to 4 price variants with unique ids and positive prices', () => {
    assertError((c) => (c.pricing.variants = [{ id: 'a', price: 4 }]), /pricing\.variants must have 2 to 4 entries \(it has 1\)/);
    assertError((c) => c.pricing.variants.push({ id: 'd', price: 20 }, { id: 'e', price: 30 }), /2 to 4 entries \(it has 5\)/);
    assertError((c) => (c.pricing.variants[1].id = 'a'), /"a" is used twice/);
    assertError((c) => (c.pricing.variants[1].id = 'B'), /pricing\.variants\[1\]\.id must be 1 to 12 lowercase letters or digits/);
    assertError((c) => (c.pricing.variants[2].price = 0), /pricing\.variants\[2\]\.price must be a number above 0/);
    assertError((c) => (c.pricing.variants[2].price = '12'), /got "12"/);
  });

  test('warns when two prices are the same', () => {
    const raw = example();
    raw.pricing.variants[1].price = 4;
    assert.ok(validateConfig(raw).warnings.some((w) => /same price/.test(w)));
  });

  test('checks the currency, locale and billing period', () => {
    assertError((c) => (c.pricing.currency = 'usd'), /three-letter currency code/);
    assertError((c) => (c.pricing.currency = 'DOLLARS'), /three-letter currency code/);
    assertError((c) => (c.pricing.locale = 'not a locale!'), /pricing\.locale must be a locale/);
    assertError((c) => (c.pricing.billingPeriod = 'monthly'), /pricing\.billingPeriod must be one of "month", "year", "week", "once"/);
    assertError((c) => (c.pricing.trialDays = -1), /pricing\.trialDays must be a whole number from 0 to 365/);
  });

  test('checks the kill rule', () => {
    assertError((c) => (c.killRule.killFloorRate = 0.05), /killFloorRate \(0\.05\) must be below killRule\.goBarRate \(0\.04\)/);
    assertError((c) => (c.killRule.goBarRate = 4), /goBarRate must be a fraction between 0 and 1, for example 0\.03 for 3%/);
    assertError((c) => (c.killRule.minVisitorsPerVariant = 5), /minVisitorsPerVariant must be a whole number from 10/);
    assertError((c) => (c.killRule.minVisitorsPerVariant = 99.5), /minVisitorsPerVariant must be a whole number/);
    assertError((c) => (c.killRule.goMinSignups = 0), /goMinSignups must be a whole number from 1/);
    assertError((c) => (c.killRule.confidence = 0.5), /confidence must be a number from 0\.8 to 0\.999/);
  });

  test('warns about a small minimum sample and a short test', () => {
    const raw = example();
    raw.killRule.minVisitorsPerVariant = 50;
    raw.test.maxDays = 5;
    const { warnings } = validateConfig(raw);
    assert.ok(warnings.some((w) => /under 100/.test(w)));
    assert.ok(warnings.some((w) => /under 7/.test(w)));
  });

  test('checks the test dates', () => {
    assertError((c) => (c.test.startDate = '2026-02-30'), /test\.startDate must be a date like "2026-11-02", or null/);
    assertError((c) => (c.test.startDate = '14/10/2026'), /test\.startDate/);
    assertError((c) => (c.test.maxDays = 0), /test\.maxDays must be a whole number from 1 to 365/);
    assert.deepEqual(errorsFor((c) => (c.test.startDate = '2026-11-02')), []);
  });

  test('checks the privacy settings', () => {
    assertError((c) => (c.privacy.contactEmail = 'nobody'), /privacy\.contactEmail must be an email address/);
    assertError((c) => (c.privacy.controllerName = ''), /privacy\.controllerName must not be empty/);
    assertError((c) => (c.privacy.retentionDays = 0), /privacy\.retentionDays must be a whole number from 1 to 3650/);
    assertError((c) => (c.privacy.retentionDays = 10), /retentionDays \(10\) is shorter than test\.maxDays \(21\)/);
    assertError((c) => (c.privacy.lastUpdated = 'yesterday'), /privacy\.lastUpdated must be a date/);
    assertError((c) => (c.privacy.stickiness = 'always'), /privacy\.stickiness must be one of "cookie", "consent", "none"/);
    for (const mode of ['cookie', 'consent', 'none']) assert.deepEqual(errorsFor((c) => (c.privacy.stickiness = mode)), []);
  });

  test('checks the form', () => {
    assertError((c) => (c.form.consentText = '   '), /form\.consentText must not be empty/);
    assertError((c) => (c.form.consentVersion = ''), /form\.consentVersion must be a short label/);
    assertError((c) => (c.form.consentVersion = 1), /form\.consentVersion must be a short label/);
    assertError((c) => (c.form.askName = 'yes'), /form\.askName must be true or false/);
    assertError((c) => (c.form.question.options = [c.form.question.options[0]]), /form\.question\.options must have 2 to 8 entries/);
    assertError((c) => (c.form.question.options[1].id = c.form.question.options[0].id), /is used twice/);
    assertError((c) => (c.form.question.options[1].id = 'Back Garden'), /form\.question\.options\[1\]\.id must be 1 to 32 lowercase/);
    assertError((c) => (c.form.question.required = 'no'), /form\.question\.required must be true or false/);
  });

  test('checks text lengths and the hero image file name', () => {
    assertError((c) => (c.product.name = 'x'.repeat(41)), /product\.name must be at most 40 characters \(it has 41\)/);
    assertError((c) => (c.product.tagline = 42), /product\.tagline must be text \(got 42\)/);
    assertError((c) => delete c.product.description, /product\.description is required/);
    assertError((c) => (c.product.heroImage.file = '../secret.txt'), /product\.heroImage\.file must be a file name in public\/assets/);
    assertError((c) => (c.product.steps = [{}, {}, {}, {}, {}]), /product\.steps must have 0 to 4 entries/);
    assertError((c) => (c.product.faq = [{ q: 'Why?' }]), /product\.faq\[0\]\.a is required/);
  });

  test('rejects a config that is not an object, and missing sections', () => {
    assert.deepEqual(validateConfig([]).errors, ['The config must be a JSON object.']);
    assert.deepEqual(validateConfig(null).errors, ['The config must be a JSON object.']);
    assertError((c) => delete c.pricing, /"pricing" must be an object/);
  });
});

describe('npm run check', () => {
  const run = (file) =>
    spawnSync(process.execPath, [join(ROOT, 'scripts/check-config.mjs'), ...(file ? [file] : [])], { cwd: ROOT, encoding: 'utf8' });

  test('passes on the example config and prints the warning', () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /kit\.config\.json is valid\./);
    assert.match(result.stderr, /warning: privacy\.contactEmail is still the example address/);
  });

  test('fails with a readable list on a broken config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dtk-config-'));
    try {
      const raw = example();
      raw.pricing.variants = [];
      raw.privacy.stickiness = 'sometimes';
      const file = join(dir, 'broken.json');
      writeFileSync(file, JSON.stringify(raw));
      const result = run(file);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /kit\.config\.json has 2 problems:/);
      assert.match(result.stderr, /\* pricing\.variants must have 2 to 4 entries \(it has 0\)\./);
      assert.match(result.stderr, /\* privacy\.stickiness must be one of/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
