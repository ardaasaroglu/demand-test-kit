// Small input helpers shared by the Worker and the scripts. Pure functions, unit tested.

/**
 * Lowercases and trims an email address and checks that it is plausible.
 * Returns the normalized address, or null. It does not try to prove the address exists.
 */
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.normalize('NFC').trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+$/.test(email)) return null;
  const [local, domain] = email.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const labels = domain.split('.');
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return null;
    if (!/^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(label)) return null;
  }
  const tld = labels.at(-1);
  if (tld.length < 2 || /^\d+$/.test(tld)) return null;
  return email;
}

/** Collapses whitespace and strips control characters. Returns '' for anything that is not text. */
export function cleanText(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The link tag of a visit, from ?src= (or ?utm_source= as a fallback).
 * Missing gives "direct". Anything that is not a short plain tag gives "other".
 */
export function cleanSrc(raw) {
  if (raw === null || raw === undefined || raw === '') return 'direct';
  const tag = String(raw).trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{0,31}$/.test(tag) ? tag : 'other';
}

// Link previews, crawlers, uptime checks and scripts fetch the page too. They are not visitors.
// "bot" covers most of them: Googlebot, LinkedInBot, TelegramBot, Pinterestbot, Slackbot,
// Discordbot and many more. The other words catch fetchers without "bot" in their name.
// App names on their own are left out on purpose. The in-app browsers of LinkedIn, Pinterest,
// Telegram, Facebook and Instagram put the app name in the user agent, and those are people.
// (?<!cu) keeps Cubot phones, whose model names contain "bot", counted as people too.
// WhatsApp's link preview is matched only at the start, where its fetcher puts the name.
// An empty user agent is treated as a bot as well.
const BOT_UA =
  /(?<!cu)bot|crawl|spider|slurp|preview|scrape|fetcher|facebookexternalhit|meta-external|^whatsapp\/|embedly|iframely|vkshare|mastodon|http.rb|cardyb|misskey|pleroma|akkoma|friendica|google-inspectiontool|lighthouse|pagespeed|gtmetrix|headless|phantomjs|puppeteer|playwright|selenium|uptime|monitor|pingdom|statuscake|curl|wget|httpie|python|java\/|okhttp|go-http-client|node-fetch|undici|axios|libwww|perl|ruby|php\//i;

export function isBot(userAgent) {
  const ua = String(userAgent ?? '').trim();
  return ua === '' || BOT_UA.test(ua);
}

/** Parses a Cookie header into a plain object. Bad pairs are skipped. */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    const key = i < 0 ? '' : part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // A malformed value is ignored rather than failing the request.
    }
  }
  return out;
}
