import assert from 'node:assert/strict';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createHub } from '../src/hub.js';

const PORT = 45170;
const open = (device, token = 'ABC234') =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const inbox = [];
    ws.on('message', (m) => inbox.push(JSON.parse(m)));
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', token, device }));
      resolve({ ws, inbox, send: (msg) => ws.send(JSON.stringify(msg)) });
    });
  });
const settle = () => new Promise((r) => setTimeout(r, 60));

test('hub pairs devices, relays the session and phone checks', async () => {
  const hub = createHub({ port: PORT, host: '127.0.0.1', code: 'ABC234' });
  await hub.ready;
  try {
    const bad = await open('phone', 'WRONG1');
    await settle();
    assert.equal(bad.inbox[0]?.type, 'error');
    assert.equal(bad.ws.readyState, WebSocket.CLOSED);
    assert.equal(hub.state.devices.phone, false, 'wrong code is rejected');

    const ext = await open('extension');
    const phone = await open('phone', 'abc-234'); // codes are case and dash insensitive
    await settle();
    assert.deepEqual(hub.state.devices, { extension: true, phone: true });

    ext.send({ type: 'session-start', session: { id: 's1', task: 'CS 246 A3', startedAt: 1 } });
    await settle();
    const seen = phone.inbox.filter((m) => m.type === 'state').at(-1).state;
    assert.equal(seen.session.task, 'CS 246 A3');
    assert.equal(seen.session.source, 'extension');

    phone.send({ type: 'phone-away' });
    await settle();
    assert.equal(hub.state.phone.away, true);
    phone.send({ type: 'phone-back' });
    phone.send({ type: 'phone-check' });
    ext.send({ type: 'phone-check' }); // only the phone may report phone checks
    await settle();
    assert.equal(hub.state.phone.checks, 1);

    phone.send({ type: 'session-end', id: 's1' });
    await settle();
    assert.equal(hub.state.session, null);
    assert.deepEqual(ext.inbox.find((m) => m.type === 'session-ended'), { type: 'session-ended', id: 's1', by: 'phone' });

    phone.ws.close();
    await settle();
    assert.equal(hub.state.devices.phone, false, 'disconnects are tracked');
    ext.ws.close();
  } finally {
    await hub.close();
  }
});
