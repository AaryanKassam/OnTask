// The phone app's real connection code (mobile/src/lib/sync.ts) against the
// real hub: pairing once, then reconnecting by key, falling back from the
// computer's name to its last IP address.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHub, memoryAuth } from '../src/hub.js';
import * as sync from '../../mobile/src/lib/sync.ts';

const PORT = 45172;
const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 8000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await wait(50);
  return cond();
};

const auth = memoryAuth('K7Q4MX');
const computer = { name: 'Aaryan’s MacBook Air', host: 'Aaryans-MacBook-Air.local', addresses: ['127.0.0.1'] };
const hub = createHub({ port: PORT, host: '127.0.0.1', auth, computer });
await hub.ready;

const events = { statuses: [], paired: null, welcomes: [], forgotten: false, you: [] };
const handlers = {
  onStatus: (s) => events.statuses.push(s),
  onState: () => {},
  onSessionEnded: () => {},
  onPaired: (token, phone) => {
    events.paired = { token, phone };
    sync.adoptToken(token);
  },
  onWelcome: (c, host) => events.welcomes.push({ c, host }),
  onForgotten: () => (events.forgotten = true),
  onYou: (you) => events.you.push(you),
};

test('pairs once with the code from the QR link and a name', async () => {
  sync.configure({ hosts: ['127.0.0.1'], port: PORT, pair: { code: 'k7q4mx', name: 'Aaryan’s iPhone' } }, handlers);
  assert.ok(await until(() => events.welcomes.length === 1));
  assert.equal(events.paired.phone.name, 'Aaryan’s iPhone');
  assert.equal(events.welcomes[0].c.name, 'Aaryan’s MacBook Air');
  assert.deepEqual(hub.state.devices.phones.map((p) => p.name), ['Aaryan’s iPhone']);
});

test('after a drop it reconnects with its key, not the code', async () => {
  auth.code = 'CHANGED'; // the old code no longer works
  sync.disconnect();
  sync.configure({ hosts: ['127.0.0.1'], port: PORT, token: events.paired.token }, handlers);
  assert.ok(await until(() => events.welcomes.length === 2));
  assert.equal(auth.phones().length, 1, 'still one paired phone');
});

test('if the computer’s name doesn’t answer, it falls back to the last IP address', async () => {
  sync.disconnect();
  sync.configure({ hosts: ['ontask-test-missing.invalid', '127.0.0.1'], port: PORT, token: events.paired.token }, handlers);
  assert.ok(await until(() => events.welcomes.length === 3, 12000));
  assert.equal(events.welcomes[2].host, '127.0.0.1');
});

test('switching the phone off, renaming it and back on in Chrome reaches the phone', async () => {
  const id = auth.phones()[0].id;
  await hub.updatePhone(id, { active: false });
  assert.ok(await until(() => events.you.at(-1)?.active === false));
  await hub.updatePhone(id, { name: 'Work iPhone', active: true });
  assert.ok(await until(() => events.you.at(-1)?.active === true && events.you.at(-1)?.name === 'Work iPhone'));
});

test('unpairing from the computer is reported to the phone', async () => {
  hub.forgetPhone(auth.phones()[0].id);
  assert.ok(await until(() => events.forgotten));
});

test('cleanup', async () => {
  sync.configure(null, handlers);
  await hub.close();
});
