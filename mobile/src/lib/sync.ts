// Connection to the OnTask companion on your computer, over your Wi-Fi. The
// computer is in charge: it sets the task and the timer, and this app follows
// along and reports when the phone gets picked up.
//
// Pairing happens once. After that the phone signs in with its own key and
// finds the computer by its Bonjour name (e.g. Aaryans-MacBook-Air.local),
// which survives the Wi-Fi handing out a new IP address, falling back to
// the last IP address it saw.

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

export interface ComputerInfo {
  name: string;
  host: string; // Bonjour name, e.g. Aaryans-MacBook-Air.local
  addresses: string[];
  port: number;
}

export type SyncStatus = 'off' | 'connecting' | 'connected' | 'disconnected' | 'error';

// Either a phone that's already paired (token) or one pairing now (code + name).
export type Target = { hosts: string[]; port: number } & ({ token: string } | { pair: { code: string; name: string } });

export interface SyncHandlers {
  onStatus(status: SyncStatus, detail: string): void;
  onState(hub: HubState, isWelcome: boolean): void;
  onSessionEnded(msg: { id: string; by: string }): void;
  onPaired(token: string, phone: { id: string; name: string }): void;
  onWelcome(computer: ComputerInfo, host: string): void;
  onForgotten(): void;
}

const RETRY_MS = 5000;
const PING_MS = 20_000;
const CONNECT_TIMEOUT_MS = 4000;

let ws: WebSocket | null = null;
let target: Target | null = null;
let handlers: SyncHandlers | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let hostIndex = 0;

export const cleanCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

function url(host: string, port: number) {
  const h = host.trim().replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
  return `ws://${h.includes(':') ? h : `${h}:${port}`}`;
}

export function configure(next: Target | null, h: SyncHandlers) {
  handlers = h;
  if (JSON.stringify(next) === JSON.stringify(target) && ws) return;
  target = next && next.hosts.some((x) => x.trim()) ? { ...next, hosts: next.hosts.filter((x) => x.trim()) } : null;
  hostIndex = 0;
  disconnect();
  if (target) connect();
  else handlers.onStatus('off', '');
}

export function connect() {
  if (!target || !handlers || (ws && ws.readyState <= 1)) return;
  if (retryTimer) clearTimeout(retryTimer);
  const h = handlers;
  const t = target;
  const host = t.hosts[hostIndex % t.hosts.length];
  const socket = new WebSocket(url(host, t.port));
  ws = socket;
  let welcomed = false;
  const giveUp = setTimeout(() => socket.readyState <= 1 && !welcomed && socket.close(), CONNECT_TIMEOUT_MS);
  h.onStatus('connecting', '');

  socket.onopen = () => {
    const hello = 'token' in t ? { token: t.token } : { pair: t.pair };
    socket.send(JSON.stringify({ type: 'hello', device: 'phone', ...hello }));
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ type: 'ping' }), PING_MS);
  };
  socket.onmessage = (event) => {
    let msg: {
      type: string;
      state?: HubState;
      message?: string;
      code?: string;
      id?: string;
      by?: string;
      token?: string;
      phone?: { id: string; name: string };
      computer?: ComputerInfo;
    };
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (msg.type === 'paired' && msg.token && msg.phone) {
      h.onPaired(msg.token, msg.phone);
    } else if ((msg.type === 'welcome' || msg.type === 'state') && msg.state) {
      if (msg.type === 'welcome') {
        welcomed = true;
        clearTimeout(giveUp);
        if (msg.computer) h.onWelcome(msg.computer, host);
      }
      h.onStatus('connected', '');
      h.onState(msg.state, msg.type === 'welcome');
    } else if (msg.type === 'session-ended' && msg.id) {
      h.onSessionEnded({ id: msg.id, by: msg.by ?? '' });
    } else if (msg.type === 'error') {
      target = null; // don't keep retrying a bad code or a removed phone
      if (msg.code === 'forgotten') h.onForgotten();
      else h.onStatus('error', msg.message ?? 'Wrong pairing code');
    }
  };
  socket.onclose = () => {
    clearTimeout(giveUp);
    if (ws !== socket) return;
    ws = null;
    if (pingTimer) clearInterval(pingTimer);
    if (!target) return;
    // Try the next way of reaching the computer: its name, then its last IP.
    hostIndex++;
    const triedAll = hostIndex % target.hosts.length === 0;
    if (triedAll) h.onStatus('disconnected', '');
    retryTimer = setTimeout(connect, triedAll ? RETRY_MS : 200);
  };
  socket.onerror = () => {};
}

// After pairing, sign in with the phone's own key on every later reconnect.
export function adoptToken(token: string) {
  if (target && 'pair' in target) target = { hosts: target.hosts, port: target.port, token };
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
