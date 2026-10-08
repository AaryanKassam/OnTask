// The focus session as plain data plus pure functions over it. Everything is
// computed from timestamps, never from a running counter, so the session stays
// correct while the app is backgrounded or killed and reopened.

import type { Method, MethodId } from './methods.ts';

export const MIN = 60_000;

export type Phase = 'focus' | 'break' | 'ready';

// A stretch of time away from OnTask during a focus block.
export interface Leave {
  at: number;
  ms: number;
  intoBlockMs: number; // how far into the block it started
}

export interface Session {
  id: string;
  task: string;
  firstStep: string;
  ifThen: string;
  method: Method;
  lockMin: number; // 0 = no commitment lock
  checkInEveryMin: number; // 0 = no check-ins
  startedAt: number;
  endedAt: number | null;
  endedEarly: boolean;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number | null; // null for open-ended Flowtime focus and for 'ready'
  pausedAt: number | null;
  breakIsLong: boolean;
  blocksDone: number;
  focusMs: number; // completed focus time, pauses excluded
  awayMs: number; // confirmed time on the phone during focus
  away: { since: number; intoBlockMs: number; until: number | null } | null;
  pendingLeave: Leave | null; // waiting for "were you on your phone?"
  leaves: Leave[];
  checkIns: { at: number; onTask: boolean }[];
  nextCheckInAt: number | null;
  thoughts: { at: number; text: string; done: boolean }[];
  resumeNote: string;
}

// What gets kept in history once a session ends.
export interface SessionRecord {
  id: string;
  task: string;
  methodId: MethodId;
  methodName: string;
  startedAt: number;
  endedAt: number;
  focusMs: number;
  blocksDone: number;
  awayMs: number;
  leaves: Leave[];
  checkInsOnTask: number;
  checkInsOffTask: number;
  openThoughts: string[];
  endedEarly: boolean;
  lockMin: number;
}

export interface SessionInput {
  task: string;
  firstStep: string;
  ifThen: string;
  method: Method;
  lockMin: number;
  checkInEveryMin: number;
}

type Rng = () => number;

// Random spacing (half to one-and-a-half times the average) so check-ins
// can't be anticipated, the way self-monitoring tones are used in classrooms.
export function nextCheckIn(now: number, everyMin: number, rng: Rng = Math.random): number | null {
  return everyMin > 0 ? now + everyMin * MIN * (0.5 + rng()) : null;
}

