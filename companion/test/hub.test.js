import assert from 'node:assert/strict';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createHub, memoryAuth } from '../src/hub.js';

const PORT = 45170;
const settle = () => new Promise((r) => setTimeout(r, 80));
function open(hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const inbox = [];
    ws.on('message', (m) => inbox.push(JSON.parse(m)));
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', ...hello }));
      resolve({ ws, inbox, send: (msg) => ws.send(JSON.stringify(msg)) });
    });
  });
}

const auth = memoryAuth('ABC234');
const hub = createHub({ port: PORT, host: '127.0.0.1', auth, computer: { name: 'Aaryan’s MacBook Air', host: 'Aaryans-MacBook-Air.local', addresses: ['192.168.1.69'] } });
await hub.ready;
let phoneToken;

test('a wrong pairing code is rejected', async () => {
  const bad = await open({ device: 'phone', pair: { code: 'WRONG1', name: 'x' } });
  await settle();
  assert.equal(bad.inbox[0].type, 'error');
  assert.equal(bad.ws.readyState, WebSocket.CLOSED);
  assert.equal(auth.phones().length, 0);
});

test('a phone pairs once with the code and a name, and gets its own key', async () => {
  const phone = await open({ device: 'phone', pair: { code: 'abc-234', name: 'Aaryan’s iPhone' } });
  await settle();
  const paired = phone.inbox.find((m) => m.type === 'paired');
  assert.equal(paired.phone.name, 'Aaryan’s iPhone');
  phoneToken = paired.token;
  const welcome = phone.inbox.find((m) => m.type === 'welcome');
  assert.equal(welcome.computer.name, 'Aaryan’s MacBook Air');
  assert.equal(welcome.computer.host, 'Aaryans-MacBook-Air.local');
  assert.equal(welcome.you.name, 'Aaryan’s iPhone');
  assert.deepEqual(hub.state.devices.phones.map((p) => [p.name, p.connected]), [['Aaryan’s iPhone', true]]);
  assert.ok(!JSON.stringify(hub.state).includes(phoneToken), 'keys are never broadcast');
  phone.ws.close();
  await settle();
  assert.equal(hub.state.devices.phones[0].connected, false);
});

test('next time it signs in with its key, no code needed, even after the code changes', async () => {
  auth.code = 'NEW999';
  const phone = await open({ device: 'phone', token: phoneToken });
  await settle();
  assert.equal(phone.inbox[0].type, 'welcome');
  assert.equal(hub.state.devices.phone, true);
  assert.equal(auth.phones().length, 1, 'no duplicate pairing');
  phone.ws.close();
  await settle();
});

test('the extension signs in with its key and relays the session to the phone', async () => {
  const ext = await open({ device: 'extension', token: auth.extensionToken });
  const phone = await open({ device: 'phone', token: phoneToken });
  await settle();
  ext.send({ type: 'session-start', session: { id: 's1', task: 'CS 246 notes', startedAt: 1 } });
  await settle();
  assert.equal(phone.inbox.filter((m) => m.type === 'state').at(-1).state.session.task, 'CS 246 notes');
  phone.send({ type: 'phone-away' });
  phone.send({ type: 'phone-back' });
  phone.send({ type: 'phone-check' });
  ext.send({ type: 'phone-check' }); // only phones report pickups
  await settle();
  assert.equal(hub.state.phone.checks, 1);

  // Forgetting the phone from Chrome closes it and its key stops working.
  ext.send({ type: 'forget', phoneId: hub.state.devices.phones[0].id });
  await settle();
  assert.equal(phone.inbox.at(-1).code, 'forgotten');
  assert.equal(phone.ws.readyState, WebSocket.CLOSED);
  const again = await open({ device: 'phone', token: phoneToken });
  await settle();
  assert.equal(again.inbox[0].code, 'forgotten');
  ext.ws.close();
});

test('cleanup', async () => {
  await hub.close();
});
