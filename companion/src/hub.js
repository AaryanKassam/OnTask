// The hub the phone app and the Chrome extension connect to. It holds one
// shared session and relays what each device knows: the task, phone pickups,
// and what's on screen. Only the list of paired phones is kept on disk.
//
// Signing in: the extension presents its own key; a paired phone presents the
// key it got when it paired; a new phone presents the pairing code and a name
// for itself, and gets its key back.

import { WebSocketServer } from 'ws';

const DEVICES = ['extension', 'phone'];
const HELLO_TIMEOUT_MS = 5000;

export const normalizeCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// In-memory stand-in for config.js, for tests and --no-save runs.
export function memoryAuth(code) {
  const devices = [];
  return {
    code,
    extensionToken: `ext-${code}`,
    phones: () => devices.map(({ id, name, pairedAt, lastSeen }) => ({ id, name, pairedAt, lastSeen })),
    findByToken: (token) => devices.find((d) => d.token === token) ?? null,
    async addPhone(name) {
      const d = { id: `phone-${devices.length + 1}`, name: name || 'Phone', token: `tok-${devices.length + 1}-${Math.random().toString(36).slice(2)}`, pairedAt: Date.now(), lastSeen: Date.now() };
      devices.push(d);
      return d;
    },
    async removePhone(id) {
      devices.splice(0, devices.length, ...devices.filter((d) => d.id !== id));
    },
    async touch() {},
  };
}

