// macOS helpers, all built into the OS: which app is in front, a screenshot,
// shrinking it, and a notification with sound.

import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const FRONT_SCRIPT = `
tell application "System Events"
  set p to first application process whose frontmost is true
  set appName to name of p
  set winTitle to ""
  try
    set winTitle to name of front window of p
  end try
end tell
return appName & linefeed & winTitle`;

export async function frontmost() {
  const { stdout } = await run('osascript', ['-e', FRONT_SCRIPT], { timeout: 5000 });
  const [app = '', ...rest] = stdout.replace(/\n$/, '').split('\n');
  return { app: app.trim(), title: rest.join(' ').trim() };
}

export class PermissionError extends Error {}

// Screenshot of the main display, shrunk to keep the model fast. The file is
// deleted as soon as it's been read; only the base64 string is returned.
export async function screenshot(maxSize = 1280) {
  const base = join(tmpdir(), `ontask-${process.pid}-${Date.now()}`);
  const png = `${base}.png`;
  const jpg = `${base}.jpg`;
  try {
    try {
      await run('screencapture', ['-x', '-m', '-t', 'png', png], { timeout: 10000 });
    } catch (err) {
      throw new PermissionError(`screencapture failed: ${err.stderr || err.message}`);
    }
    await run('sips', ['-Z', String(maxSize), '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', png, '--out', jpg], { timeout: 10000 });
    return (await readFile(jpg)).toString('base64');
  } catch (err) {
    if (err instanceof PermissionError) throw err;
    if (err.code === 'ENOENT') throw new PermissionError('No screenshot was produced. Screen Recording permission is probably off.');
    throw err;
  } finally {
    await rm(png, { force: true });
    await rm(jpg, { force: true });
  }
}

const OCR_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'ocr.js');

// The text on screen right now, line by line, read with Apple's Vision
// framework on this Mac. The screenshot is deleted straight away.
export async function readScreenText() {
  const png = join(tmpdir(), `ontask-read-${process.pid}-${Date.now()}.png`);
  try {
    try {
      await run('screencapture', ['-x', '-m', '-t', 'png', png], { timeout: 10000 });
    } catch (err) {
      throw new PermissionError(`screencapture failed: ${err.stderr || err.message}`);
    }
    const { stdout } = await run('osascript', ['-l', 'JavaScript', OCR_SCRIPT, png], { timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
    const out = JSON.parse(stdout);
    if (out.error) throw new Error(out.error);
    return out.lines.map((l) => l.text);
  } finally {
    await rm(png, { force: true });
  }
}

const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export async function notify(title, body, sound = true) {
  const script = `display notification ${quote(body)} with title ${quote(title)}${sound ? ' sound name "Glass"' : ''}`;
  await run('osascript', ['-e', script], { timeout: 5000 }).catch(() => {});
}
