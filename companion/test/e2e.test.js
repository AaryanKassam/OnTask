// The real hub, the real extension background (with a fake Chrome) and a
// fake phone, talking over real WebSockets. The screen watcher is replaced by
// a stand-in that answers check-now and infer requests.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import WebSocket from 'ws';
import { installChrome } from '../../extension/test/chrome-mock.mjs';
import { createHub } from '../src/hub.js';

const PORT = 45173;
const CODE = 'PAIR42';
const hub = createHub({ port: PORT, host: '127.0.0.1', code: CODE });
await hub.ready;
hub.setWatcher('idle', 'Waiting for a session to start');

// Stand-in for the screen watcher: what the "screen" shows for each title.
const screens = {
  'Outline | University of Waterloo': { verdict: 'on', activity: 'Reading the CS 246 course outline' },
  'NBA Highlights: Lakers vs Celtics - YouTube': { verdict: 'off', activity: 'Watching NBA highlights on YouTube' },
};
let checks = 0;
hub.onRequest('check-now', () => {
  checks++;
  const tab = t.tabs.find((x) => x.active);
  const seen = screens[tab.title];
  if (!seen) return;
  hub.setWatcher('watching', seen.activity);
  setTimeout(() => hub.setScreen({ app: 'Google Chrome', title: tab.title, reason: '', ms: 1500, at: Date.now() + checks, ...seen }), 20);
});
hub.onRequest('infer', (_d, msg, reply) => reply({ type: 'infer-result', reqId: msg.reqId, task: 'CS 246 assignment 3' }));

const t = installChrome({ tabs: [{ id: 1, url: 'https://student.cs.uwaterloo.ca/~cs246/notes', title: 'CS 246 Course Notes' }] });
await import('../../extension/background.js');
chrome.runtime.onInstalled.fire();
await t.settle(60);

const phone = new WebSocket(`ws://127.0.0.1:${PORT}`);
const phoneInbox = [];
phone.on('message', (m) => phoneInbox.push(JSON.parse(m)));
await new Promise((r) => phone.on('open', r));
phone.send(JSON.stringify({ type: 'hello', device: 'phone', pair: { code: CODE, name: 'Test phone' } }));
const phoneState = () => phoneInbox.filter((m) => m.type === 'state' || m.type === 'welcome').at(-1).state;

test('extension pairs and its session, with the timer, reaches the phone', async () => {
  await t.send({ type: 'pair-companion', code: 'pair-42', port: PORT });
  await t.settle(200);
  assert.equal(t.session.sync.status, 'connected');
  await t.answer('ask-set', 'CS246 notes');
  await t.settle(150);
  const s = phoneState().session;
  assert.equal(s.task, 'CS246 notes');
  assert.equal(s.source, 'extension');
  assert.equal(s.timer.kind, 'pomodoro');
  assert.equal(s.timer.endsAt - s.timer.phaseStartedAt, 25 * 60_000);
});

test('a CS course outline whose title shares no words with the task is judged by the screen, not the title', async () => {
  t.now += 5000;
  await t.visit(2, 'https://outline.uwaterloo.ca/viewer/view/abc', 'Outline | University of Waterloo');
  await t.settle(150);
  const c = t.state().current;
  assert.ok(checks >= 1, 'the extension asked for a screen check on the tab change');
  assert.equal(c.verdict, 'on');
  assert.equal(c.reason, 'On screen: Reading the CS 246 course outline');
  assert.equal(t.alarms.dwell, undefined, 'no drift clock');
});

test('while the screen is being checked, a title alone never says off task', async () => {
  hub.onRequest('check-now', () => {}); // the screen check is slow to answer
  t.now += 5000;
  await t.visit(3, 'https://www.youtube.com/watch?v=nba', 'NBA Highlights: Lakers vs Celtics - YouTube');
  await t.settle(100);
  assert.equal(t.state().current.verdict, 'ambiguous');
  assert.equal(t.state().current.reason, 'Checking what’s on screen…');
  hub.setScreen({ app: 'Google Chrome', title: 'NBA Highlights: Lakers vs Celtics - YouTube', verdict: 'off', activity: 'Watching NBA highlights on YouTube', reason: '', at: t.now + 100 });
  await t.settle(150);
  assert.equal(t.state().current.verdict, 'off', 'then the screen decides');
});

test('timer changes in the extension reach the phone', async () => {
  await t.send({ type: 'save-settings', settings: { timer: 'deep' } });
  await t.settle(150);
  const timer = phoneState().session.timer;
  assert.equal(timer.kind, 'deep');
  assert.equal(timer.endsAt - timer.phaseStartedAt, 90 * 60_000);
});

test('with no answer, the 20-second guess comes from the local model on the companion', async () => {
  await t.send({ type: 'stop' });
  await t.settle(100);
  assert.ok(phoneInbox.some((m) => m.type === 'session-ended'), 'ending in Chrome tells the phone');
  await t.send({ type: 'start' });
  await t.settle(100);
  t.now += 30_000;
  await t.visit(1, 'https://student.cs.uwaterloo.ca/~cs246/a3', 'A3 handout');
  await t.advanceTo('observe');
  await t.settle(200);
  assert.equal(t.state().mode, 'confirming');
  assert.equal(t.state().guess, 'CS 246 assignment 3');
  assert.equal(t.lastCard().kind, 'confirm');
});

test('cleanup', async () => {
  phone.close();
  await hub.close();
  setTimeout(() => process.exit(0), 50); // the extension keeps a reconnect timer alive
});
