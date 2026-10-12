#!/usr/bin/env node
// OnTask companion: links the phone app and the Chrome extension over your
// Wi-Fi, and watches the screen with a local vision model while a session runs.
//
//   npm start                    run with defaults
//   npm start -- --no-screen     link devices only, no screen watching
//   npm start -- --new-code      make a new pairing code
//   npm start -- --interval 30 --dwell 180 --model gemma3:4b

import { randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createHub } from './hub.js';
import { DEFAULT_MODEL, modelStatus } from './vision.js';
import { createWatcher } from './watcher.js';

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '4517' },
    interval: { type: 'string', default: '20' },
    dwell: { type: 'string', default: '120' },
    model: { type: 'string', default: DEFAULT_MODEL },
    'no-screen': { type: 'boolean', default: false },
    'new-code': { type: 'boolean', default: false },
  },
});

const CONFIG_DIR = join(homedir(), '.ontask');
const CONFIG = join(CONFIG_DIR, 'companion.json');
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

async function pairingCode() {
  let config = {};
  try {
    config = JSON.parse(await readFile(CONFIG, 'utf8'));
  } catch {
    // first run
  }
  if (!config.code || args['new-code']) {
    config.code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 });
  }
  return config.code;
}

function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

const time = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const log = (msg) => console.log(`${time()}  ${msg}`);

const code = await pairingCode();
const port = Number(args.port);
const hub = createHub({ port, code, log });
try {
  await hub.ready;
} catch (err) {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Is the companion already running?` : err.message);
  process.exit(1);
}

const ip = lanAddress();
console.log(`
OnTask companion is running.

  Pairing code   ${code}
  Extension      toolbar panel → Settings → Companion app → enter ${code}
  Phone          Settings → Connect to your computer → ${ip ?? '(no Wi-Fi address found)'} and ${code}
`);

if (args['no-screen']) {
  hub.setWatcher('off', 'Started with --no-screen');
  console.log('Screen watching is off (--no-screen).\n');
} else {
  const status = await modelStatus(args.model);
  if (status === 'no-ollama') {
    hub.setWatcher('no-model', 'Ollama is not running');
    console.log('Screen watching is off: Ollama is not running. Install it from https://ollama.com and start it.\n');
  } else if (status === 'no-model') {
    hub.setWatcher('no-model', `Run: ollama pull ${args.model}`);
    console.log(`Screen watching is off: the ${args.model} model isn't downloaded. Run:  ollama pull ${args.model}\n`);
  } else {
    console.log(`Screen watching: ${args.model}, checking every ${args.interval}s while a session runs.`);
    console.log('Screenshots are judged on this Mac and deleted straight away.\n');
    createWatcher({ hub, model: args.model, intervalSec: Number(args.interval), dwellSec: Number(args.dwell), log }).start();
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await hub.close();
    process.exit(0);
  });
}
