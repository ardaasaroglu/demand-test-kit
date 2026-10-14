// The Worker entry point. Wrangler bundles the config and the two templates into the Worker.
// loadConfig() throws a readable list of problems if kit.config.json is invalid, so a broken
// config stops `wrangler dev` and `wrangler deploy` instead of serving a broken page.

import rawConfig from '../kit.config.json';
import landing from './templates/landing.html';
import privacy from './templates/privacy.html';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

export default createApp(loadConfig(rawConfig), { landing, privacy });
