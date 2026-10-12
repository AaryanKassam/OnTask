// App state: settings, the running session and history, persisted to
// AsyncStorage. Screens read it with useData(); everything that changes it
// goes through the actions below, which also keep notifications in sync.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as alerts from './alerts.ts';
import { fmtDur } from './format.ts';
import { resolveMethod, type MethodId } from './methods.ts';
import * as S from './session.ts';
import * as sync from './sync.ts';

export interface Settings {
  methodId: MethodId;
  customFocusMin: number;
  customBreakMin: number;
  lockMin: number;
  leaveGraceSec: number;
  leaveReminders: boolean;
  checkInEveryMin: number;
  sound: boolean;
  vibration: boolean;
  keepAwake: boolean;
  overrideWaitSec: number;
  companionHost: string;
  companionCode: string;
}

export const DEFAULT_SETTINGS: Settings = {
  methodId: 'pomodoro',
  customFocusMin: 30,
  customBreakMin: 5,
  lockMin: 0,
  leaveGraceSec: 15,
  leaveReminders: true,
  checkInEveryMin: 0,
  sound: true,
  vibration: true,
  keepAwake: true,
  overrideWaitSec: 20,
  companionHost: '',
  companionCode: '',
};

interface Data {
  loaded: boolean;
  settings: Settings;
  session: S.Session | null;
  history: S.SessionRecord[];
  lastSummary: S.SessionRecord | null;
  checkInOpenSince: number | null;
  remote: { status: sync.SyncStatus; detail: string; hub: sync.HubState | null };
}

const KEYS = { settings: 'ontask.settings', session: 'ontask.session', history: 'ontask.history' } as const;
const LEAVE_IDS = ['leave-1', 'leave-2', 'leave-3'];
const HISTORY_LIMIT = 300;
const CHECK_IN_TIMEOUT_MS = 90_000;

