// Connection to the OnTask companion running on this Mac. The companion links
// this extension with the phone app and shares what its screen watcher sees.
// Optional: with no pairing code saved, nothing here does anything.

const DEFAULT_PORT = 4517;
const PING_MS = 20_000; // traffic on the socket keeps the service worker alive

let ws = null;
let handlers = null;
let pingTimer = null;
const pending = new Map(); // reqId -> resolve, for requests that expect a reply

async function setStatus(status, detail = '', hubState) {
  const { sync } = await chrome.storage.session.get('sync');
  const next = { status, detail, hub: hubState === undefined ? sync?.hub ?? null : hubState };
  if (status !== 'connected') next.hub = null;
  await chrome.storage.session.set({ sync: next });
}

export async function getSync() {
  const { sync } = await chrome.storage.session.get('sync');
  return sync ?? { status: 'off', detail: '', hub: null };
}

export function initSync(h) {
  handlers = h;
  chrome.alarms.create('sync', { periodInMinutes: 0.5 }); // reconnect if the worker was restarted
  connect();
}

export async function connect() {
  const { companion } = await chrome.storage.local.get('companion');
  if (!companion?.code) {
    await setStatus('off');
    return;
  }
  if (ws && ws.readyState <= 1) return; // connecting or open

  const socket = new WebSocket(`ws://127.0.0.1:${companion.port || DEFAULT_PORT}`);
  ws = socket;
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'hello', token: companion.code, device: 'extension' }));
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ type: 'ping' }), PING_MS);
  };
  socket.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'welcome' || msg.type === 'state') {
      await setStatus('connected', '', msg.state);
      handlers?.onState(msg.state, msg.type === 'welcome');
    } else if (msg.type === 'infer-result' && pending.has(msg.reqId)) {
      pending.get(msg.reqId)(msg);
      pending.delete(msg.reqId);
    } else if (msg.type === 'session-ended') {
      handlers?.onSessionEnded(msg);
    } else if (msg.type === 'error') {
      await setStatus('error', msg.message);
    }
  };
  socket.onclose = async () => {
    if (ws === socket) ws = null;
    clearInterval(pingTimer);
    const current = await getSync();
    if (current.status !== 'error') await setStatus('disconnected', 'Is the companion running?');
  };
  socket.onerror = () => {};
}

export async function pair(code, port) {
  const clean = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean) await chrome.storage.local.set({ companion: { code: clean, port: Number(port) || DEFAULT_PORT } });
  else await chrome.storage.local.remove('companion');
  if (ws) {
    const old = ws;
    ws = null;
    old.close();
  }
  await setStatus(clean ? 'connecting' : 'off');
  await connect();
}

export function send(msg) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
}

// Send a message and wait for its reply. Resolves to null when the companion
// isn't connected or doesn't answer in time, so callers can fall back.
export function request(msg, timeoutMs) {
  if (ws?.readyState !== 1) return Promise.resolve(null);
  const reqId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      resolve(null);
    }, timeoutMs);
    pending.set(reqId, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    send({ ...msg, reqId });
  });
}
