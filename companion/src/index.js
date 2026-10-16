#!/usr/bin/env node
// OnTask companion: links the phone app and the Chrome extension over your
// Wi-Fi, watches the screen with a local vision model while a session runs,
// and serves the phone app to Expo Go.
//
// Normally Chrome starts it for you (after `npm run setup` once). You can
// also run it yourself:
//
//   npm start                      run with defaults
//   npm start -- --no-screen       link devices only, no screen watching
//   npm start -- --no-app          don't serve the phone app
//   npm start -- --new-code        make a new pairing code (paired phones stay paired)
//   npm start -- --interval 30 --dwell 180 --model gemma3:4b

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG_DIR, computerInfo, loadConfig } from './config.js';
import { createHub } from './hub.js';
import { readScreenText, screenshot } from './mac.js';
import { startNative } from './native.js';
import { APP_PORT, ensureOllama, startAppServer } from './services.js';
import { DEFAULT_MODEL, inferTask } from './vision.js';
import { createWatcher } from './watcher.js';

const { values: args } = parseArgs({
  options: {
    native: { type: 'boolean', default: false },
    port: { type: 'string', default: '4517' },
    interval: { type: 'string', default: '20' },
    dwell: { type: 'string', default: '120' },
    model: { type: 'string', default: DEFAULT_MODEL },
    'no-screen': { type: 'boolean', default: false },
    'no-app': { type: 'boolean', default: false },
    'app-port': { type: 'string', default: String(APP_PORT) },
    'new-code': { type: 'boolean', default: false },
  },
  strict: false, // Chrome passes the extension's origin as an extra argument
});

// When Chrome runs us, stdout carries native messages, so logs go to a file.
mkdirSync(CONFIG_DIR, { recursive: true });
const LOG_FILE = join(CONFIG_DIR, 'companion.log');
const time = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const log = args.native
  ? (msg) => appendFileSync(LOG_FILE, `${new Date().toISOString()}  ${msg}\n`)
  : (msg) => console.log(`${time()}  ${msg}`);
const say = args.native ? log : (msg) => console.log(msg);

const port = Number(args.port);
const config = await loadConfig({ freshCode: args['new-code'] });
const computer = await computerInfo();
const ip = computer.addresses[0] ?? null;

// Everything a phone needs to pair, in one link. Scanning it opens OnTask in
// Expo Go and fills in the pairing screen.
const pairParams = new URLSearchParams({ h: computer.host, i: ip ?? '', p: String(port), c: config.code, n: computer.name });
const appUrl = ip ? `exp://${ip}:${args['app-port']}` : null;
const pairUrl = appUrl ? `${appUrl}/--/pair?${pairParams}` : `ontask://pair?${pairParams}`;
const readyMessage = { type: 'ready', port, token: config.extensionToken, code: config.code, computer, appUrl, pairUrl };

let native = null;
let appServer = null;
let hub = null;

async function shutdown() {
  appServer?.stop();
  await hub?.close();
  process.exit(0);
}

if (args.native) {
  native = startNative({ onClose: shutdown });
  log('started by Chrome');
}

hub = createHub({ port, auth: config, computer, log });
try {
  await hub.ready;
} catch (err) {
  if (err.code === 'EADDRINUSE' && native) {
    // Already running (e.g. from a terminal). Hand Chrome the key so it can
    // connect to that one, and stay out of the way until Chrome disconnects.
    hub = null;
    native.send({ ...readyMessage, alreadyRunning: true });
    log('another companion is already running; handing over to it');
    await new Promise(() => {});
  }
  say(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Is the companion already running?` : err.message);
  process.exit(1);
}

native?.send(readyMessage);

say(`
OnTask companion is running on ${computer.name}.

  Pair a phone   Chrome toolbar → OnTask → Settings → Pair a phone (shows a QR code)
                 or in the app: ${computer.host} (or ${ip ?? 'no Wi-Fi address'}), code ${config.code}
  Paired phones  ${config.phones().map((p) => p.name).join(', ') || 'none yet'}
`);

if (!args['no-app']) appServer = await startAppServer({ logFile: args.native ? LOG_FILE : null, log, port: Number(args['app-port']) });

const status = await ensureOllama(args.model, log);
let watcher = null;
if (status === 'no-ollama') {
  hub.setWatcher('no-model', 'Ollama is not running');
  say('Screen watching and task guessing are off: Ollama is not running. Install it from https://ollama.com.');
} else if (status === 'no-model') {
  hub.setWatcher('no-model', `Run: ollama pull ${args.model}`);
  say(`Screen watching and task guessing are off: the ${args.model} model isn't downloaded. Run:  ollama pull ${args.model}`);
} else if (args['no-screen']) {
  hub.setWatcher('off', 'Started with --no-screen');
  say(`Screen watching is off (--no-screen). Task guesses use ${args.model} on page titles only.`);
} else {
  say(`Screen watching: ${args.model}, checking every ${args.interval}s and on every tab change while a session runs.`);
  say('Screenshots are judged on this Mac and deleted straight away.\n');
  watcher = createWatcher({ hub, model: args.model, intervalSec: Number(args.interval), dwellSec: Number(args.dwell), log });
  watcher.start();
}

// The extension switched tabs: look at the screen right away.
hub.onRequest('check-now', () => watcher?.checkNow());

// What's on screen, as text, for the extension's reading check on pages it
// can't read itself (PDFs, for example). Stays on this Mac.
hub.onRequest('read-screen', async (_device, msg, reply) => {
  const lines = await readScreenText().catch((err) => {
    log(`couldn't read the screen: ${err.message}`);
    return null;
  });
  reply({ type: 'read-screen-result', reqId: msg.reqId, lines });
});

// The extension's 20-second guess at the task, made with the local model
// from recent page titles plus, when allowed, what's on screen right now.
hub.onRequest('infer', async (_device, msg, reply) => {
  const answer = (task) => reply({ type: 'infer-result', reqId: msg.reqId, task });
  if (status !== 'ready') return answer(null);
  const image = watcher ? await screenshot().catch(() => null) : null;
  const pages = Array.isArray(msg.pages) ? msg.pages.slice(0, 50) : [];
  const task = await inferTask({ model: args.model, pages, image }).catch((err) => {
    log(`guess failed: ${err.message}`);
    return null;
  });
  if (task) log(`guessed task: “${task}”`);
  answer(task);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
