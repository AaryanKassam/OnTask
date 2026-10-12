// Watches the screen while a session is running. It checks which app is in
// front every few seconds (cheap), and only takes a screenshot for the model
// when that changes or the last judgment is a couple of minutes old.
//
// When Chrome with the extension is in front, the extension does the
// prompting and this only feeds it a better verdict. For every other app,
// sustained drift gets a macOS notification, using the same dwell rule.

import * as defaultMac from './mac.js';
import { judgeScreen } from './vision.js';

const EXTENSION_BROWSERS = ['Google Chrome', 'Google Chrome Canary', 'Chromium', 'Brave Browser', 'Microsoft Edge', 'Arc'];
const AWAY_APPS = ['loginwindow', 'ScreenSaverEngine']; // locked or screensaver
const RECHECK_MS = 2 * 60_000;
const PROMPTS_PER_HOUR = 6;

export function createWatcher({ hub, model, intervalSec = 20, dwellSec = 120, log = () => {}, mac = defaultMac, judge = judgeScreen, now = Date.now }) {
  let timer = null;
  let running = false;
  let last = null; // { key, at, result }
  let offSince = null;
  let lastPromptAt = null;
  let promptTimes = [];
  let sessionId = null;

  function reset() {
    last = null;
    offSince = null;
    lastPromptAt = null;
  }

  async function check() {
    const session = hub.state.session;
    if (!session) {
      if (sessionId) reset();
      sessionId = null;
      hub.setWatcher('idle', 'Waiting for a session to start');
      return;
    }
    if (session.id !== sessionId) {
      reset();
      sessionId = session.id;
    }

    let front;
    try {
      front = await mac.frontmost();
    } catch {
      hub.setWatcher('no-permission', 'Allow your terminal to control System Events (Privacy & Security → Automation).');
      return;
    }
    if (AWAY_APPS.includes(front.app)) {
      offSince = null; // screen locked: they walked away, that's not drift
      return;
    }

    const t = now();
    const key = `${front.app}|${front.title}`;
    if (!last || last.key !== key || t - last.at >= RECHECK_MS) {
      let image;
      try {
        image = await mac.screenshot();
      } catch (err) {
        hub.setWatcher('no-permission', err instanceof defaultMac.PermissionError ? 'Turn on Screen Recording for your terminal (Privacy & Security), then restart the companion.' : String(err.message));
        return;
      }
      const result = await judge({ model, task: session.task, app: front.app, title: front.title, image });
      last = { key, at: t, result };
      hub.setScreen({ app: front.app, title: front.title, ...result, at: t });
      hub.setWatcher('watching', `${front.app} · ${result.activity}`);
      log(`${front.app.padEnd(16)} ${result.verdict.padEnd(9)} ${result.activity} (${(result.ms / 1000).toFixed(1)}s)`);
    }

    const { verdict, activity } = last.result;
    const extensionHandles = EXTENSION_BROWSERS.includes(front.app) && hub.state.devices.extension;
    if (verdict === 'on' || extensionHandles) {
      offSince = null;
      return;
    }
    offSince ??= t;
    const threshold = dwellSec * 1000 * (verdict === 'ambiguous' ? 2 : 1);
    promptTimes = promptTimes.filter((p) => t - p < 3600_000);
    const quietLongEnough = lastPromptAt === null || t - lastPromptAt >= threshold * 2;
    if (t - offSince >= threshold && quietLongEnough && promptTimes.length < PROMPTS_PER_HOUR) {
      lastPromptAt = t;
      promptTimes.push(t);
      const mins = Math.round((t - offSince) / 60_000);
      await mac.notify('You’re off task', `${mins >= 1 ? `${mins} min` : 'A while'} on ${front.app}: ${activity}. Back to “${session.task}”?`);
      log(`notified: off task in ${front.app}`);
    }
  }

  async function loop() {
    if (!running) return;
    try {
      await check();
    } catch (err) {
      hub.setWatcher('error', String(err.message ?? err));
      log(`watcher error: ${err.message ?? err}`);
    }
    if (running) timer = setTimeout(loop, intervalSec * 1000);
  }

  return {
    start() {
      running = true;
      loop();
    },
    stop() {
      running = false;
      clearTimeout(timer);
    },
    check, // exposed for tests
  };
}
