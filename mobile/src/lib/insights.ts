// Turns session history into a few numbers and at most three suggestions.
// All rules are plain thresholds so each suggestion can say exactly why.

import { MIN, type SessionRecord } from './session.ts';
import type { MethodId } from './methods.ts';

const DAY = 24 * 60 * MIN;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function weekBars(history: SessionRecord[], now: number): { label: string; minutes: number; today: boolean }[] {
  const today = startOfDay(now);
  return Array.from({ length: 7 }, (_, i) => {
    const day = today - (6 - i) * DAY;
    const ms = history.filter((r) => r.startedAt >= day && r.startedAt < day + DAY).reduce((sum, r) => sum + r.focusMs, 0);
    return { label: WEEKDAYS[new Date(day).getDay()], minutes: Math.round(ms / MIN), today: i === 6 };
  });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface Summary {
  sessions: number;
  focusMs: number;
  phoneChecks: number;
  checksPerHour: number | null;
  minutesToFirstCheck: number | null; // median time into a block before a phone check
  onTaskRate: number | null; // share of check-ins answered "yes"
  checkInsAnswered: number;
}

export function summarize(history: SessionRecord[], now: number, days = 7): Summary {
  const recent = history.filter((r) => r.startedAt >= startOfDay(now) - (days - 1) * DAY);
  const focusMs = recent.reduce((s, r) => s + r.focusMs, 0);
  const leaves = recent.flatMap((r) => r.leaves);
  const yes = recent.reduce((s, r) => s + r.checkInsOnTask, 0);
  const no = recent.reduce((s, r) => s + r.checkInsOffTask, 0);
  const firstMs = median(leaves.map((l) => l.intoBlockMs));
  return {
    sessions: recent.length,
    focusMs,
    phoneChecks: leaves.length,
    checksPerHour: focusMs >= 10 * MIN ? leaves.length / (focusMs / (60 * MIN)) : null,
    minutesToFirstCheck: firstMs === null ? null : Math.round(firstMs / MIN),
    onTaskRate: yes + no > 0 ? yes / (yes + no) : null,
    checkInsAnswered: yes + no,
  };
}

export interface Recommendation {
  id: string;
  title: string;
  body: string;
  methodId?: MethodId;
}

function hourLabel(h: number): string {
  const fmt = (x: number) => `${x % 12 === 0 ? 12 : x % 12}${x < 12 || x === 24 ? 'am' : 'pm'}`;
  return `${fmt(h)} and ${fmt(h + 1)}`;
}

export function recommend(history: SessionRecord[], currentMethod: MethodId, now: number): Recommendation[] {
  const recent = history.filter((r) => r.startedAt >= now - 14 * DAY && r.focusMs >= 10 * MIN);
  if (recent.length < 2) {
    return [
      {
        id: 'more-data',
        title: 'Do a couple of sessions first',
        body: 'Once there are two sessions of at least 10 minutes, OnTask will suggest a study method based on when you tend to drift.',
      },
    ];
  }
  const s = summarize(recent, now, 14);
  const focusHours = s.focusMs / (60 * MIN);
  const out: Recommendation[] = [];
  const typical = s.minutesToFirstCheck;

  if (s.phoneChecks >= 3 && typical !== null && typical < 18 && currentMethod !== 'sprint') {
    out.push({
      id: 'sprint',
      title: 'Try short sprints (15 / 3)',
      body: `You usually pick up your phone about ${typical} minutes into a block. Ending blocks before then lets the break take the urge instead of your focus time.`,
      methodId: 'sprint',
    });
  } else if (s.phoneChecks >= 3 && typical !== null && typical < 30 && (currentMethod === 'fiftyTwo' || currentMethod === 'deep')) {
    out.push({
      id: 'pomodoro',
      title: 'Try Pomodoro (25 / 5)',
      body: `Your blocks run well past the point where you usually drift (about ${typical} minutes in). A break every 25 minutes keeps more of the block on task.`,
      methodId: 'pomodoro',
    });
  } else if (focusHours >= 1 && (s.checksPerHour ?? 0) < 0.5 && (currentMethod === 'sprint' || currentMethod === 'pomodoro')) {
    out.push({
      id: 'longer',
      title: 'You can handle longer blocks (52 / 17)',
      body: 'You rarely leave mid-block. Longer blocks mean fewer restarts, and every restart costs a few minutes of getting back into the work.',
      methodId: 'fiftyTwo',
    });
  }

  if (s.checkInsAnswered >= 5 && s.onTaskRate !== null && s.onTaskRate < 0.6) {
    out.push({
      id: 'if-then',
      title: 'Write an if-then plan before you start',
      body: `You were on task in ${Math.round(s.onTaskRate * 100)}% of check-ins. Deciding in advance what you will do when distraction hits ("If I want my phone, I will…") had a medium-to-large effect on reaching goals across 94 studies.`,
    });
  }

  const allLeaves = recent.flatMap((r) => r.leaves);
  if (allLeaves.length >= 5) {
    const byHour = new Map<number, number>();
    for (const l of allLeaves) byHour.set(new Date(l.at).getHours(), (byHour.get(new Date(l.at).getHours()) ?? 0) + 1);
    const [hour, count] = [...byHour].sort((a, b) => b[1] - a[1])[0];
    if (count >= 3 && count / allLeaves.length >= 0.4) {
      out.push({
        id: 'peak-hour',
        title: `Your drift peaks between ${hourLabel(hour)}`,
        body: `${count} of your last ${allLeaves.length} phone checks started in that hour. Put easier tasks or your long break there.`,
      });
    }
  }

  if (!out.length) {
    out.push({
      id: 'steady',
      title: 'Keep your current method',
      body: 'Nothing in your recent sessions points to a better rhythm. Keep going and this will update as your pattern changes.',
    });
  }
  return out.slice(0, 3);
}
