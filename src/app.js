// The Worker: serves the page with one of the planned prices, counts views and button presses,
// stores waitlist sign-ups in D1, and deletes old rows once a day.
//
// There is no admin page on purpose. Read the numbers with `npm run results` and the waitlist with
// `npm run export`. Both run on your machine with your own Cloudflare login.

import { renderLanding, renderPrivacy } from './render.js';
import { cleanSrc, cleanText, isBot, normalizeEmail, parseCookies } from './validate.js';

export const VARIANT_COOKIE = 'dtk_variant';
export const OPTOUT_COOKIE = 'dtk_optout';
export const EVENT_TYPES = new Set(['cta_click', 'price_click', 'share_click']);

// The speed bump: at most this many accepted sign-ups per IP address per window, per Worker
// instance. It slows down a script. It is not a wall: Cloudflare runs many instances.
export const SIGNUP_LIMIT = 5;
export const SIGNUP_WINDOW_MS = 10 * 60 * 1000;

const MAX_EVENT_BYTES = 1024;
const MAX_SIGNUP_BYTES = 8 * 1024;
const VIEW_ID_RE = /^[a-f0-9]{32}$/;
const YEAR_SECONDS = 365 * 24 * 60 * 60;

// No inline scripts or styles, nothing from another origin.
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

export const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'accelerometer=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000',
};

function respond(body, status = 200, type = 'text/html; charset=utf-8', extra = {}) {
  const headers = new Headers({ ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...extra });
  if (body !== null) headers.set('Content-Type', type);
  return new Response(body, { status, headers });
}
const json = (obj, status = 200) => respond(JSON.stringify(obj), status, 'application/json; charset=utf-8');
const noContent = () => respond(null, 204);
const redirectHome = () => respond(null, 303, undefined, { Location: '/' });

