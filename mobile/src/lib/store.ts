// Phone app state. The computer is in charge: the Chrome extension sets the
// task and the timer, and the phone follows along once you join. The phone
// keeps your parked thoughts, chimes at breaks, and tells the computer when
// you pick it up mid-block.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as alerts from './alerts.ts';
import { fmtDur } from './format.ts';
import { appById, openApp, type OnTaskApp } from './ontaskApps.ts';
import * as sync from './sync.ts';

// The computer this phone is paired with. Saved once at pairing, then kept
// up to date (its IP address can change) every time they connect.
export interface PairedComputer {
  name: string; // e.g. Aaryan's MacBook Air
  host: string; // Bonjour name, stays the same when the IP address changes
  ip: string; // last address seen, the fallback
  port: number;
  token: string; // this phone's key
  phoneName: string;
}

export interface PairingLink {
  host: string;
  ip: string;
  port: number;
  code: string;
  computerName: string;
}

export interface Settings {
  computer: PairedComputer | null;
  sound: boolean;
  vibration: boolean;
  keepAwake: boolean;
  lockTipSeen: boolean;
  ontaskApps: string[]; // ids from ONTASK_APPS you allow yourself during a session
}

export interface Thought {
  at: number;
  text: string;
  done: boolean;
}

interface Data {
  loaded: boolean;
  settings: Settings;
  remote: { status: sync.SyncStatus; detail: string; hub: sync.HubState | null };
  joinedId: string | null; // the computer's session this phone is following
  declinedId: string | null; // "Not now" for this session
  thoughts: Thought[];
  pickups: number;
  awaySince: number | null;
  lastEnded: { task: string; thoughts: Thought[]; pickups: number } | null;
  pairing: (PairingLink & { phoneName: string }) | null; // pairing in progress
  notice: string | null; // e.g. "unpaired on your computer"
  active: boolean; // switched on in Chrome's Devices tab
  lastOnTaskApp: string | null; // the OnTask App you were last sent to
}

const DEFAULT_SETTINGS: Settings = { computer: null, sound: true, vibration: true, keepAwake: true, lockTipSeen: false, ontaskApps: [] };
const KEY = 'ontask.phone';
const GRACE_MS = 15_000; // shorter trips away are a glance, not a pickup
const LEAVE_IDS = ['leave-1', 'leave-2'];

let data: Data = {
  loaded: false,
  settings: DEFAULT_SETTINGS,
  remote: { status: 'off', detail: '', hub: null },
  joinedId: null,
  declinedId: null,
  thoughts: [],
  pickups: 0,
  awaySince: null,
  lastEnded: null,
  pairing: null,
  notice: null,
  active: true,
  lastOnTaskApp: null,
};
// Set just before OnTask opens one of your OnTask Apps, so leaving for it
// isn't treated as picking up the phone.
let openingOnTaskAppAt = 0;
let appActive = AppState.currentState === 'active';
let notifiedId: string | null = null;
let lastPhase: string | null = null;
const listeners = new Set<() => void>();

function commit(patch: Partial<Data>) {
  data = { ...data, ...patch };
  listeners.forEach((l) => l());
  const { settings, joinedId, declinedId, thoughts, pickups, lastEnded, lastOnTaskApp } = data;
  AsyncStorage.setItem(KEY, JSON.stringify({ settings, joinedId, declinedId, thoughts, pickups, lastEnded, lastOnTaskApp })).catch(() => {});
}

export function useData(): Data {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => data,
    () => data,
  );
}

export async function load() {
  let saved: Partial<Omit<Data, 'settings'>> & { settings?: Partial<Settings> } = {};
  try {
    saved = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}');
  } catch {
    // start fresh
  }
  data = {
    ...data,
    ...saved,
    loaded: true,
    // Older versions saved an address and code instead of a pairing; those
    // fields are dropped and the phone pairs once more.
    settings: { ...DEFAULT_SETTINGS, ...saved.settings },
    pairing: null,
    notice: null,
    remote: { status: 'off', detail: '', hub: null },
    awaySince: null,
  };
  listeners.forEach((l) => l());
  await alerts.setupAlerts();
  configureSync();
}

const currentSession = () => data.remote.hub?.session ?? null;
export function joinedSession() {
  const s = currentSession();
  return s && s.id === data.joinedId ? s : null;
}

function alertUser() {
  if (data.settings.sound) alerts.chime();
  if (data.settings.vibration) alerts.buzz();
}

const notify = (id: string, at: number, title: string, body: string) => alerts.scheduleAt(id, at, title, body, data.settings.sound);

