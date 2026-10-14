import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cleanSrc, cleanText, isBot, normalizeEmail, parseCookies } from '../src/validate.js';
import { IN_APP_BROWSERS } from './fixtures/user-agents.mjs';

describe('normalizeEmail', () => {
  test('trims and lowercases a valid address', () => {
    assert.equal(normalizeEmail('  Grower@Example.ORG '), 'grower@example.org');
    assert.equal(normalizeEmail('first.last+tag@mail.example.com'), 'first.last+tag@mail.example.com');
    assert.equal(normalizeEmail('o\'neil@shop.example'), "o'neil@shop.example");
  });

  test('accepts international domain names in Unicode', () => {
    const domain = `b${String.fromCharCode(0xfc)}cher.example`;
    assert.equal(normalizeEmail(`anna@${domain}`), `anna@${domain}`);
  });

  test('rejects what cannot be an address', () => {
    const bad = [
      '', 'plain', 'a@b', '@example.org', 'name@', 'two@@example.org', 'a@b@example.org', 'space in@example.org',
      '.dot@example.org', 'dot.@example.org', 'dot..dot@example.org', 'name@-example.org', 'name@example-.org',
      'name@example..org', 'name@example.c', 'name@example.123', '<script>@example.org', 'a"b@example.org',
      `${'x'.repeat(65)}@example.org`, `x@${'d'.repeat(250)}.org`, null, undefined, 42, {}, ['a@example.org'],
    ];
    for (const value of bad) assert.equal(normalizeEmail(value), null, JSON.stringify(value));
  });
});

describe('cleanText', () => {
  test('collapses whitespace and removes control and invisible characters', () => {
    const nul = String.fromCharCode(0);
    const zwsp = String.fromCharCode(0x200b);
    const rtl = String.fromCharCode(0x202e);
    assert.equal(cleanText(`  Ro${nul}bin \n\t Ash${zwsp}${rtl} `), 'Ro bin Ash');
    assert.equal(cleanText(42), '');
    assert.equal(cleanText(null), '');
  });
});

describe('cleanSrc', () => {
  test('keeps short plain tags, lowercased', () => {
    assert.equal(cleanSrc('Newsletter'), 'newsletter');
    assert.equal(cleanSrc('forum_2026-10'), 'forum_2026-10');
    assert.equal(cleanSrc('reddit.com'), 'reddit.com');
  });

  test('missing is direct, anything odd is other', () => {
    assert.equal(cleanSrc(null), 'direct');
    assert.equal(cleanSrc(''), 'direct');
    assert.equal(cleanSrc(undefined), 'direct');
    for (const odd of ['<b>', 'two words', '-leading', 'x'.repeat(33), 'a/b', 'name@example.org']) {
      assert.equal(cleanSrc(odd), 'other', odd);
    }
  });
});

describe('isBot', () => {
  test('recognises crawlers, link previews, monitors and scripts', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Twitterbot/1.0',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
      'WhatsApp/2.23.20.0',
      'TelegramBot (like TwitterBot)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Slack-ImgProxy (+https://api.slack.com/robots)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'Pinterest/0.2 (+https://www.pinterest.com/bot.html)',
      'Mozilla/5.0 (compatible; Pinterestbot/1.0; +http://www.pinterest.com/bot.html)',
      'Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5',
      'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
      'Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)',
      'Mozilla/5.0 (compatible; vkShare; +http://vk.com/dev/Share)',
      "http.rb/5.1.1 (Mastodon/4.2.10; +https://mastodon.example/)",
      "Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@example.org)",
      "Iframely/1.3.1 (+https://iframely.com/docs/about)",
      "Misskey/2023.12.0 (https://misskey.example)",
      "Pleroma 2.5.0; https://pleroma.example <admin@example.org>",
      "Akkoma 3.10.0; https://akkoma.example",
      "Friendica 'Yellow Archangel' 2023.05; https://friendica.example",
      'redditbot/1.0',
      'bitlybot/3.0',
      'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/141.0',
      'UptimeRobot/2.0',
      'curl/8.4.0',
      'Wget/1.21',
      'python-requests/2.32.0',
      'node-fetch/1.0',
      'Go-http-client/2.0',
      '',
      '   ',
      null,
    ]) {
      assert.equal(isBot(ua), true, String(ua));
    }
  });

  test('lets ordinary browsers through', () => {
    for (const ua of [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 13; CUBOT KINGKONG 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
    ]) {
      assert.equal(isBot(ua), false, ua);
    }
  });

  test('lets people in the in-app browsers of social apps through', () => {
    for (const ua of IN_APP_BROWSERS) assert.equal(isBot(ua), false, ua);
  });
});

describe('parseCookies', () => {
  test('reads pairs and skips malformed ones', () => {
    assert.deepEqual(parseCookies('dtk_variant=b; dtk_optout=1; other=a%20b'), { dtk_variant: 'b', dtk_optout: '1', other: 'a b' });
    assert.deepEqual(parseCookies('bad; =x; ok=1; broken=%E0%A4%A'), { ok: '1' });
    assert.deepEqual(parseCookies(null), {});
  });
});
