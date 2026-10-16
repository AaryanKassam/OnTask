// What the companion remembers between runs, in ~/.ontask/companion.json:
// the pairing code, a key for the extension, and every phone you've paired,
// each with its own name and key so it never has to pair again.

import { execFile } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const CONFIG_DIR = join(homedir(), '.ontask');
const CONFIG = join(CONFIG_DIR, 'companion.json');
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const run = promisify(execFile);

const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const newToken = () => randomBytes(24).toString('base64url');
const cleanName = (name) => String(name || 'Phone').trim().slice(0, 40) || 'Phone';

export async function loadConfig({ freshCode = false, path = CONFIG } = {}) {
  let config = {};
  try {
    config = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // first run
  }
  const before = JSON.stringify(config);
  if (!config.code || freshCode) config.code = newCode();
  config.id ??= randomUUID();
  config.extensionToken ??= newToken();
  config.devices ??= [];

  const save = async () => {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  };
  if (JSON.stringify(config) !== before) await save();

  return {
    get code() {
      return config.code;
    },
    id: config.id,
    extensionToken: config.extensionToken,
    phones: () => config.devices.map(({ id, name, pairedAt, lastSeen, active }) => ({ id, name, pairedAt, lastSeen, active: active !== false })),
    findByToken: (token) => config.devices.find((d) => d.token === token) ?? null,
    async addPhone(name) {
      const device = { id: randomUUID(), name: cleanName(name), token: newToken(), pairedAt: Date.now(), lastSeen: Date.now(), active: true };
      config.devices.push(device);
      await save();
      return device;
    },
    // Active phones follow OnTask sessions; inactive ones stay paired but quiet.
    async setActive(id, active) {
      const d = config.devices.find((x) => x.id === id);
      if (d) {
        d.active = !!active;
        await save();
      }
    },
    async rename(id, name) {
      const d = config.devices.find((x) => x.id === id);
      if (d) {
        d.name = cleanName(name);
        await save();
      }
    },
    async removePhone(id) {
      config.devices = config.devices.filter((d) => d.id !== id);
      await save();
    },
    async touch(id) {
      const d = config.devices.find((x) => x.id === id);
      if (d) {
        d.lastSeen = Date.now();
        await save();
      }
    },
  };
}

// How this Mac shows up to the phone: a friendly name, its Bonjour name
// (which stays the same when the Wi-Fi hands out a new IP address), and
// its current IP addresses as a fallback.
export async function computerInfo() {
  const scutil = (key) => run('scutil', ['--get', key], { timeout: 3000 }).then((r) => r.stdout.trim()).catch(() => '');
  const name = (await scutil('ComputerName')) || hostname().replace(/\.local$/, '');
  const local = await scutil('LocalHostName');
  const addresses = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) addresses.push(a.address);
  }
  return { name, host: local ? `${local}.local` : hostname(), addresses };
}
