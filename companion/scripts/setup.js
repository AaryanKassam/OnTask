#!/usr/bin/env node
// One-time setup: lets the OnTask Chrome extension start the companion by
// itself, so you never have to open a terminal for it again.
//
//   npm run setup            register with Chrome (and Brave, Edge, Arc if installed)
//   npm run setup -- --remove   undo it
//
// Chrome only starts programs that are registered as "native messaging hosts"
// for a specific extension, so this writes that registration plus a small
// launcher script that knows where Node and Ollama live on this Mac.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOST_NAME = 'com.ontask.companion';
const here = dirname(fileURLToPath(import.meta.url));
const companionDir = resolve(here, '..');
const repoDir = resolve(companionDir, '..');
const support = join(homedir(), 'Library', 'Application Support');

// Where each Chromium-based browser looks for native messaging hosts.
const BROWSERS = [
  { name: 'Google Chrome', dir: join(support, 'Google', 'Chrome'), always: true },
  { name: 'Chrome Beta', dir: join(support, 'Google', 'Chrome Beta') },
  { name: 'Chrome Canary', dir: join(support, 'Google', 'Chrome Canary') },
  { name: 'Chromium', dir: join(support, 'Chromium') },
  { name: 'Brave', dir: join(support, 'BraveSoftware', 'Brave-Browser') },
  { name: 'Microsoft Edge', dir: join(support, 'Microsoft Edge') },
  { name: 'Arc', dir: join(support, 'Arc', 'User Data') },
];

// The extension ID is derived from the public key in its manifest.
export function extensionId(manifestPath = join(repoDir, 'extension', 'manifest.json')) {
  const { key } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16).toString('hex');
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

// Copies of OnTask a browser has already loaded from this folder. A copy
// loaded before the extension had a fixed key keeps its old, path-based ID,
// so allow that one too rather than make you remove and re-add it.
export function installedIds(browserDir, extensionDir = join(repoDir, 'extension')) {
  const ids = new Set();
  let profiles = [];
  try {
    profiles = readdirSync(browserDir).filter((d) => d === 'Default' || d.startsWith('Profile '));
  } catch {
    return [];
  }
  for (const profile of profiles) {
    for (const file of ['Secure Preferences', 'Preferences']) {
      try {
        const prefs = JSON.parse(readFileSync(join(browserDir, profile, file), 'utf8'));
        for (const [id, info] of Object.entries(prefs.extensions?.settings ?? {})) {
          if (info?.path && resolve(info.path) === resolve(extensionDir)) ids.add(id);
        }
      } catch {
        // profile without that file
      }
    }
  }
  return [...ids];
}

function which(cmd) {
  try {
    return execFileSync('/usr/bin/which', [cmd], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

const launcherPath = join(homedir(), '.ontask', 'ontask-companion');

// Only do the setup when run as a script, not when imported (by tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) setup();

function setup() {
  if (process.argv.includes('--remove')) {
    for (const b of BROWSERS) rmSync(join(b.dir, 'NativeMessagingHosts', `${HOST_NAME}.json`), { force: true });
    rmSync(launcherPath, { force: true });
    console.log('Removed. Chrome will no longer start the OnTask companion.');
    return;
  }

  if (!existsSync(join(companionDir, 'node_modules', 'ws'))) {
    console.error('Run `npm install` in the companion folder first.');
    process.exitCode = 1;
    return;
  }

  // Chrome starts hosts with a bare PATH, so spell out where Node and Ollama are.
  const node = process.execPath;
  const ollama = which('ollama');
  const pathDirs = [
    ...new Set([dirname(node), ollama && dirname(ollama), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(Boolean)),
  ];
  mkdirSync(dirname(launcherPath), { recursive: true });
  writeFileSync(
    launcherPath,
    `#!/bin/sh
# Started by Chrome for the OnTask extension. Written by companion/scripts/setup.js.
export PATH="${pathDirs.join(':')}"
exec "${node}" "${join(companionDir, 'src', 'index.js')}" --native "$@" 2>>"$HOME/.ontask/companion.log"
`,
  );
  chmodSync(launcherPath, 0o755);

  const id = extensionId();
  const installed = [];
  const found = new Set();
  for (const b of BROWSERS) {
    if (!b.always && !existsSync(b.dir)) continue;
    const loaded = installedIds(b.dir);
    loaded.forEach((x) => found.add(x));
    const manifest = {
      name: HOST_NAME,
      description: 'OnTask companion: links your phone and watches your screen with a local model',
      path: launcherPath,
      type: 'stdio',
      allowed_origins: [...new Set([id, ...loaded])].map((x) => `chrome-extension://${x}/`),
    };
    const dir = join(b.dir, 'NativeMessagingHosts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${HOST_NAME}.json`), JSON.stringify(manifest, null, 2));
    installed.push(b.name);
  }
  const step1 = found.size
    ? `OnTask is already loaded in your browser, so just click the reload icon on it in chrome://extensions.`
    : `In chrome://extensions, turn on Developer mode, click Load unpacked and pick\n     ${join(repoDir, 'extension')}`;

  console.log(`
Done. ${installed.join(', ')} can now start the OnTask companion by itself.

Next:
  1. ${step1}
  2. Click the OnTask icon. The companion starts, along with Ollama and the
     phone app server, and a Devices tab opens so you can pair your phone.
  3. The first time it looks at your screen, macOS asks to let Google Chrome
     record the screen and control System Events. Allow both, then quit and
     reopen Chrome.
${ollama ? '' : '\nOllama wasn’t found on your PATH. Install it from https://ollama.com for screen watching.\n'}
Logs: ~/.ontask/companion.log   Undo: npm run setup -- --remove
`);
}