// Notifications for the end of the current phase, so the phone chimes at
// break time even when OnTask is in the background.
function syncPhaseAlert() {
  const s = joinedSession();
  const t = s?.timer;
  if (!s || !t || t.endsAt === null) {
    alerts.cancel('phase');
    return;
  }
  if (t.phase === 'focus') notify('phase', t.endsAt, 'Break time', 'Block done. TikTok, YouTube, Instagram and X are a tap away in OnTask.');
  else notify('phase', t.endsAt, 'Break’s over', `Back to ${s.task}.`);
}

const phaseKey = (t: sync.HubTimer | null | undefined) => (t ? `${t.phase}:${t.blocksDone}` : null);

// --- link to the computer ---------------------------------------------------

const syncHandlers: sync.SyncHandlers = {
  onStatus(status, detail) {
    commit({ remote: { status, detail, hub: status === 'connected' ? data.remote.hub : null } });
  },
  onState(hub) {
    commit({ remote: { status: 'connected', detail: '', hub } });
    const s = hub.session;
    if (!s) {
      if (data.joinedId) finish();
      return;
    }
    if (s.id === data.joinedId) {
      // Chime when the computer's timer moves between focus and break.
      const phase = phaseKey(s.timer);
      if (lastPhase && phase && phase !== lastPhase && appActive) alertUser();
      lastPhase = phase;
      syncPhaseAlert();
      return;
    }
    // A new session on the computer. In the app, the screen offers to join;
    // in the background, a notification does.
    if (s.id !== data.declinedId && s.id !== notifiedId) {
      notifiedId = s.id;
      if (!appActive) alerts.notifyNow('You started OnTask on your computer', `“${s.task}”. Open OnTask to follow along on your phone.`, data.settings.sound);
    }
  },
  onSessionEnded({ id }) {
    if (id === data.joinedId) finish();
  },
  onPaired(token, phone) {
    const p = data.pairing;
    if (!p) return;
    const computer: PairedComputer = { name: p.computerName, host: p.host, ip: p.ip, port: p.port, token, phoneName: phone.name };
    sync.adoptToken(token); // reconnect as this phone from now on, not with the code
    commit({ settings: { ...data.settings, computer }, pairing: null, notice: null });
  },
  onWelcome(computer) {
    const c = data.settings.computer;
    if (!c) return;
    const ip = computer.addresses[0] ?? c.ip;
    if (c.name === computer.name && c.host === computer.host && c.ip === ip && c.port === computer.port) return;
    commit({ settings: { ...data.settings, computer: { ...c, name: computer.name, host: computer.host || c.host, ip, port: computer.port } } });
  },
  onYou(you) {
    const c = data.settings.computer;
    const settings = c && c.phoneName !== you.name ? { ...data.settings, computer: { ...c, phoneName: you.name } } : data.settings;
    // Switched off in Chrome: stop following any session.
    commit({ settings, active: you.active, ...(you.active ? {} : { joinedId: null }) });
    if (!you.active) alerts.cancel('phase', ...LEAVE_IDS);
  },
  onForgotten() {
    commit({ settings: { ...data.settings, computer: null }, joinedId: null, notice: 'This phone was unpaired on your computer. Pair it again to reconnect.' });
    syncHandlers.onStatus('off', '');
  },
};

function configureSync() {
  const c = data.settings.computer;
  const p = data.pairing;
  if (c) sync.configure({ hosts: [c.host, c.ip], port: c.port, token: c.token }, syncHandlers);
  else if (p) sync.configure({ hosts: [p.ip, p.host], port: p.port, pair: { code: p.code, name: p.phoneName } }, syncHandlers);
  else sync.configure(null, syncHandlers);
}

// Read a pairing link from the QR code shown in Chrome. It works whether it
// was scanned by the phone's camera (an Expo Go link) or inside the app.
export function parsePairingLink(params: Record<string, string | string[] | undefined>): PairingLink | null {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
  };
  const link = { host: one('h'), ip: one('i'), port: Number(one('p')) || 4517, code: sync.cleanCode(one('c')), computerName: one('n') || 'your computer' };
  return (link.host || link.ip) && link.code ? link : null;
}

export function pairingLinkFromUrl(raw: string): PairingLink | null {
  const query = raw.split('?')[1];
  if (!query) return null;
  return parsePairingLink(Object.fromEntries(new URLSearchParams(query)));
}

export function pairWith(link: PairingLink, phoneName: string) {
  // Pairing with a new computer replaces the old one.
  commit({ settings: { ...data.settings, computer: null }, joinedId: null, pairing: { ...link, phoneName: phoneName.trim() || 'My phone' }, notice: null });
  configureSync();
}

// Scanning the QR code again from the same computer (to reopen the app after
// its address changed) shouldn't pair a second time: just note the address.
export function isSameComputer(link: PairingLink) {
  const c = data.settings.computer;
  return !!c && !!link.host && c.host === link.host;
}

