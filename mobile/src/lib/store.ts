// Phone app state. The computer is in charge: the Chrome extension sets the
// task and the timer, and the phone follows along once you join. The phone
// keeps your parked thoughts, chimes at breaks, and tells the computer when
// you pick it up mid-block.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as alerts from './alerts.ts';
import { fmtDur } from './format.ts';
import * as sync from './sync.ts';

export interface Settings {
  companionHost: string;
  companionCode: string;
  sound: boolean;
  vibration: boolean;
  keepAwake: boolean;
  lockTipSeen: boolean;
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
}

const DEFAULT_SETTINGS: Settings = { companionHost: '', companionCode: '', sound: true, vibration: true, keepAwake: true, lockTipSeen: false };
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
};
let appActive = AppState.currentState === 'active';
let notifiedId: string | null = null;
let lastPhase: string | null = null;
const listeners = new Set<() => void>();

function commit(patch: Partial<Data>) {
  data = { ...data, ...patch };
  listeners.forEach((l) => l());
  const { settings, joinedId, declinedId, thoughts, pickups, lastEnded } = data;
  AsyncStorage.setItem(KEY, JSON.stringify({ settings, joinedId, declinedId, thoughts, pickups, lastEnded })).catch(() => {});
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
    settings: { ...DEFAULT_SETTINGS, ...saved.settings },
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
};

function configureSync() {
  const { companionHost: host, companionCode: code } = data.settings;
  sync.configure(host && code ? { host, code } : null, syncHandlers);
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

export function updateSettings(patch: Partial<Settings>) {
  commit({ settings: { ...data.settings, ...patch } });
  if (patch.companionHost !== undefined || patch.companionCode !== undefined) configureSync();
}

// Leaving OnTask mid-block: tell the computer, and nudge you back.
export function onAppStateChange(status: AppStateStatus) {
  const now = Date.now();
  const s = joinedSession();
  if (status === 'background') {
    appActive = false;
    if (!s || s.timer?.phase === 'break') return;
    commit({ awaySince: now });
    sync.send({ type: 'phone-away' });
    const endsAt = s.timer?.endsAt ?? null;
    const left = endsAt ? endsAt - now : null;
    const reminders = [
      { id: LEAVE_IDS[0], at: now + GRACE_MS, title: 'Still on task?', body: `${s.task}${left && left > 0 ? ` · ${fmtDur(left)} left in this block` : ''}.` },
      { id: LEAVE_IDS[1], at: now + GRACE_MS + 3 * 60_000, title: 'You left OnTask', body: `${s.task} is waiting for you.` },
    ];
    for (const r of reminders) if (!endsAt || r.at < endsAt) notify(r.id, r.at, r.title, r.body);
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
