// Connection to the OnTask companion on this Mac. The companion links this
// extension with the phone app and shares what its screen watcher sees.
//
// After the one-time setup (`npm run setup` in companion/), Chrome starts the
// companion itself through native messaging and hands this extension a key,
// so there's nothing to type. Without the setup, a companion started from a
// terminal can still be linked with its pairing code.

const HOST = 'com.ontask.companion';
const DEFAULT_PORT = 4517;
const PING_MS = 20_000; // traffic on the socket keeps the service worker alive

let ws = null;
let handlers = null;
let pingTimer = null;
let nativePort = null;
const pending = new Map(); // reqId -> resolve, for requests that expect a reply

async function setStatus(status, detail = '', hubState) {
  const { sync } = await chrome.storage.session.get('sync');
  const next = { status, detail, hub: hubState === undefined ? sync?.hub ?? null : hubState };
  if (status !== 'connected') next.hub = null;
  await chrome.storage.session.set({ sync: next });
}

export async function getSync() {
  const { sync } = await chrome.storage.session.get('sync');
  const { companion } = await chrome.storage.local.get('companion');
  return {
    ...(sync ?? { status: 'off', detail: '', hub: null }),
    paired: !!(companion?.token || companion?.code),
    native: !!companion?.native,
    computer: companion?.computer ?? null,
    pairUrl: companion?.pairUrl ?? null,
    code: companion?.code ?? null,
  };
}

export function initSync(h) {
  handlers = h;
  chrome.alarms.create('sync', { periodInMinutes: 0.5 }); // reconnect if anything dropped
  connect();
}

// Ask Chrome to start the companion. It answers with a 'ready' message
// carrying the key and port, then keeps running while this port is open.
function startNative() {
  if (nativePort || !chrome.runtime.connectNative) return;
  let port;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch {
    return;
  }
  nativePort = port;
  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== 'ready') return;
    const { token, port: wsPort, code, computer, pairUrl, appUrl } = msg;
    await chrome.storage.local.set({ companion: { native: true, token, port: wsPort, code, computer, pairUrl, appUrl } });
    closeSocket();
    connectSocket();
  });
  port.onDisconnect.addListener(async () => {
    const reason = chrome.runtime.lastError?.message ?? '';
    if (nativePort === port) nativePort = null;
    const { companion } = await chrome.storage.local.get('companion');
    if (/not found|forbidden/i.test(reason) && !companion?.code) {
      await setStatus('not-installed', 'Run the one-time setup to let Chrome start the companion.');
    }
  });
}

export async function connect() {
  startNative();
  await connectSocket();
}

async function connectSocket() {
  const { companion } = await chrome.storage.local.get('companion');
  const credential = companion?.token ?? companion?.code;
  if (!credential) return;
  if (ws && ws.readyState <= 1) return; // connecting or open

  const socket = new WebSocket(`ws://127.0.0.1:${companion.port || DEFAULT_PORT}`);
  ws = socket;
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'hello', token: credential, device: 'extension' }));
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
      if (msg.computer) {
        const { companion: c } = await chrome.storage.local.get('companion');
        await chrome.storage.local.set({ companion: { ...c, computer: msg.computer } });
      }
      await setStatus('connected', '', msg.state);
      handlers?.onState(msg.state, msg.type === 'welcome');
    } else if (msg.reqId && pending.has(msg.reqId)) { // a reply to request()
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
    if (current.status === 'error') return;
    await setStatus(nativePort ? 'starting' : 'disconnected', nativePort ? 'Starting the companion…' : 'Is the companion running?');
  };
  socket.onerror = () => {};
}

function closeSocket() {
  if (!ws) return;
  const old = ws;
  ws = null;
  old.close();
}

// Link to a companion started from a terminal, using its pairing code.
export async function pair(code, port) {
  const clean = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean) await chrome.storage.local.set({ companion: { code: clean, port: Number(port) || DEFAULT_PORT } });
  else await chrome.storage.local.remove('companion');
  closeSocket();
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
