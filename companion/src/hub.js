// The hub the phone app and the Chrome extension connect to. It holds one
// shared session and relays what each device knows: the task, phone pickups,
// and what's on screen. Nothing is stored on disk.

import { WebSocketServer } from 'ws';

const DEVICES = ['extension', 'phone'];
const HELLO_TIMEOUT_MS = 5000;

export const normalizeCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function createHub({ port, host = '0.0.0.0', code, log = () => {} }) {
  const wss = new WebSocketServer({ port, host, maxPayload: 64 * 1024 });
  const clients = new Map(); // socket -> { device }
  const listeners = new Set();
  const state = {
    session: null, // { id, task, startedAt, source }
    devices: { extension: false, phone: false },
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
    const connected = [...clients.values()].map((c) => c.device);
    state.devices = { extension: connected.includes('extension'), phone: connected.includes('phone') };
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

  function handle(device, msg) {
    switch (msg.type) {
      case 'session-start': {
        const s = msg.session ?? {};
        if (!s.id || !s.task) return;
        state.session = { id: String(s.id).slice(0, 64), task: String(s.task).slice(0, 200), startedAt: Number(s.startedAt) || Date.now(), source: device };
        state.phone = { away: false, since: null, checks: 0 };
        state.screen = null;
        log(`${device} started “${state.session.task}”`);
        changed();
        break;
      }
      case 'session-end':
        if (state.session && String(msg.id) === state.session.id) {
          log(`${device} ended the session`);
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
        log('phone check confirmed');
        changed();
        break;
      // 'ping' keeps the extension's service worker awake; nothing to do.
    }
  }

  wss.on('connection', (ws, req) => {
    clients.set(ws, { device: null });
    const helloTimer = setTimeout(() => ws.close(4001, 'hello required'), HELLO_TIMEOUT_MS);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const info = clients.get(ws);
      if (!info) return;
      if (!info.device) {
        // Every connection must present the pairing code first, so a web page
        // or another device on the network can't read or change the session.
        if (msg.type !== 'hello' || normalizeCode(msg.token) !== code || !DEVICES.includes(msg.device)) {
          send(ws, { type: 'error', message: 'Wrong pairing code' });
          ws.close(4003, 'bad code');
          return;
        }
        clearTimeout(helloTimer);
        info.device = msg.device;
        refreshDevices();
        log(`${msg.device} connected (${req.socket.remoteAddress})`);
        send(ws, { type: 'welcome', state });
        changed();
        return;
      }
      handle(info.device, msg);
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      const info = clients.get(ws);
      clients.delete(ws);
      if (info?.device) {
        refreshDevices();
        log(`${info.device} disconnected`);
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
