// Shared helpers for the integration tests. Not a test file itself.

import { createTestHarness } from 'wrangler';

export const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

/**
 * Starts one harness for a test file and wires the node:test lifecycle hooks. Between tests the
 * tables are emptied instead of calling server.reset(), which restarts the runtime and costs
 * about a second per test. Requests get a fresh test IP address each (see postJson), so the
 * in-memory speed bump never carries over from one test to the next.
 */
export function useHarness(configUrl, { before, beforeEach, after }) {
  const server = createTestHarness({ workers: [{ configPath: configUrl }] });
  const state = { server, worker: null };
  before(async () => {
    await server.listen();
    state.worker = server.getWorker();
    await state.worker.applyD1Migrations('DB');
  });
  beforeEach(async () => {
    const DB = await db(state);
    await DB.batch(['events', 'views', 'signups'].map((t) => DB.prepare(`DELETE FROM ${t}`)));
  });
  after(async () => {
    await server.close();
  });
  return state;
}

export async function db(state) {
  return (await state.worker.getEnv()).DB;
}

export async function rows(state, sql, ...params) {
  const result = await (await db(state)).prepare(sql).bind(...params).all();
  return result.results;
}

export function setCookies(response) {
  return response.headers.getSetCookie();
}

export function cookieValue(response, name) {
  const line = setCookies(response).find((c) => c.startsWith(`${name}=`));
  return line === undefined ? undefined : line.slice(name.length + 1).split(';')[0];
}

export const viewIdOf = (html) => html.match(/data-view="([^"]*)"/)?.[1];
export const variantOf = (html) => html.match(/data-variant="([^"]*)"/)?.[1];

let ipCounter = 0;
/** A different documentation-range IP address for every call (RFC 5737). */
export const nextIp = () => `192.0.2.${(ipCounter++ % 250) + 1}`;

export function postJson(server, path, body, headers = {}) {
  return server.fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': BROWSER, 'cf-connecting-ip': nextIp(), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Loads the page as a browser and returns { response, html, view, variant }. */
export async function visit(server, path = '/', headers = {}) {
  const response = await server.fetch(path, { headers: { 'user-agent': BROWSER, ...headers } });
  const html = await response.text();
  return { response, html, view: viewIdOf(html), variant: variantOf(html) };
}