export function refreshAddress(link: PairingLink) {
  const c = data.settings.computer;
  if (!c) return;
  commit({ settings: { ...data.settings, computer: { ...c, ip: link.ip || c.ip, port: link.port } } });
  configureSync();
}

export function cancelPairing() {
  commit({ pairing: null });
  configureSync();
}

// Unpair this phone. The computer forgets its key too.
export function unpair() {
  sync.send({ type: 'forget' });
  commit({ settings: { ...data.settings, computer: null }, joinedId: null, pairing: null });
  setTimeout(configureSync, 300); // let the forget message go out first
}

// --- actions ----------------------------------------------------------------

export function join() {
  const s = currentSession();
  if (!s) return;
  lastPhase = phaseKey(s.timer);
  commit({ joinedId: s.id, declinedId: null, thoughts: [], pickups: 0, lastEnded: null });
  syncPhaseAlert();
  alerts.ensureNotificationPermission();
}

export function decline() {
  commit({ declinedId: currentSession()?.id ?? null });
}

// Stop following on this phone. The session keeps running on the computer.
export function leave() {
  const s = currentSession();
  commit({ joinedId: null, declinedId: s?.id ?? null, lastEnded: s ? { task: s.task, thoughts: data.thoughts, pickups: data.pickups } : null });
  alerts.cancel('phase', ...LEAVE_IDS);
}

function finish() {
  commit({ joinedId: null, lastEnded: { task: currentSession()?.task ?? data.lastEnded?.task ?? 'Your session', thoughts: data.thoughts, pickups: data.pickups }, awaySince: null });
  alerts.cancel('phase', ...LEAVE_IDS);
  lastPhase = null;
}

export const dismissSummary = () => commit({ lastEnded: null });
export const parkThought = (text: string) => commit({ thoughts: [...data.thoughts, { at: Date.now(), text, done: false }] });
export const toggleThought = (i: number) => commit({ thoughts: data.thoughts.map((t, j) => (j === i ? { ...t, done: !t.done } : t)) });

// Open one of your OnTask Apps. Leaving OnTask for it is fine.
export async function openOnTaskApp(app: OnTaskApp): Promise<boolean> {
  openingOnTaskAppAt = Date.now();
  const ok = await openApp(app);
  if (ok) commit({ lastOnTaskApp: app.id });
  else openingOnTaskAppAt = 0;
  return ok;
}

// From a reminder: back to the OnTask App you were using, if any.
export function backOnTask() {
  const app = appById(data.lastOnTaskApp);
  if (app && joinedSession()) setTimeout(() => openOnTaskApp(app), 300);
}

export function updateSettings(patch: Partial<Omit<Settings, 'computer'>>) {
  commit({ settings: { ...data.settings, ...patch } });
}

// Leaving OnTask mid-block: tell the computer, and nudge you back.
export function onAppStateChange(status: AppStateStatus) {
  const now = Date.now();
  const s = joinedSession();
  if (status === 'background') {
    appActive = false;
    if (!s || s.timer?.phase === 'break') return;
    // Going to one of your OnTask Apps from OnTask isn't leaving the task.
    if (now - openingOnTaskAppAt < 5000) return;
    commit({ awaySince: now });
    sync.send({ type: 'phone-away' });
    const endsAt = s.timer?.endsAt ?? null;
    const left = endsAt ? endsAt - now : null;
    const back = appById(data.lastOnTaskApp);
    const reminders = [
      {
        id: LEAVE_IDS[0],
        at: now + GRACE_MS,
        title: back ? `Back to ${back.name}?` : 'Still on task?',
        body: `${s.task}${left && left > 0 ? ` · ${fmtDur(left)} left in this block` : ''}.${back ? ` Tap to go back to ${back.name}.` : ''}`,
      },
      { id: LEAVE_IDS[1], at: now + GRACE_MS + 3 * 60_000, title: 'You left OnTask', body: `${s.task} is waiting for you.${back ? ` Tap to go back to ${back.name}.` : ''}` },
    ];
    for (const r of reminders) if (!endsAt || r.at < endsAt) alerts.scheduleAt(r.id, r.at, r.title, r.body, data.settings.sound, true);
  } else if (status === 'active') {
    appActive = true;
    alerts.cancel(...LEAVE_IDS);
    sync.connect(); // the socket may have dropped while in the background
    if (data.awaySince !== null) {
      const away = now - data.awaySince;
      sync.send({ type: 'phone-back' });
      if (away >= GRACE_MS) sync.send({ type: 'phone-check' });
      commit({ pickups: data.pickups + (away >= GRACE_MS ? 1 : 0), awaySince: null });
    }
  }
}