export function createSession(input: SessionInput, now: number, rng: Rng = Math.random): Session {
  return {
    id: `${now.toString(36)}${Math.floor(rng() * 1e6).toString(36)}`,
    task: input.task,
    firstStep: input.firstStep,
    ifThen: input.ifThen,
    method: input.method,
    lockMin: input.lockMin,
    checkInEveryMin: input.checkInEveryMin,
    startedAt: now,
    endedAt: null,
    endedEarly: false,
    phase: 'focus',
    phaseStartedAt: now,
    phaseEndsAt: input.method.flow ? null : now + input.method.focusMin * MIN,
    pausedAt: null,
    breakIsLong: false,
    blocksDone: 0,
    focusMs: 0,
    awayMs: 0,
    away: null,
    pendingLeave: null,
    leaves: [],
    checkIns: [],
    nextCheckInAt: nextCheckIn(now, input.checkInEveryMin, rng),
    thoughts: [],
    resumeNote: '',
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function flowBreakMs(blockMs: number): number {
  return clamp(Math.round(blockMs / 5 / MIN), 2, 20) * MIN;
}

export function currentBlockMs(s: Session, now: number): number {
  return s.phase === 'focus' ? Math.max(0, (s.pausedAt ?? now) - s.phaseStartedAt) : 0;
}

export function totalFocusMs(s: Session, now: number): number {
  return s.focusMs + currentBlockMs(s, now);
}

// Focus that counts toward the commitment lock: phone time doesn't.
export function earnedMs(s: Session, now: number): number {
  return Math.max(0, totalFocusMs(s, now) - s.awayMs);
}

export function lockRemainingMs(s: Session, now: number): number {
  return s.lockMin > 0 ? Math.max(0, s.lockMin * MIN - earnedMs(s, now)) : 0;
}

export function remainingMs(s: Session, now: number): number | null {
  return s.phaseEndsAt === null ? null : Math.max(0, s.phaseEndsAt - (s.pausedAt ?? now));
}

export function phaseLengthMs(s: Session): number | null {
  return s.phaseEndsAt === null ? null : s.phaseEndsAt - s.phaseStartedAt;
}

function beginBreak(s: Session, at: number): Session {
  const blockMs = Math.max(0, at - s.phaseStartedAt);
  const blocksDone = s.blocksDone + 1;
  const m = s.method;
  const isLong = !m.flow && m.longEvery > 0 && blocksDone % m.longEvery === 0;
  const breakMs = m.flow ? flowBreakMs(blockMs) : (isLong ? m.longBreakMin : m.breakMin) * MIN;
  return {
    ...s,
    focusMs: s.focusMs + blockMs,
    blocksDone,
    phase: 'break',
    breakIsLong: isLong,
    phaseStartedAt: at,
    phaseEndsAt: at + breakMs,
    pausedAt: null,
    nextCheckInAt: null,
    away: s.away && s.away.until === null ? { ...s.away, until: at } : s.away,
  };
}

export type PhaseEvent = { kind: 'break' | 'ready'; at: number };

// Move through any phase boundaries that have passed. A finished break waits
// in 'ready' for the user rather than starting the next block on its own.
export function advance(s: Session, now: number): { session: Session; events: PhaseEvent[] } {
  const events: PhaseEvent[] = [];
  let cur = s;
  while (!cur.pausedAt && cur.phaseEndsAt !== null && now >= cur.phaseEndsAt) {
    const at = cur.phaseEndsAt;
    if (cur.phase === 'focus') {
      cur = beginBreak(cur, at);
      events.push({ kind: 'break', at });
    } else if (cur.phase === 'break') {
      cur = { ...cur, phase: 'ready', phaseStartedAt: at, phaseEndsAt: null };
      events.push({ kind: 'ready', at });
    } else break;
  }
  return { session: cur, events };
}

export function takeFlowBreak(s: Session, now: number): Session {
  return s.phase === 'focus' && !s.pausedAt ? beginBreak(s, now) : s;
}

export function startFocus(s: Session, now: number, rng: Rng = Math.random): Session {
  if (s.phase === 'focus') return s;
  return {
    ...s,
    phase: 'focus',
    phaseStartedAt: now,
    phaseEndsAt: s.method.flow ? null : now + s.method.focusMin * MIN,
    pausedAt: null,
    nextCheckInAt: nextCheckIn(now, s.checkInEveryMin, rng),
  };
}

export function pause(s: Session, now: number): Session {
  return s.pausedAt || s.phase === 'ready' ? s : { ...s, pausedAt: now };
}

export function resume(s: Session, now: number): Session {
  if (!s.pausedAt) return s;
  const shift = now - s.pausedAt;
  return {
    ...s,
    pausedAt: null,
    phaseStartedAt: s.phaseStartedAt + shift,
    phaseEndsAt: s.phaseEndsAt === null ? null : s.phaseEndsAt + shift,
    nextCheckInAt: s.nextCheckInAt === null ? null : s.nextCheckInAt + shift,
  };
}

// Leaving the app only matters during an unpaused focus block.
export function leaveApp(s: Session, now: number): Session {
  if (s.phase !== 'focus' || s.pausedAt || s.away) return s;
  return { ...s, away: { since: now, intoBlockMs: now - s.phaseStartedAt, until: null } };
}

// Short trips away are noise: anything under the grace period is ignored. A
// longer one is held until the user says whether they were on their phone,
// because a locked phone and an open Instagram look the same from here.
export function returnToApp(s: Session, now: number, graceMs: number): Session {
  if (!s.away) return s;
  const ms = (s.away.until ?? now) - s.away.since;
  const next = { ...s, away: null };
  if (ms < graceMs) return next;
  return { ...next, pendingLeave: { at: s.away.since, ms, intoBlockMs: s.away.intoBlockMs } };
}

export function answerLeave(s: Session, onPhone: boolean): Session {
  if (!s.pendingLeave) return s;
  if (!onPhone) return { ...s, pendingLeave: null };
  return { ...s, pendingLeave: null, leaves: [...s.leaves, s.pendingLeave], awayMs: s.awayMs + s.pendingLeave.ms };
}

export function checkInDue(s: Session, now: number): boolean {
  return s.phase === 'focus' && !s.pausedAt && s.nextCheckInAt !== null && now >= s.nextCheckInAt;
}

export function answerCheckIn(s: Session, now: number, onTask: boolean | null, rng: Rng = Math.random): Session {
  const checkIns = onTask === null ? s.checkIns : [...s.checkIns, { at: now, onTask }];
  return { ...s, checkIns, nextCheckInAt: nextCheckIn(now, s.checkInEveryMin, rng) };
}

export function parkThought(s: Session, text: string, now: number): Session {
  return { ...s, thoughts: [...s.thoughts, { at: now, text, done: false }] };
}

export function toggleThought(s: Session, index: number): Session {
  return { ...s, thoughts: s.thoughts.map((t, i) => (i === index ? { ...t, done: !t.done } : t)) };
}

export function endSession(s: Session, now: number, early: boolean): Session {
  const focusMs = s.focusMs + currentBlockMs(s, now);
  const away = s.away && s.away.until === null ? { ...s.away, until: now } : s.away;
  return { ...s, focusMs, away, endedAt: now, endedEarly: early, phaseEndsAt: null, pausedAt: null };
}

export function toRecord(s: Session): SessionRecord {
  return {
    id: s.id,
    task: s.task,
    methodId: s.method.id,
    methodName: s.method.name,
    startedAt: s.startedAt,
    endedAt: s.endedAt ?? s.startedAt,
    focusMs: s.focusMs,
    blocksDone: s.blocksDone,
    awayMs: s.awayMs,
    leaves: s.leaves,
    checkInsOnTask: s.checkIns.filter((c) => c.onTask).length,
    checkInsOffTask: s.checkIns.filter((c) => !c.onTask).length,
    openThoughts: s.thoughts.filter((t) => !t.done).map((t) => t.text),
    endedEarly: s.endedEarly,
    lockMin: s.lockMin,
  };
}
