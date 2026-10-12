// The other things the companion starts so you don't have to: Ollama (the
// local model server) if it isn't running, and the server the phone loads
// the OnTask app from in Expo Go.

import { spawn } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelStatus } from './vision.js';

const MOBILE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mobile');
export const APP_PORT = 8081;

const portInUse = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Start `ollama serve` if Ollama isn't answering, and wait for it to come up.
// It's left running afterwards, like the Ollama app would be.
export async function ensureOllama(model, log) {
  let status = await modelStatus(model);
  if (status !== 'no-ollama') return status;
  try {
    const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    log('started Ollama');
  } catch {
    return status;
  }
  for (let i = 0; i < 20 && status === 'no-ollama'; i++) {
    await wait(500);
    status = await modelStatus(model);
  }
  return status;
}

// Run the Expo dev server for the phone app, unless one is already running
// (for example `npx expo start` in a terminal). Output goes to the log file.
export async function startAppServer({ logFile, log, port = APP_PORT }) {
  const cli = join(MOBILE_DIR, 'node_modules', 'expo', 'bin', 'cli');
  if (!existsSync(cli)) {
    log('phone app server not started: run `npm install` in mobile/ once');
    return null;
  }
  if (await portInUse(port)) {
    log(`phone app server already running on port ${port}`);
    return { stop() {} }; // not ours to stop
  }
  const out = logFile ? openSync(logFile, 'a') : 'ignore';
  // Its own process group, so stopping it also stops the helpers Expo starts.
  const child = spawn(process.execPath, [cli, 'start', '--port', String(port), '--offline'], {
    cwd: MOBILE_DIR,
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', out, out],
    detached: true,
  });
  child.on('error', (err) => log(`phone app server failed: ${err.message}`));
  log(`serving the phone app on port ${port}`);
  return {
    stop() {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    },
  };
}
