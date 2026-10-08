// Study methods. Each is a focus/break rhythm; Flowtime has no fixed focus
// length and sizes the break from how long you actually focused.

export type MethodId = 'pomodoro' | 'sprint' | 'fiftyTwo' | 'deep' | 'flow' | 'custom';

export interface Method {
  id: MethodId;
  name: string;
  short: string;
  focusMin: number;
  breakMin: number;
  longBreakMin: number;
  longEvery: number; // a long break after this many blocks; 0 = never
  flow: boolean;
  blurb: string;
}

export const METHODS: Method[] = [
  {
    id: 'pomodoro',
    name: 'Pomodoro',
    short: '25 / 5',
    focusMin: 25,
    breakMin: 5,
    longBreakMin: 15,
    longEvery: 4,
    flow: false,
    blurb: '25-minute blocks with 5-minute breaks, and a 15-minute break after every fourth. A good default.',
  },
  {
    id: 'sprint',
    name: 'Short sprints',
    short: '15 / 3',
    focusMin: 15,
    breakMin: 3,
    longBreakMin: 10,
    longEvery: 4,
    flow: false,
    blurb: 'Short blocks for when starting is the hard part, or your attention runs out early.',
  },
  {
    id: 'fiftyTwo',
    name: '52 / 17',
    short: '52 / 17',
    focusMin: 52,
    breakMin: 17,
    longBreakMin: 17,
    longEvery: 0,
    flow: false,
    blurb: 'Longer blocks with real breaks, for work that takes a while to get into.',
  },
  {
    id: 'deep',
    name: 'Deep work',
    short: '90 / 20',
    focusMin: 90,
    breakMin: 20,
    longBreakMin: 20,
    longEvery: 0,
    flow: false,
    blurb: 'One long block for when you are already in a groove and want fewer restarts.',
  },
  {
    id: 'flow',
    name: 'Flowtime',
    short: 'Open',
    focusMin: 0,
    breakMin: 0,
    longBreakMin: 0,
    longEvery: 0,
    flow: true,
    blurb: 'Focus until you naturally stop, then take a break about a fifth as long.',
  },
  {
    id: 'custom',
    name: 'Custom',
    short: 'Yours',
    focusMin: 30,
    breakMin: 5,
    longBreakMin: 15,
    longEvery: 4,
    flow: false,
    blurb: 'Your own focus and break lengths, set in Settings.',
  },
];

export function resolveMethod(id: MethodId, custom: { focusMin: number; breakMin: number }): Method {
  const base = METHODS.find((m) => m.id === id) ?? METHODS[0];
  if (base.id !== 'custom') return base;
  return { ...base, focusMin: custom.focusMin, breakMin: custom.breakMin, short: `${custom.focusMin} / ${custom.breakMin}` };
}
