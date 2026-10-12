// Connection to the OnTask companion on your computer, over your Wi-Fi. The
// computer is in charge: it sets the task and the timer, and this app follows
// along and reports when the phone gets picked up.

export interface HubState {
  session: { id: string; task: string; startedAt: number; source: 'extension' | 'phone'; timer: HubTimer | null } | null;
  devices: { extension: boolean; phone: boolean };
  phone: { away: boolean; since: number | null; checks: number };
  screen: { app: string; title: string; verdict: 'on' | 'off' | 'ambiguous'; activity: string; reason: string; at: number } | null;
  watcher: { status: string; detail: string };
}

// The extension's focus timer. endsAt is null during a Flowtime focus block.
export interface HubTimer {
  kind: string;
  phase: 'focus' | 'break';
  endsAt: number | null;
  phaseStartedAt: number | null;
  blocksDone: number;
  isLong: boolean;
}

export type SyncStatus = 'off' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface SyncHandlers {
  onStatus(status: SyncStatus, detail: string): void;
  onState(hub: HubState, isWelcome: boolean): void;
  onSessionEnded(msg: { id: string; by: string }): void;
}

const DEFAULT_PORT = 4517;
const RETRY_MS = 5000;
const PING_MS = 20_000;

let ws: WebSocket | null = null;
let target: { host: string; code: string } | null = null;
let handlers: SyncHandlers | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

export const cleanCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

function url(host: string) {
  const h = host.trim().replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
  return `ws://${h.includes(':') ? h : `${h}:${DEFAULT_PORT}`}`;
}

export function configure(next: { host: string; code: string } | null, h: SyncHandlers) {
  handlers = h;
  const clean = next && next.host.trim() && cleanCode(next.code) ? { host: next.host.trim(), code: cleanCode(next.code) } : null;
  if (JSON.stringify(clean) === JSON.stringify(target) && ws) return;
  target = clean;
  disconnect();
  if (target) connect();
  else handlers.onStatus('off', '');
}

export function connect() {
  if (!target || !handlers || (ws && ws.readyState <= 1)) return;
  if (retryTimer) clearTimeout(retryTimer);
  const h = handlers;
  const socket = new WebSocket(url(target.host));
  ws = socket;
  h.onStatus('connecting', '');
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'hello', token: target?.code, device: 'phone' }));
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ type: 'ping' }), PING_MS);
  };
  socket.onmessage = (event) => {
    let msg: { type: string; state?: HubState; message?: string; id?: string; by?: string };
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if ((msg.type === 'welcome' || msg.type === 'state') && msg.state) {
      h.onStatus('connected', '');
      h.onState(msg.state, msg.type === 'welcome');
    } else if (msg.type === 'session-ended' && msg.id) {
      h.onSessionEnded({ id: msg.id, by: msg.by ?? '' });
    } else if (msg.type === 'error') {
      h.onStatus('error', msg.message ?? 'Wrong pairing code');
      target = null; // don't keep retrying a bad code
    }
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    if (pingTimer) clearInterval(pingTimer);
    if (!target) return;
    h.onStatus('disconnected', 'Can’t reach your computer. Is the companion running, and are you on the same Wi-Fi?');
    retryTimer = setTimeout(connect, RETRY_MS);
  };
  socket.onerror = () => {};
}

export function disconnect() {
  if (retryTimer) clearTimeout(retryTimer);
  if (pingTimer) clearInterval(pingTimer);
  const old = ws;
  ws = null;
  old?.close();
}

export function send(msg: object) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
}