let data: Data = {
  loaded: false,
  settings: DEFAULT_SETTINGS,
  session: null,
  history: [],
  lastSummary: null,
  checkInOpenSince: null,
  remote: { status: 'off', detail: '', hub: null },
};
let appActive = AppState.currentState === 'active';
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function commit(patch: Partial<Data>) {
  data = { ...data, ...patch };
  emit();
  if ('settings' in patch) AsyncStorage.setItem(KEYS.settings, JSON.stringify(data.settings)).catch(() => {});
  if ('history' in patch) AsyncStorage.setItem(KEYS.history, JSON.stringify(data.history)).catch(() => {});
  if ('session' in patch) {
    if (data.session) AsyncStorage.setItem(KEYS.session, JSON.stringify(data.session)).catch(() => {});
    else AsyncStorage.removeItem(KEYS.session).catch(() => {});
  }
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

function parse<T>(raw: string | null): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function load() {
  const [settings, session, history] = await Promise.all([
    AsyncStorage.getItem(KEYS.settings),
    AsyncStorage.getItem(KEYS.session),
    AsyncStorage.getItem(KEYS.history),
  ]);
  data = {
    ...data,
    loaded: true,
    settings: { ...DEFAULT_SETTINGS, ...parse<Partial<Settings>>(settings) },
    session: parse<S.Session>(session),
    history: parse<S.SessionRecord[]>(history) ?? [],
  };
  emit();
  await alerts.setupAlerts();
  if (data.session) onAppStateChange('active');
  configureSync();
}

// --- link to the computer ---------------------------------------------------

let lastHubSessionId: string | null = null;

const syncHandlers: sync.SyncHandlers = {
  onStatus(status, detail) {
    commit({ remote: { status, detail, hub: status === 'connected' ? data.remote.hub : null } });
  },
  onState(hub, isWelcome) {
    commit({ remote: { status: 'connected', detail: '', hub } });
    const s = data.session;
    const remote = hub.session;
    // The computer switched tasks in a session we share: follow it.
    if (s && remote && remote.source !== 'phone' && s.syncId === lastHubSessionId && remote.id !== s.syncId) {
      setSession({ ...s, task: remote.task, syncId: remote.id });
    }
    // The companion restarted and lost our session: tell it again.
    if (isWelcome && !remote && s?.syncId) {
      sync.send({ type: 'session-start', session: { id: s.syncId, task: s.task, startedAt: s.startedAt } });
    }
    lastHubSessionId = remote?.id ?? null;
  },
  onSessionEnded({ id, by }) {
    if (by !== 'phone' && data.session?.syncId === id) endSession(false, true);
  },
};

function configureSync() {
  const { companionHost: host, companionCode: code } = data.settings;
  sync.configure(host && code ? { host, code } : null, syncHandlers);
}

// --- side effects -----------------------------------------------------------

const notify = (id: string, at: number, title: string, body: string) => alerts.scheduleAt(id, at, title, body, data.settings.sound);

function alertUser() {
  if (data.settings.sound) alerts.chime();
  if (data.settings.vibration) alerts.buzz();
}

// The notification that marks the end of the current phase, for when the app
// isn't in front. Re-synced on every session change.
function syncPhaseAlert(s: S.Session | null) {
  if (!s || s.pausedAt || s.phaseEndsAt === null) {
    alerts.cancel('phase');
    return;
  }
  if (s.phase === 'focus') {
    notify('phase', s.phaseEndsAt, 'Break time', `Block ${s.blocksDone + 1} done. Step away for a few minutes.`);
  } else if (s.phase === 'break') {
    const next = s.resumeNote ? ` Next: ${s.resumeNote}` : '';
    notify('phase', s.phaseEndsAt, 'Break’s over', `Back to ${s.task}.${next}`);
  }
}

function setSession(session: S.Session | null) {
  commit({ session });
  syncPhaseAlert(session);
}

// The soft lock: leaving OnTask mid-block schedules escalating reminders,
// cancelled the moment you come back. None fire past the end of the block.
function scheduleLeaveReminders(s: S.Session, now: number) {
  if (!data.settings.leaveReminders) return;
  const grace = data.settings.leaveGraceSec * 1000;
  const left = S.remainingMs(s, now);
  const lock = S.lockRemainingMs(s, now);
  const plan = s.ifThen ? ` Your plan: ${s.ifThen}` : '';
  const reminders = [
    { id: LEAVE_IDS[0], at: now + grace, title: 'Still on task?', body: `${s.task}${left !== null ? ` · ${fmtDur(left)} left in this block` : ''}.${plan}` },
    { id: LEAVE_IDS[1], at: now + grace + 3 * S.MIN, title: 'You left OnTask', body: lock ? `Breaks unlock after ${fmtDur(lock)} more focus.` : `${s.task} is waiting for you.` },
    { id: LEAVE_IDS[2], at: now + grace + 10 * S.MIN, title: 'Come back to your block', body: `You’ve been away 10 minutes from ${s.task}.` },
  ];
  for (const r of reminders) {
    if (s.phaseEndsAt === null || r.at < s.phaseEndsAt) notify(r.id, r.at, r.title, r.body);
  }
}

// --- actions ----------------------------------------------------------------

export function tick(now = Date.now()) {
  const s = data.session;
  if (!s) return;
  const { session, events } = S.advance(s, now);
  let next = session;
  if (events.length && appActive && events.some((e) => now - e.at < 5000)) alertUser();
  if (events.length && data.checkInOpenSince !== null) commit({ checkInOpenSince: null });

  if (data.checkInOpenSince !== null && now - data.checkInOpenSince > CHECK_IN_TIMEOUT_MS) {
    next = S.answerCheckIn(next, now, null);
    commit({ checkInOpenSince: null });
  } else if (data.checkInOpenSince === null && S.checkInDue(next, now)) {
    if (appActive) {
      commit({ checkInOpenSince: now });
      alertUser();
    } else {
      next = S.answerCheckIn(next, now, null); // never nag about check-ins from the background
    }
  }
  if (next !== s) setSession(next);
}

export function onAppStateChange(status: AppStateStatus) {
  const now = Date.now();
  const s = data.session;
  if (status === 'background') {
    appActive = false;
    if (!s) return;
    const next = S.leaveApp(s, now);
    if (next !== s) {
      setSession(next);
      scheduleLeaveReminders(next, now);
      sync.send({ type: 'phone-away' });
    }
  } else if (status === 'active') {
    appActive = true;
    alerts.cancel(...LEAVE_IDS);
    sync.connect(); // the socket may have been dropped while in the background
    if (s?.away) sync.send({ type: 'phone-back' });
    if (!s) return;
    // Catch up on phases that ended while away (their notifications already
    // went off), then settle the time away against the grace period.
    const back = S.returnToApp(S.advance(s, now).session, now, data.settings.leaveGraceSec * 1000);
    setSession(back);
  }
  // 'inactive' (Control Centre, an incoming call banner) is ignored.
}

export function startSession(input: { task: string; firstStep: string; ifThen: string; methodId: MethodId; lockMin: number; syncId?: string }) {
  const st = data.settings;
  const method = resolveMethod(input.methodId, { focusMin: st.customFocusMin, breakMin: st.customBreakMin });
  const created = S.createSession({ ...input, method, checkInEveryMin: st.checkInEveryMin }, Date.now());
  // Joining the computer's session keeps its id; otherwise announce a new one.
  const session = { ...created, syncId: input.syncId ?? created.id };
  if (!input.syncId) sync.send({ type: 'session-start', session: { id: session.syncId, task: session.task, startedAt: session.startedAt } });
  commit({ settings: { ...st, methodId: input.methodId, lockMin: input.lockMin }, lastSummary: null, checkInOpenSince: null });
  setSession(session);
  alerts.ensureNotificationPermission();
}

function update(fn: (s: S.Session, now: number) => S.Session) {
  if (data.session) setSession(fn(data.session, Date.now()));
}

export const pause = () => update(S.pause);
export const resume = () => update(S.resume);
export const startNextBlock = () => update((s, now) => S.startFocus(s, now));
export const takeFlowBreak = () => update(S.takeFlowBreak);
export const parkThought = (text: string) => update((s, now) => S.parkThought(s, text, now));
export const toggleThought = (i: number) => update((s) => S.toggleThought(s, i));
export const setResumeNote = (text: string) => update((s) => ({ ...s, resumeNote: text }));
export function answerLeave(onPhone: boolean) {
  if (onPhone && data.session?.pendingLeave) sync.send({ type: 'phone-check' });
  update((s) => S.answerLeave(s, onPhone));
}

export function answerCheckIn(onTask: boolean) {
  commit({ checkInOpenSince: null });
  update((s, now) => S.answerCheckIn(s, now, onTask));
}

// The override code's other use: unlock break apps early without ending.
export const liftLock = () => update((s) => ({ ...s, lockMin: 0 }));

export function isLocked(now = Date.now()): boolean {
  return !!data.session && S.lockRemainingMs(data.session, now) > 0;
}

export function endSession(early: boolean, fromRemote = false) {
  const s = data.session;
  if (!s) return;
  if (s.syncId && !fromRemote) sync.send({ type: 'session-end', id: s.syncId });
  const record = S.toRecord(S.endSession(s, Date.now(), early));
  const history = record.focusMs >= S.MIN ? [record, ...data.history].slice(0, HISTORY_LIMIT) : data.history;
  commit({ history, lastSummary: record, checkInOpenSince: null });
  setSession(null);
  alerts.cancel(...LEAVE_IDS);
}

export const dismissSummary = () => commit({ lastSummary: null });

export function updateSettings(patch: Partial<Settings>) {
  commit({ settings: { ...data.settings, ...patch } });
  if (patch.companionHost !== undefined || patch.companionCode !== undefined) configureSync();
  const s = data.session;
  if (s && patch.checkInEveryMin !== undefined) {
    setSession({ ...s, checkInEveryMin: patch.checkInEveryMin, nextCheckInAt: S.nextCheckIn(Date.now(), patch.checkInEveryMin) });
  }
}

export const clearHistory = () => commit({ history: [], lastSummary: null });