function cookie(name, value, maxAgeSeconds) {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax; Secure; HttpOnly`;
}

function newViewId() {
  return crypto.randomUUID().replaceAll('-', '');
}

// An unbiased pick: rejection sampling avoids the modulo bias of `random % n`.
function pickIndex(n) {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

async function readBody(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) return { tooLarge: true };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return { tooLarge: true };
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/x-www-form-urlencoded')) {
    return { form: true, data: Object.fromEntries(new URLSearchParams(text)) };
  }
  try {
    const data = JSON.parse(text);
    return { data: data && typeof data === 'object' && !Array.isArray(data) ? data : null };
  } catch {
    return { data: null };
  }
}

// Browsers send Origin on POST. A request from another site's page is refused.
// Requests without Origin (scripts, old browsers) are allowed: the API has nothing secret to protect.
function crossSite(request, url) {
  const origin = request.headers.get('origin');
  return origin !== null && origin !== url.origin;
}

/**
 * The speed bump's memory: hashed IP address -> times of its accepted sign-ups.
 * Entries stay in the order of their last sign-up, so each call first drops every address whose
 * last sign-up is older than the window, and stops at the first one that is not.
 */
export function createSpeedBump(limit = SIGNUP_LIMIT, windowMs = SIGNUP_WINDOW_MS) {
  const recent = new Map();
  return {
    get size() {
      return recent.size;
    },
    /** Records a sign-up for `key` at `now` and returns false, or returns true when over the limit. */
    hit(key, now) {
      for (const [k, times] of recent) {
        if (now - times[times.length - 1] < windowMs) break;
        recent.delete(k);
      }
      const times = (recent.get(key) ?? []).filter((t) => now - t < windowMs);
      if (times.length >= limit) return true;
      times.push(now);
      recent.delete(key);
      recent.set(key, times);
      return false;
    },
  };
}

async function hashIp(ip, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Builds the Worker for a validated config and the two HTML templates.
 * Each call gets its own speed-bump memory, which keeps tests independent.
 */
export function createApp(config, templates) {
  const variants = config.pricing.variants;
  const byId = new Map(variants.map((v) => [v.id, v]));
  const mode = config.privacy.stickiness;
  const variantMaxAge = config.test.maxDays * 24 * 60 * 60;
  const speedBump = createSpeedBump();
  // Random per instance, so hashes cannot be compared across instances. Created on first use:
  // the Workers runtime does not allow random values at startup.
  let salt = null;

  // After a cookie choice made without JavaScript, the banner form reloads the page with
  // ?view=<page view id> (consent mode only). The visitor keeps the price and the page view they
  // already had, instead of getting a new price and counting as a new visitor.
  async function viewToResume(env, url, remembered) {
    const id = url.searchParams.get('view');
    if (mode !== 'consent' || !id || !VIEW_ID_RE.test(id)) return null;
    try {
      const row = await env.DB.prepare('SELECT variant FROM views WHERE id = ?').bind(id).first();
      const variant = row ? byId.get(row.variant) : undefined;
      if (!variant || (remembered && remembered.id !== variant.id)) return null;
      return { id, variant };
    } catch (error) {
      console.error('could not read a view', error);
      return null;
    }
  }

  async function landing(request, env, url) {
    const cookies = parseCookies(request.headers.get('cookie'));
    const bot = isBot(request.headers.get('user-agent'));
    const optedOut = mode === 'cookie' && cookies[OPTOUT_COOKIE] === '1';
    const remembered = mode !== 'none' ? byId.get(cookies[VARIANT_COOKIE]) : undefined;
    const src = cleanSrc(url.searchParams.get('src') ?? url.searchParams.get('utm_source'));
    const headers = {};

    let variant = variants[0];
    let first = 0;
    let counted = false;
    let resumed = null;
    if (!bot && !optedOut) {
      counted = true;
      resumed = request.method === 'GET' ? await viewToResume(env, url, remembered) : null;
      if (resumed) {
        variant = resumed.variant;
      } else if (remembered) {
        variant = remembered;
      } else {
        variant = variants[pickIndex(variants.length)];
        first = 1;
        if (mode === 'cookie' && request.method === 'GET') headers['Set-Cookie'] = cookie(VARIANT_COOKIE, variant.id, variantMaxAge);
      }
    }

    let viewId = resumed ? resumed.id : '';
    if (counted && request.method === 'GET' && !resumed) {
      viewId = newViewId();
      try {
        await env.DB.prepare('INSERT INTO views (id, created_at, variant, src, first) VALUES (?, ?, ?, ?, ?)')
          .bind(viewId, new Date().toISOString(), variant.id, src, first)
          .run();
      } catch (error) {
        console.error('could not record a view', error);
        viewId = '';
      }
    }

    const html = renderLanding(config, templates.landing, {
      variantId: variant.id,
      viewId,
      src,
      base: '/',
      homeHref: '/',
      privacyHref: '/privacy',
      signupAction: '/api/signup',
      optOutHref: '/api/optout',
      consentAction: '/api/consent',
      shareUrl: `${url.origin}/?src=share`,
      pageUrl: `${url.origin}/`,
      ogImageUrl: `${url.origin}/assets/og.png`,
      demo: false,
      optedOut,
      consented: mode === 'consent' && Boolean(remembered),
      showBanner: !bot && !resumed,
    });
    return respond(request.method === 'HEAD' ? null : html, 200, undefined, headers);
  }

  function privacy(request) {
    const html = renderPrivacy(config, templates.privacy, { base: '/', homeHref: '/' });
    return respond(request.method === 'HEAD' ? null : html);
  }

  async function event(request, env, url) {
    if (crossSite(request, url)) return json({ ok: false }, 403);
    const body = await readBody(request, MAX_EVENT_BYTES);
    if (body.tooLarge) return json({ ok: false }, 413);
    const type = body.data?.type;
    const view = body.data?.view;
    if (!EVENT_TYPES.has(type) || typeof view !== 'string' || !VIEW_ID_RE.test(view)) return json({ ok: false }, 400);
    // The variant and link tag come from the stored view, never from the browser. One row per
    // view and event type, so repeated presses count once and an unknown view adds nothing.
    await env.DB.prepare(
      'INSERT OR IGNORE INTO events (view_id, type, created_at, variant, src) SELECT id, ?, ?, variant, src FROM views WHERE id = ?',
    )
      .bind(type, new Date().toISOString(), view)
      .run();
    return noContent();
  }

  async function signup(request, env, url) {
    if (crossSite(request, url)) return json({ ok: false, error: 'This form only works on its own page.' }, 403);
    const body = await readBody(request, MAX_SIGNUP_BYTES);
    if (body.tooLarge) return json({ ok: false, error: 'That is too much text.' }, 413);
    // The page's script sends JSON. A plain form post means the script did not run. The submit
    // button stays disabled without the script, so this is rare. Nothing is stored or echoed.
    if (body.form) {
      return respond('The form needs JavaScript. Go back, turn JavaScript on and reload the page.', 400, 'text/plain; charset=utf-8');
    }
    const data = body.data;
    if (!data) return json({ ok: false, error: 'Send the form as JSON.' }, 400);

    // Honeypot: the field is hidden from people, so only a bot fills it. Pretend it worked.
    if (typeof data.website === 'string' && data.website.trim() !== '') return json({ ok: true });

    const errors = {};
    const email = normalizeEmail(data.email);
    if (!email) errors.email = 'Enter an email address, such as name@example.com.';
    let name = null;
    if (config.form.askName) {
      name = cleanText(data.name) || null;
      if (name && name.length > 80) errors.name = 'Keep your name under 80 characters.';
    }
    let answer = null;
    const question = config.form.question;
    if (question) {
      const given = typeof data.answer === 'string' && data.answer !== '' ? data.answer : null;
      if (given && !question.options.some((o) => o.id === given)) errors.answer = 'Choose one of the options.';
      else if (!given && question.required) errors.answer = 'Choose one of the options.';
      else answer = given;
    }
    if (data.consent !== true) errors.consent = 'Tick the box to agree, so we can email you.';
    if (Object.keys(errors).length) return json({ ok: false, errors }, 422);

    const now = Date.now();
    salt ??= newViewId();
    const ipKey = await hashIp(request.headers.get('cf-connecting-ip') || 'unknown', salt);
    if (speedBump.hit(ipKey, now)) {
      return json({ ok: false, error: 'Too many sign-ups from your network. Try again in a few minutes.' }, 429);
    }

    // The price and link tag come from the stored view when there is one. A visitor who opted out
    // of testing has no view, so the sign-up is kept outside the test.
    let variant = null;
    let src = cleanSrc(typeof data.src === 'string' ? data.src : null);
    let viewId = null;
    if (typeof data.view === 'string' && VIEW_ID_RE.test(data.view)) {
      const view = await env.DB.prepare('SELECT variant, src FROM views WHERE id = ?').bind(data.view).first();
      if (view) {
        variant = view.variant;
        src = view.src;
        viewId = data.view;
      }
    }
    const shown = byId.get(variant) ?? byId.get(data.variant) ?? null;

    // email is the primary key, so a repeat sign-up is ignored. The answer is the same either
    // way: the form never reveals who is already on the list.
    await env.DB.prepare(
      'INSERT OR IGNORE INTO signups (email, created_at, name, answer, variant, price, src, view_id, consent_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(email, new Date(now).toISOString(), name, answer, variant, shown ? shown.price : null, src, viewId, config.form.consentVersion)
      .run();
    return json({ ok: true });
  }

  async function consent(request, url) {
    if (mode !== 'consent') return json({ ok: false }, 404);
    if (crossSite(request, url)) return json({ ok: false }, 403);
    const body = await readBody(request, MAX_EVENT_BYTES);
    if (body.tooLarge) return json({ ok: false }, 413);
    const choice = body.data?.choice;
    if (choice !== 'allow' && choice !== 'decline') return json({ ok: false }, 400);
    const headers = {};
    if (choice === 'allow') {
      const variant = byId.get(body.data?.variant);
      if (!variant) return json({ ok: false }, 400);
      headers['Set-Cookie'] = cookie(VARIANT_COOKIE, variant.id, variantMaxAge);
    }
    // Declining stores nothing. The question comes back on the next visit.
    if (!body.form) return respond(null, 204, undefined, headers);
    // Without JavaScript the banner is a plain form. Go back to the same page view and price.
    const view = body.data?.view;
    const location = typeof view === 'string' && VIEW_ID_RE.test(view) ? `/?view=${view}` : '/';
    return respond(null, 303, undefined, { Location: location, ...headers });
  }

  function optout(request) {
    const cookies = parseCookies(request.headers.get('cookie'));
    const set = [];
    if (mode === 'cookie') set.push(cookie(OPTOUT_COOKIE, '1', YEAR_SECONDS));
    if (mode !== 'none' && cookies[VARIANT_COOKIE] !== undefined) set.push(cookie(VARIANT_COOKIE, '', 0));
    const response = request.method === 'GET' ? redirectHome() : noContent();
    for (const value of set) response.headers.append('Set-Cookie', value);
    return response;
  }

  const routes = {
    '/': { GET: landing, HEAD: landing },
    '/privacy': { GET: privacy, HEAD: privacy },
    '/api/event': { POST: event },
    '/api/signup': { POST: signup },
    '/api/consent': { POST: (request, env, url) => consent(request, url) },
    '/api/optout': { GET: optout, POST: optout },
  };

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const route = routes[url.pathname];
      try {
        if (!route) {
          return url.pathname.startsWith('/api/')
            ? json({ ok: false }, 404)
            : respond('Not found', 404, 'text/plain; charset=utf-8');
        }
        const handler = route[request.method];
        if (!handler) {
          return respond(null, 405, undefined, { Allow: Object.keys(route).join(', ') });
        }
        return await handler(request, env, url);
      } catch (error) {
        console.error('request failed', error);
        return url.pathname.startsWith('/api/')
          ? json({ ok: false, error: 'Something went wrong. Please try again.' }, 500)
          : respond('Something went wrong. Please try again.', 500, 'text/plain; charset=utf-8');
      }
    },

    // Runs once a day (see "triggers" in wrangler.jsonc): deletes rows older than privacy.retentionDays.
    async scheduled(controller, env) {
      const cutoff = new Date(controller.scheduledTime - config.privacy.retentionDays * 86_400_000).toISOString();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM events WHERE created_at < ?').bind(cutoff),
        env.DB.prepare('DELETE FROM views WHERE created_at < ?').bind(cutoff),
        env.DB.prepare('DELETE FROM signups WHERE created_at < ?').bind(cutoff),
      ]);
    },
  };
}
