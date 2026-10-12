import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWatcher } from '../src/watcher.js';

function fakeHub(session) {
  return {
    state: { session, devices: { extension: true, phone: false } },
    screens: [],
    statuses: [],
    setScreen(s) { this.screens.push(s); },
    setWatcher(status, detail) { this.statuses.push({ status, detail }); },
  };
}

test('screenshots only on change, notifies after sustained drift outside the browser', async () => {
  let t = 0;
  let front = { app: 'Code', title: 'a3.cc' };
  const shots = [];
  const notes = [];
  const verdicts = { Code: 'on', Discord: 'off', 'Google Chrome': 'off' };
  const mac = {
    frontmost: async () => front,
    screenshot: async () => (shots.push(front.app), 'img'),
    notify: async (title, body) => notes.push(body),
  };
  const judge = async ({ app }) => ({ verdict: verdicts[app], activity: `using ${app}`, reason: '', ms: 1000 });
  const hub = fakeHub({ id: 's1', task: 'CS 246 A3' });
  const w = createWatcher({ hub, model: 'm', dwellSec: 120, mac, judge, now: () => t });

  await w.check();
  t += 20_000; await w.check();
  assert.deepEqual(shots, ['Code'], 'same window: no new screenshot');
  assert.equal(hub.screens.at(-1).verdict, 'on');

  front = { app: 'Discord', title: '#general' };
  t += 20_000; await w.check();
  assert.deepEqual(shots, ['Code', 'Discord'], 'window change: new screenshot');
  t += 60_000; await w.check();
  assert.equal(notes.length, 0, 'a minute in Discord is not drift yet');
  t += 70_000; await w.check();
  assert.equal(notes.length, 1, 'past the 2 minute dwell: notified');
  assert.match(notes[0], /Discord/);
  t += 20_000; await w.check();
  assert.equal(notes.length, 1, 'no repeat right away');
  assert.equal(shots.length, 3, 'rechecked the same window after 2 minutes');

  front = { app: 'Google Chrome', title: 'NBA Highlights' };
  t += 20_000; await w.check();
  t += 300_000; await w.check();
  assert.equal(notes.length, 1, 'Chrome with the extension connected: the extension prompts, not the companion');

  front = { app: 'loginwindow', title: '' };
  t += 20_000; await w.check();
  assert.equal(shots.at(-1), 'Google Chrome', 'locked screen: no screenshot');

  hub.state.session = null;
  await w.check();
  assert.equal(hub.statuses.at(-1).status, 'idle', 'no session: idle, no screenshots');
});

test('missing Screen Recording permission is reported, not thrown', async () => {
  const { PermissionError } = await import('../src/mac.js');
  const hub = fakeHub({ id: 's1', task: 't' });
  const mac = { frontmost: async () => ({ app: 'Code', title: '' }), screenshot: async () => { throw new PermissionError('denied'); }, notify: async () => {} };
  const w = createWatcher({ hub, model: 'm', mac, judge: async () => ({}) });
  await w.check();
  assert.equal(hub.statuses.at(-1).status, 'no-permission');
});
