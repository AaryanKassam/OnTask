// Drives a whole session through background.js with a fake Chrome:
// asking, guessing after 20 seconds, drift, timers and break links.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installChrome } from './chrome-mock.mjs';

const MIN = 60_000;
const t = installChrome({
  tabs: [
    { id: 1, url: 'https://www.youtube.com/watch?v=a', title: 'Linear Algebra Lecture 4: Eigenvalues - YouTube' },
    { id: 2, url: 'https://learn.uwaterloo.ca/', title: 'MATH 136 Linear Algebra 1 - Course Home' },
  ],
});
await import('../background.js');
chrome.runtime.onInstalled.fire();
await t.settle(60);

test('asks what you are working on as soon as it starts', () => {
  assert.equal(t.state().mode, 'observing');
  assert.equal(t.lastCard().kind, 'ask');
  assert.equal(t.lastCard().seconds, 20);
  assert.equal(t.alarms.observe, t.now + 20_000);
});

test('typing an answer holds off the guess', async () => {
  await t.send({ type: 'ask-typing' });
  await t.advanceTo('observe');
  assert.equal(t.state().mode, 'observing', 'still asking');
  assert.equal(t.lastCard().kind, 'ask');
});

test('no answer: after 20 seconds it guesses and checks with you', async () => {
  await t.advanceTo('observe');
  assert.equal(t.state().mode, 'confirming');
  assert.equal(t.lastCard().kind, 'confirm');
  assert.match(t.state().guess, /Linear Algebra/);
  assert.ok(t.chimes >= 1, 'with a chime');
});

test('Yes starts the session with the Pomodoro timer by default', async () => {
  await t.answer('confirm-yes');
  const s = t.state();
  assert.equal(s.mode, 'active');
  assert.equal(s.timer.kind, 'pomodoro');
  assert.equal(s.timer.endsAt - s.timer.phaseStartedAt, 25 * MIN);
  assert.equal(s.current.verdict, 'on');
});

test('without the companion, a clearly off-task tab prompts after the dwell', async () => {
  t.now += 5000;
  await t.visit(3, 'https://www.youtube.com/watch?v=nba', 'NBA Highlights: Lakers vs Celtics - YouTube');
  assert.equal(t.state().current.verdict, 'off');
  await t.advanceTo('dwell');
  assert.equal(t.lastCard().kind, 'drift');
  await t.answer('drift-back');
  await t.settle();
  assert.equal(t.state().current.tabId, 1);
});

test('break time: card with TikTok, YouTube, Instagram and X, and no drift prompts', async () => {
  await t.advanceTo('timer');
  const s = t.state();
  assert.equal(s.timer.phase, 'break');
  assert.equal(t.lastCard().kind, 'break');
  await t.answer('break-open', 'tiktok');
  await t.send({ type: 'open-break-site', site: 'x' });
  assert.deepEqual(t.opened, ['https://www.tiktok.com/', 'https://x.com/']);
  t.now += 1000;
  await t.visit(4, 'https://www.instagram.com/', 'Instagram');
  assert.equal(t.alarms.dwell, undefined, 'no drift clock during the break');
});

test('every timer is available, including custom and Flowtime', async () => {
  const check = async (timer, focus, brk) => {
    await t.send({ type: 'save-settings', settings: { timer } });
    await t.settle();
    const tm = t.state().timer;
    assert.equal(tm.kind, timer);
    if (focus) assert.equal(tm.endsAt - tm.phaseStartedAt, focus * MIN, `${timer} focus`);
    if (brk) assert.equal(tm.breakMin, brk, `${timer} break`);
  };
  await check('sprint', 15, 3);
  await check('fiftyTwo', 52, 17);
  await check('deep', 90, 20);
  await t.send({ type: 'save-settings', settings: { customFocusMin: 40, customBreakMin: 10 } });
  await check('custom', 40, 10);

  await check('flow');
  assert.equal(t.state().timer.endsAt, null, 'Flowtime focus is open-ended');
  t.now += 40 * MIN;
  await t.send({ type: 'take-break' });
  await t.settle();
  const tm = t.state().timer;
  assert.equal(tm.phase, 'break');
  assert.equal(tm.endsAt - tm.phaseStartedAt, 8 * MIN, '40 minutes of focus earns an 8 minute break');

  await t.send({ type: 'save-settings', settings: { timer: 'off' } });
  await t.settle();
  assert.equal(t.state().timer, null, 'Off removes the timer');
});

test('typing the task straight away skips the guess', async () => {
  await t.send({ type: 'stop' });
  await t.send({ type: 'start' });
  await t.settle(60);
  assert.equal(t.lastCard().kind, 'ask');
  await t.answer('ask-set', 'CS 246 notes');
  assert.equal(t.state().mode, 'active');
  assert.equal(t.state().task, 'CS 246 notes');
  assert.equal(t.alarms.observe, undefined);
});