export function createHub({ port, host = '0.0.0.0', code, auth = memoryAuth(code), computer = { name: 'This computer', host: '', addresses: [] }, log = () => {} }) {
  const wss = new WebSocketServer({ port, host, maxPayload: 64 * 1024 });
  const clients = new Map(); // socket -> { device, phoneId, name }
  const listeners = new Set();
  const requestHandlers = new Map(); // message type -> (device, msg, reply) => void
  const state = {
    session: null, // { id, task, startedAt, source, timer }
    devices: { extension: false, phone: false, phones: [] }, // phones: [{ id, name, connected, lastSeen }]
    phone: { away: false, since: null, checks: 0 },
    screen: null, // { app, title, verdict, activity, reason, at }
    watcher: { status: 'starting', detail: '' },
  };

  const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

  function toAll(msg) {
    for (const [ws, info] of clients) if (info.device) send(ws, msg);
  }

  function changed() {
    toAll({ type: 'state', state });
    for (const l of listeners) l(state);
  }

  function refreshDevices() {
    const infos = [...clients.values()];
    const phones = auth.phones().map((p) => ({ ...p, connected: infos.some((c) => c.phoneId === p.id) }));
    state.devices = { extension: infos.some((c) => c.device === 'extension'), phone: phones.some((p) => p.connected), phones };
  }

  async function forgetPhone(id) {
    await auth.removePhone(id);
    for (const [ws, info] of clients) {
      if (info.phoneId === id) {
        send(ws, { type: 'error', code: 'forgotten', message: 'This phone was removed from OnTask on your computer.' });
        ws.close(4004, 'forgotten');
      }
    }
    refreshDevices();
    changed();
  }

  async function signIn(ws, info, msg, req) {
    const reject = (message, code = 'bad-code') => {
      send(ws, { type: 'error', code, message });
      ws.close(4003, code);
    };
    if (msg.type !== 'hello' || !DEVICES.includes(msg.device)) return reject('Say hello first');
    if (msg.device === 'extension') {
      if (msg.token !== auth.extensionToken && normalizeCode(msg.token) !== auth.code) return reject('Wrong pairing code');
      Object.assign(info, { device: 'extension', name: 'Chrome' });
    } else {
      let phone = msg.token ? auth.findByToken(msg.token) : null;
      if (!phone && msg.pair) {
        if (normalizeCode(msg.pair.code) !== auth.code) return reject('Wrong pairing code');
        phone = await auth.addPhone(msg.pair.name);
        send(ws, { type: 'paired', token: phone.token, phone: { id: phone.id, name: phone.name } });
        log(`paired a new phone: ${phone.name}`);
      }
      if (!phone) {
        return msg.token ? reject('This phone was removed from OnTask on your computer. Pair it again.', 'forgotten') : reject('Wrong pairing code');
      }
      Object.assign(info, { device: 'phone', phoneId: phone.id, name: phone.name });
      auth.touch(phone.id);
    }
    refreshDevices();
    log(`${info.name} connected (${req.socket.remoteAddress})`);
    send(ws, { type: 'welcome', state, computer: { ...computer, port }, you: { id: info.phoneId ?? null, name: info.name } });
    changed();
  }

  function endSession(by) {
    if (!state.session) return;
    const { id } = state.session;
    state.session = null;
    state.phone = { away: false, since: null, checks: 0 };
    state.screen = null;
    toAll({ type: 'session-ended', id, by });
    changed();
  }

  function cleanTimer(t) {
    if (!t || typeof t !== 'object') return null;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    return {
      kind: String(t.kind ?? '').slice(0, 20),
      phase: t.phase === 'break' ? 'break' : 'focus',
      endsAt: num(t.endsAt),
      phaseStartedAt: num(t.phaseStartedAt),
      blocksDone: num(t.blocksDone) ?? 0,
      isLong: !!t.isLong,
    };
  }

  function handle(info, msg, reply) {
    const { device } = info;
    const custom = requestHandlers.get(msg.type);
    if (custom) return custom(device, msg, reply);
    switch (msg.type) {
      case 'forget': // a phone unpairing itself, or Chrome removing one
        if (device === 'phone') forgetPhone(info.phoneId);
        else if (msg.phoneId) forgetPhone(String(msg.phoneId));
        break;
      case 'session-start': {
        const s = msg.session ?? {};
        if (!s.id || !s.task) return;
        state.session = {
          id: String(s.id).slice(0, 64),
          task: String(s.task).slice(0, 200),
          startedAt: Number(s.startedAt) || Date.now(),
          source: device,
          timer: cleanTimer(s.timer),
        };
        state.phone = { away: false, since: null, checks: 0 };
        state.screen = null;
        log(`${info.name} started “${state.session.task}”`);
        changed();
        break;
      }
      case 'session-update': // the timer moved on, or the task changed
        if (!state.session || String(msg.id) !== state.session.id) return;
        if ('timer' in msg) state.session = { ...state.session, timer: cleanTimer(msg.timer) };
        if (msg.task) state.session = { ...state.session, task: String(msg.task).slice(0, 200) };
        changed();
        break;
      case 'session-end':
        if (state.session && String(msg.id) === state.session.id) {
          log(`${info.name} ended the session`);
          endSession(device);
        }
        break;
      case 'phone-away':
        if (device !== 'phone') return;
        state.phone = { ...state.phone, away: true, since: Date.now() };
        changed();
        break;
      case 'phone-back':
        if (device !== 'phone') return;
        state.phone = { ...state.phone, away: false, since: null };
        changed();
        break;
      case 'phone-check': // the user confirmed they were on their phone
        if (device !== 'phone') return;
        state.phone = { ...state.phone, checks: state.phone.checks + 1 };
        log(`${info.name} was picked up mid-block`);
        changed();
        break;
      // 'ping' keeps the extension's service worker awake; nothing to do.
    }
  }

  wss.on('connection', (ws, req) => {
    const info = { device: null, phoneId: null, name: null, signingIn: false };
    clients.set(ws, info);
    const helloTimer = setTimeout(() => ws.close(4001, 'hello required'), HELLO_TIMEOUT_MS);

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!clients.has(ws)) return;
      if (!info.device) {
        // Nothing is shared until a connection signs in, so a web page or
        // another device on the network can't read or change the session.
        if (info.signingIn) return;
        info.signingIn = true;
        clearTimeout(helloTimer);
        await signIn(ws, info, msg, req);
        info.signingIn = false;
        return;
      }
      handle(info, msg, (out) => send(ws, out));
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      clients.delete(ws);
      if (info.device) {
        refreshDevices();
        log(`${info.name} disconnected`);
        changed();
      }
    });
    ws.on('error', () => {});
  });

  return {
    state,
    ready: new Promise((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    }),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    forgetPhone,
    // Requests that need the screen watcher, e.g. 'check-now' and 'infer'.
    onRequest(type, fn) {
      requestHandlers.set(type, fn);
    },
    setScreen(screen) {
      state.screen = screen;
      changed();
    },
    setWatcher(status, detail = '') {
      if (state.watcher.status === status && state.watcher.detail === detail) return;
      state.watcher = { status, detail };
      changed();
    },
    close: () => new Promise((resolve) => {
      for (const ws of clients.keys()) ws.terminate();
      wss.close(() => resolve());
    }),
  };
}
