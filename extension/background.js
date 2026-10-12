// The monitoring loop. Runs only on tab changes, never on a polling timer:
//
//   observing  → ask what you're working on; if no answer in 20s, guess
//   confirming → "Are you working on …?" is on screen, waiting for an answer
//   active     → classify each tab against the task; sustained drift prompts
//
// All state lives in chrome.storage.session because the service worker can be
// torn down between any two events.

import { classifyPage, inferTask, domainOf, cleanTitle, isNeutralUrl } from './classifier.js';
import { initSync, connect as connectSync, getSync, pair, request as syncRequest, send as syncSend } from './sync.js';

const DEFAULTS = { dwellSeconds: 120, timer: 'pomodoro', customFocusMin: 30, customBreakMin: 5, idleMinutes: 5, sound: true };
const ASK_SECONDS = 20; // how long to wait for "what are you working on?" before guessing
// Focus/break rhythms: focus, break, long break (minutes), long break every N blocks.
// Flowtime has no fixed focus length; its break is a fifth of the focus.
const TIMERS = {
  pomodoro: { focusMin: 25, breakMin: 5, longMin: 15, longEvery: 4 },
  sprint: { focusMin: 15, breakMin: 3, longMin: 10, longEvery: 4 },
  fiftyTwo: { focusMin: 52, breakMin: 17, longMin: 17, longEvery: 0 },
  deep: { focusMin: 90, breakMin: 20, longMin: 20, longEvery: 0 },
  flow: { flow: true },
};
const BREAK_SITES = {
  tiktok: 'https://www.tiktok.com/',
  youtube: 'https://www.youtube.com/',
  instagram: 'https://www.instagram.com/',
  x: 'https://x.com/',
};

function timerSpec(kind, settings) {
  if (kind === 'custom') return { focusMin: settings.customFocusMin, breakMin: settings.customBreakMin, longMin: settings.customBreakMin * 3, longEvery: 4 };
  return TIMERS[kind] ?? null;
}
const PROMPTS_PER_HOUR = 6;
const SNOOZE_MS = 5 * 60 * 1000;
const OPEN_TAB_WEIGHT_MS = 1500; // tabs already open at start count a little
const MIN_OBSERVED_MS = 10_000;
const MAX_OBSERVATIONS = 200;
const HISTORY_LIMIT = 30;

// Chrome reports "idle" after this long without keyboard or mouse input.
function applyIdleInterval(settings) {
  chrome.idle.setDetectionInterval(Math.max(60, (settings.idleMinutes || 2) * 60));
}
getSettings().then(applyIdleInterval);

// --- storage ----------------------------------------------------------------

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...settings };
}

async function loadState() {
  const { state } = await chrome.storage.session.get('state');
  return state ?? { mode: 'off' };
}

async function saveState(s) {
  await chrome.storage.session.set({ state: s });
  updateBadge(s);
}

function updateBadge(s) {
  const drifting = s.mode === 'active' && !inBreak(s) && s.current?.verdict === 'off';
  let text = s.mode === 'observing' || s.mode === 'confirming' ? '?' : drifting ? 'off' : '';
  let color = text === 'off' ? '#c2410c' : '#6b7280';
  if (!text && s.mode === 'active' && s.timer) {
    const mins = s.timer.endsAt === null ? Math.floor((Date.now() - s.timer.phaseStartedAt) / 60_000) : Math.ceil((s.timer.endsAt - Date.now()) / 60_000);
    text = `${Math.max(0, mins)}m`;
    color = inBreak(s) ? '#b45309' : '#1f5c42';
  }
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

const inBreak = (s) => s.timer?.phase === 'break';

// Service workers can't play audio, so chimes go through an offscreen page.
async function playChime() {
  if (!(await getSettings()).sound) return;
  try {
    const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (!open.length) {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Play OnTask alert chimes' });
    }
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'chime' });
  } catch (err) {
    console.warn('[OnTask] chime failed', err);
  }
}

// Events arrive concurrently; every read-modify-write of state goes through here.
let queue = Promise.resolve();
function locked(fn) {
  const run = queue.then(() => fn());
  queue = run.catch((err) => console.error('[OnTask]', err));
  return run;
}

// --- pages and time ---------------------------------------------------------

function pageOf(tab) {
  const url = tab.url || tab.pendingUrl || '';
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    url,
    domain: domainOf(url),
    title: cleanTitle(tab.title),
    // While a page loads Chrome reports its URL as the title; wait for the real one.
    placeholder: tab.status !== 'complete' && (!tab.title || url.includes(tab.title) || tab.title.includes('://')),
    neutral: isNeutralUrl(url),
    ours: url.startsWith(chrome.runtime.getURL('')),
  };
}

// A title change on the same URL (a ticking timer, an unread count) is not a
// new page, unless the old title was only a loading placeholder.
const samePage = (next, prev) =>
  !!next && !!prev && next.tabId === prev.tabId && next.url === prev.url && (next.title === prev.title || !prev.placeholder);
const cacheKey = (p) => `${p.domain}|${p.title}`;

async function activePage() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ? pageOf(tab) : null;
}

function addObservation(s, page, ms) {
  const key = cacheKey(page);
  const o = (s.observations[key] ??= { domain: page.domain, title: page.title, ms: 0 });
  o.ms += ms;
  const keys = Object.keys(s.observations);
  if (keys.length > MAX_OBSERVATIONS) delete s.observations[keys[0]];
}

// Credit the time since the last transition to whatever the current page was.
function accrue(s, now) {
  const c = s.current;
  if (!c) return;
  const ms = now - c.since;
  c.since = now;
  if (ms <= 0) return;
  if (s.mode === 'observing' || s.mode === 'confirming') {
    if (!c.neutral && !c.placeholder) {
      addObservation(s, c, ms);
      s.observedMs += ms;
    }
  } else if (s.mode === 'active') {
    const st = s.stats;
    if (inBreak(s)) st.breakMs = (st.breakMs || 0) + ms; // breaks are neither on nor off task
    else if (c.verdict === 'on') st.onMs += ms;
    else if (c.verdict === 'off' || c.verdict === 'ambiguous') {
      st[c.verdict === 'off' ? 'offMs' : 'ambiguousMs'] += ms;
      st.driftDomains[c.domain] = (st.driftDomains[c.domain] || 0) + ms;
    }
  }
}

// --- session lifecycle ------------------------------------------------------

function freshState(now, settings) {
  return {
    mode: 'observing',
    startedAt: now,
    activeSince: null,
    task: null,
    taskSource: null,
    guess: null,
    guessTokens: [],
    contextTokens: [],
    observeUntil: now + ASK_SECONDS * 1000,
    observations: {},
    observedMs: 0,
    current: null,
    idle: false,
    blurred: false,
    allowList: [],
    cache: {},
    lastOnTaskTabId: null,
    dwellMultiplier: 1,
    driftStart: null,
    driftCounted: false,
    lastDriftPromptAt: null,
    snoozeUntil: 0,
    prompt: null,
    promptTimes: [],
    timer: null,
    syncId: null, // shared session id when linked through the companion
    screenAt: 0,
    screenWatching: false,
    stats: { onMs: 0, offMs: 0, ambiguousMs: 0, breakMs: 0, drifts: 0, idles: 0, driftDomains: {} },
  };
}

async function startSession(task, remoteId = null) {
  const settings = await getSettings();
  const old = await loadState();
  if (old.prompt) await hidePrompt(old);
  await chrome.alarms.clearAll();
  const now = Date.now();
  const s = freshState(now, settings);
  if (task) {
    await activate(s, task, remoteId ? 'remote' : 'declared', [], remoteId);
  } else {
    for (const tab of await chrome.tabs.query({})) {
      const p = pageOf(tab);
      if (!p.neutral && !p.ours && !p.placeholder) addObservation(s, p, OPEN_TAB_WEIGHT_MS);
    }
    await chrome.alarms.create('observe', { when: s.observeUntil });
    // Ask first. The card follows them to the first page it can be shown on.
    s.prompt = newPrompt('ask', { seconds: ASK_SECONDS });
  }
  await saveState(s);
  await evaluate();
}

async function activate(s, task, source, contextTokens, remoteId = null) {
  Object.assign(s, {
    mode: 'active',
    task,
    taskSource: source,
    contextTokens,
    cache: {},
    allowList: [],
    activeSince: Date.now(),
    current: null, // forces the page in front of them to be classified fresh
    driftStart: null,
    driftCounted: false,
    lastDriftPromptAt: null,
    snoozeUntil: 0,
  });
  await chrome.alarms.clear('observe');
  await startTimer(s, await getSettings());
  // Share the session with the phone, unless it came from there.
  s.syncId = remoteId ?? crypto.randomUUID();
  s.screenAt = 0;
  if (!remoteId) syncSend({ type: 'session-start', session: { id: s.syncId, task, startedAt: s.activeSince, timer: s.timer } });
}

// The phone mirrors the timer, so every change goes to the companion.
function shareTimer(s) {
  if (s.syncId) syncSend({ type: 'session-update', id: s.syncId, timer: s.timer });
}

// --- focus/break timer ------------------------------------------------------

async function startTimer(s, settings) {
  const spec = timerSpec(settings.timer, settings);
  if (!spec) {
    s.timer = null;
    await chrome.alarms.clear('timer');
    await chrome.alarms.clear('badge');
    return;
  }
  const now = Date.now();
  s.timer = { kind: settings.timer, ...spec, phase: 'focus', phaseStartedAt: now, endsAt: spec.flow ? null : now + spec.focusMin * 60_000, blocksDone: 0, isLong: false };
  if (s.timer.endsAt) await chrome.alarms.create('timer', { when: s.timer.endsAt });
  else await chrome.alarms.clear('timer');
  await chrome.alarms.create('badge', { periodInMinutes: 1 });
}

async function beginBreak(s, now) {
  const t = s.timer;
  const blocksDone = t.blocksDone + 1;
  const isLong = !t.flow && t.longEvery > 0 && blocksDone % t.longEvery === 0;
  const minutes = t.flow ? Math.min(20, Math.max(2, Math.round((now - t.phaseStartedAt) / 5 / 60_000))) : isLong ? t.longMin : t.breakMin;
  s.timer = { ...t, phase: 'break', blocksDone, isLong, phaseStartedAt: now, endsAt: now + minutes * 60_000 };
  await chrome.alarms.create('timer', { when: s.timer.endsAt });
  await resetDrift(s); // no drift prompts on a break
  if (s.prompt) await hidePrompt(s);
  s.prompt = newPrompt('break', { minutes, blocksDone, isLong });
  await showPrompt(s);
  shareTimer(s);
}

// After a break, drift is measured from the moment focus resumes.
async function resumeFocus(s, now) {
  const t = s.timer;
  s.timer = { ...t, phase: 'focus', phaseStartedAt: now, endsAt: t.flow ? null : now + t.focusMin * 60_000 };
  if (s.timer.endsAt) await chrome.alarms.create('timer', { when: s.timer.endsAt });
  else await chrome.alarms.clear('timer');
  if (s.current && ['off', 'ambiguous'].includes(s.current.verdict)) {
    s.driftStart = now;
    await scheduleDwell(s);
  }
  shareTimer(s);
}

async function onTimer() {
  const s = await loadState();
  if (s.mode !== 'active' || !s.timer || s.timer.endsAt === null) return;
  const now = Date.now();
  if (now < s.timer.endsAt - 250) {
    await chrome.alarms.create('timer', { when: s.timer.endsAt });
    return;
  }
  accrue(s, now);
  if (s.timer.phase === 'focus') {
    await beginBreak(s, now);
  } else {
    await resumeFocus(s, now);
    if (s.prompt) await hidePrompt(s);
    s.prompt = newPrompt('resume', { task: s.task });
    await showPrompt(s);
  }
  await saveState(s);
  await playChime();
}

// Flowtime: you decide when the focus block ends.
async function takeFlowBreak() {
  const s = await loadState();
  if (s.mode !== 'active' || !s.timer?.flow || s.timer.phase !== 'focus') return;
  const now = Date.now();
  accrue(s, now);
  await beginBreak(s, now);
  await saveState(s);
  await playChime();
}

async function stopSession(fromRemote = false) {
  const s = await loadState();
  if (s.mode === 'off') return;
  if (s.syncId && !fromRemote) syncSend({ type: 'session-end', id: s.syncId });
  const now = Date.now();
  accrue(s, now);
  if (s.prompt) await hidePrompt(s);
  await chrome.alarms.clearAll();
  if (s.task && s.activeSince) {
    const summary = {
      task: s.task,
      startedAt: s.activeSince,
      endedAt: now,
      onMs: s.stats.onMs,
      offMs: s.stats.offMs,
      ambiguousMs: s.stats.ambiguousMs,
      drifts: s.stats.drifts,
      idles: s.stats.idles || 0,
      driftDomains: topDomains(s.stats.driftDomains),
    };
    const { history = [] } = await chrome.storage.local.get('history');
    await chrome.storage.local.set({ lastSummary: summary, history: [summary, ...history].slice(0, HISTORY_LIMIT) });
  }
  await saveState({ mode: 'off' });
}

function topDomains(map, n = 5) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([domain, ms]) => ({ domain, ms }));
}

// --- the loop ---------------------------------------------------------------

async function evaluate() {
  const s = await loadState();
  if (s.mode === 'off') return;
  const away = s.idle || s.blurred;
  const page = away ? null : await activePage();
  if (page?.ours) return; // our own prompt window, not somewhere the user went
  if (samePage(page, s.current)) return;

  const now = Date.now();
  accrue(s, now);
  s.current = page && { ...page, since: now, enteredAt: now, verdict: page.neutral ? 'neutral' : null, reason: null };
  if (!page) await resetDrift(s); // left the browser or went idle: we can't see them, so stop the clock

  const ready = page && !page.neutral && !page.placeholder;
  const following = s.prompt && (s.mode === 'confirming' || s.prompt.kind === 'ask');
  if (following && ready && !s.prompt.windowId && !s.prompt.shownUrls.includes(page.tabId + page.url)) {
    await showPrompt(s); // they moved on without answering; follow them
  }

  if (s.mode === 'active' && ready) {
    const cached = s.cache[cacheKey(page)];
    if (s.allowList.includes(page.domain)) await applyVerdict(s, { verdict: 'on', reason: 'You said this site counts' });
    else if (cached) await applyVerdict(s, cached);
    else {
      const guess = classifyPage({ task: s.task, contextTokens: s.contextTokens, domain: page.domain, title: page.title });
      if (s.screenWatching) {
        // The screen model has the final say. A title alone never marks a
        // page off task while it's looking; it's "checking" until it answers.
        syncSend({ type: 'check-now' });
        await applyVerdict(s, guess.verdict === 'on' ? guess : { verdict: 'ambiguous', reason: 'Checking what’s on screen…' });
      } else {
        s.cache[cacheKey(page)] = guess;
        await applyVerdict(s, guess);
      }
    }
  }
  // Neutral and still-loading pages leave any running drift clock alone.
  await saveState(s);
}

async function applyVerdict(s, { verdict, reason }) {
  const c = s.current;
  c.verdict = verdict;
  c.reason = reason;
  if (verdict === 'on') {
    s.lastOnTaskTabId = c.tabId;
    await resetDrift(s);
  } else if (!inBreak(s)) {
    // The clock runs across consecutive off-task pages, so hopping from one
    // video to the next doesn't restart it. Only returning to the task does.
    s.driftStart ??= c.enteredAt;
    await scheduleDwell(s);
  }
}

async function resetDrift(s) {
  s.driftStart = null;
  s.driftCounted = false;
  s.lastDriftPromptAt = null;
  await chrome.alarms.clear('dwell');
  if (s.prompt?.kind === 'drift') await hidePrompt(s);
}

// Off-task pages wait one dwell period; ambiguous ones wait two. An ignored
// prompt waits two more before asking again.
function dwellDueAt(s, settings) {
  const base = settings.dwellSeconds * 1000 * s.dwellMultiplier;
  const threshold = s.current?.verdict === 'ambiguous' ? base * 2 : base;
  let due = s.driftStart + threshold;
  if (s.lastDriftPromptAt) due = Math.max(due, s.lastDriftPromptAt + threshold * 2);
  return Math.max(due, s.snoozeUntil || 0);
}

async function scheduleDwell(s) {
  const settings = await getSettings();
  await chrome.alarms.create('dwell', { when: Math.max(dwellDueAt(s, settings), Date.now() + 500) });
}

async function onDwell() {
  const s = await loadState();
  const c = s.current;
  if (s.mode !== 'active' || inBreak(s) || !c || !s.driftStart || !['off', 'ambiguous'].includes(c.verdict)) return;
  const settings = await getSettings();
  const now = Date.now();
  const due = dwellDueAt(s, settings);
  if (now < due - 250) {
    await chrome.alarms.create('dwell', { when: due });
    return;
  }
  s.promptTimes = s.promptTimes.filter((t) => now - t < 3600_000);
  if (s.promptTimes.length >= PROMPTS_PER_HOUR) {
    await chrome.alarms.create('dwell', { when: s.promptTimes[0] + 3600_000 });
    await saveState(s);
    return;
  }
  accrue(s, now);
  if (!s.driftCounted) {
    s.stats.drifts++;
    s.driftCounted = true;
  }
  s.promptTimes.push(now);
  s.lastDriftPromptAt = now;
  if (s.prompt) await hidePrompt(s);
  s.prompt = newPrompt('drift', { task: s.task, domain: c.domain, driftStart: s.driftStart });
  await showPrompt(s);
  await scheduleDwell(s);
  await saveState(s);
  await playChime();
}

// --- inference --------------------------------------------------------------

async function runInference(force) {
  const job = await locked(async () => {
    const s = await loadState();
    if (s.mode !== 'observing' || (s.inferringSince && Date.now() - s.inferringSince < 30_000)) return null;
    const now = Date.now();
    if (s.askTyping && !force) {
      // They're typing their answer; don't swap the card out from under them.
      s.observeUntil = now + ASK_SECONDS * 1000;
      s.askTyping = false;
      await chrome.alarms.create('observe', { when: s.observeUntil });
      await saveState(s);
      return null;
    }
    accrue(s, now);
    const observations = Object.values(s.observations);
    if (!observations.length || (!force && s.observedMs < MIN_OBSERVED_MS)) {
      // Not enough to go on yet (e.g. they've been on the new tab page).
      s.observeUntil = now + 20_000;
      await chrome.alarms.create('observe', { when: s.observeUntil });
      await saveState(s);
      return null;
    }
    s.inferringSince = now;
    await saveState(s);
    return observations;
  });
  if (!job) return;

  // The local model on the companion guesses best (it can also see the
  // screen); keyword matching is the fallback when it isn't running.
  const local = inferTask(job);
  const reply = await syncRequest({ type: 'infer', pages: job }, 25_000);
  const task = reply?.task || local?.task || null;

  await locked(async () => {
    const s = await loadState();
    if (s.mode !== 'observing') return;
    s.inferringSince = null;
    if (!task) {
      s.observeUntil = Date.now() + 20_000;
      await chrome.alarms.create('observe', { when: s.observeUntil });
      await saveState(s);
      return;
    }
    if (s.prompt) await hidePrompt(s);
    s.mode = 'confirming';
    s.guess = task;
    s.guessTokens = local?.contextTokens ?? [];
    s.prompt = newPrompt('confirm', { guess: task });
    await showPrompt(s);
    await saveState(s);
    await playChime();
  });
}

// --- prompts ----------------------------------------------------------------

function newPrompt(kind, fields) {
  return { id: crypto.randomUUID(), kind, ...fields, tabIds: [], shownUrls: [], windowId: null };
}

function promptView(p) {
  const { id, kind, guess, task, domain, driftStart, minutes, blocksDone, isLong, idleMinutes, seconds } = p;
  return { id, kind, guess, task, domain, driftStart, minutes, blocksDone, isLong, idleMinutes, seconds };
}

async function injectOverlay(tabId, view) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, func: (v) => window.__onTaskOverlay.show(v), args: [view] });
    return true;
  } catch {
    return false; // pages extensions can't touch: new tab, chrome://, the Web Store, PDFs
  }
}

async function showPrompt(s) {
  const p = s.prompt;
  const c = s.current;
  if (!c) return; // they're away; evaluate() shows it when they come back
  if (!c.neutral && (await injectOverlay(c.tabId, promptView(p)))) {
    if (!p.tabIds.includes(c.tabId)) p.tabIds.push(c.tabId);
    p.shownUrls.push(c.tabId + c.url);
    return;
  }
  if (p.windowId) {
    try {
      await chrome.windows.update(p.windowId, { focused: true });
      return;
    } catch {
      p.windowId = null;
    }
  }
  const anchor = await chrome.windows.getLastFocused().catch(() => null);
  const width = 380;
  const height = 280;
  const placement = anchor?.left != null ? { left: Math.max(0, anchor.left + anchor.width - width - 24), top: anchor.top + 72 } : {};
  const win = await chrome.windows.create({ url: chrome.runtime.getURL('prompt.html'), type: 'popup', width, height, focused: true, ...placement });
  p.windowId = win.id;
}

async function hidePrompt(s) {
  const p = s.prompt;
  if (!p) return;
  s.prompt = null;
  for (const tabId of p.tabIds) {
    chrome.scripting.executeScript({ target: { tabId }, func: () => window.__onTaskOverlay?.hide() }).catch(() => {});
  }
  if (p.windowId) chrome.windows.remove(p.windowId).catch(() => {});
}

async function answer({ promptId, action, value }) {
  const s = await loadState();
  if (!s.prompt || s.prompt.id !== promptId) return;
  if ((action === 'confirm-correct' || action === 'ask-set') && !value?.trim()) return;
  const settings = await getSettings();
  const now = Date.now();
  const { domain } = s.prompt;
  await hidePrompt(s);

  switch (action) {
    case 'confirm-yes':
      await activate(s, s.guess, 'inferred', s.guessTokens);
      break;
    case 'confirm-correct':
      await activate(s, value.trim(), 'corrected', []);
      break;
    case 'ask-set':
      await activate(s, value.trim(), 'declared', []);
      break;
    // 'ask-later' just closes the card; the guess still comes after 20 seconds.
    case 'break-open':
      if (BREAK_SITES[value]) await chrome.tabs.create({ url: BREAK_SITES[value] });
      break;
    case 'confirm-later':
      s.mode = 'observing';
      s.observations = {};
      s.observedMs = 0;
      s.observeUntil = now + ASK_SECONDS * 1000;
      await chrome.alarms.create('observe', { when: s.observeUntil });
      break;
    case 'resume-back':
    case 'drift-back': {
      const tab = s.lastOnTaskTabId != null && (await chrome.tabs.get(s.lastOnTaskTabId).catch(() => null));
      if (tab) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } else {
        // Nowhere to send them; give them a dwell period to find their work.
        s.snoozeUntil = now + settings.dwellSeconds * 1000;
        await scheduleDwell(s);
      }
      break;
    }
    case 'drift-allow':
      // The human correction: this site counts for the rest of the session,
      // and the timer gets more patient since it was wrong once.
      if (!s.allowList.includes(domain)) s.allowList.push(domain);
      s.dwellMultiplier = Math.min(2, s.dwellMultiplier * 1.25);
      if (s.current?.domain === domain) {
        accrue(s, now);
        await applyVerdict(s, { verdict: 'on', reason: 'You said this site counts' });
      }
      break;
    case 'drift-snooze':
      s.snoozeUntil = now + SNOOZE_MS;
      await scheduleDwell(s);
      break;
    case 'break-skip':
      if (inBreak(s)) {
        accrue(s, now);
        await resumeFocus(s, now);
      }
      break;
    case 'idle-break':
      // Stepping away on purpose: hold off on drift prompts for 10 minutes.
      s.snoozeUntil = now + 10 * 60_000;
      if (s.driftStart) await scheduleDwell(s);
      break;
    // 'break-ok', 'resume-ok' and 'idle-here' just close the card.
  }
  await saveState(s);
  if (s.mode === 'active' && !s.current) await evaluate();
}

async function setTask(task) {
  const s = await loadState();
  if (s.mode === 'off') return startSession(task);
  accrue(s, Date.now());
  if (s.prompt) await hidePrompt(s);
  await activate(s, task, 'declared', []);
  await saveState(s);
  await evaluate();
}

// What the toolbar popup shows: state with the current segment's time counted in.
async function view() {
  const state = structuredClone(await loadState());
  const settings = await getSettings();
  if (state.mode !== 'off') {
    accrue(state, Date.now());
    state.topDrift = topDomains(state.stats.driftDomains);
    delete state.observations;
    delete state.cache;
  }
  const { lastSummary = null } = await chrome.storage.local.get('lastSummary');
  const { companion } = await chrome.storage.local.get('companion');
  return {
    state,
    lastSummary,
    sync: { ...(await getSync()), paired: !!companion?.code },
    now: Date.now(),
    settings: {
      dwellSeconds: settings.dwellSeconds,
      timer: settings.timer,
      customFocusMin: settings.customFocusMin,
      customBreakMin: settings.customBreakMin,
      idleMinutes: settings.idleMinutes,
      sound: settings.sound,
    },
  };
}

async function saveSettings(patch) {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, ...patch } });
  const next = await getSettings();
  if (patch.idleMinutes !== undefined) applyIdleInterval(next);
  const s = await loadState();
  if (patch.dwellSeconds !== undefined && s.driftStart) await scheduleDwell(s);
  const timerChanged = patch.timer !== undefined || patch.customFocusMin !== undefined || patch.customBreakMin !== undefined;
  if (timerChanged && s.mode === 'active') {
    accrue(s, Date.now());
    await startTimer(s, next);
    shareTimer(s);
    await saveState(s);
  }
}

// --- companion --------------------------------------------------------------

const BROWSER_APPS = ['Google Chrome', 'Google Chrome Canary', 'Chromium', 'Brave Browser', 'Microsoft Edge', 'Arc'];
const sameTitle = (a, b) => {
  const x = (a || '').trim().toLowerCase();
  const y = (b || '').trim().toLowerCase();
  return !!x && !!y && (x.includes(y) || y.includes(x));
};

async function onHubState(hub, isWelcome) {
  const s = await loadState();
  const remote = hub.session;

  // A session started on the phone: take on its task here too.
  if (remote && remote.source !== 'extension' && remote.id !== s.syncId) {
    if (s.mode === 'off') return startSession(remote.task, remote.id);
    accrue(s, Date.now());
    if (s.prompt) await hidePrompt(s);
    await activate(s, remote.task, 'remote', [], remote.id);
    await saveState(s);
    return evaluate();
  }

  // The companion restarted and lost the session: tell it again.
  if (isWelcome && !remote && s.mode === 'active' && s.syncId) {
    syncSend({ type: 'session-start', session: { id: s.syncId, task: s.task, startedAt: s.activeSince, timer: s.timer } });
  }

  const watching = s.mode === 'active' && remote?.id === s.syncId && ['watching', 'idle'].includes(hub.watcher.status);
  if (watching !== !!s.screenWatching) {
    s.screenWatching = watching;
    await saveState(s);
    if (watching) syncSend({ type: 'check-now' });
  }

  // What's actually on screen beats a guess from the tab title, except for
  // sites the user has already said count.
  const screen = hub.screen;
  const c = s.current;
  if (
    s.mode === 'active' && remote?.id === s.syncId && screen && screen.at > (s.screenAt || 0) &&
    c && !c.neutral && BROWSER_APPS.includes(screen.app) && sameTitle(screen.title, c.title) && !s.allowList.includes(c.domain)
  ) {
    s.screenAt = screen.at;
    const result = { verdict: screen.verdict, reason: `On screen: ${screen.activity}` };
    s.cache[cacheKey(c)] = result;
    if (c.verdict !== screen.verdict || c.reason !== result.reason) {
      accrue(s, Date.now());
      await applyVerdict(s, result);
    }
    await saveState(s);
  }
}

async function onSessionEnded({ id, by }) {
  const s = await loadState();
  if (by !== 'extension' && s.mode !== 'off' && s.syncId === id) await stopSession(true);
}

initSync({
  onState: (hub, isWelcome) => locked(() => onHubState(hub, isWelcome)),
  onSessionEnded: (msg) => locked(() => onSessionEnded(msg)),
});

// --- wiring -----------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    'get-view': () => view(),
    'get-prompt': () => loadState().then((s) => (s.prompt ? promptView(s.prompt) : null)),
    answer: () => locked(() => answer(msg)),
    start: () => locked(() => startSession(msg.task?.trim() || null)),
    stop: () => locked(() => stopSession()),
    'set-task': () => locked(() => setTask(msg.task.trim())),
    'guess-now': () => runInference(true),
    'save-settings': () => locked(() => saveSettings(msg.settings)),
    'test-sound': () => playChime(),
    'take-break': () => locked(takeFlowBreak),
    'ask-typing': () =>
      locked(async () => {
        const s = await loadState();
        if (s.prompt?.kind !== 'ask' || s.askTyping) return;
        s.askTyping = true;
        await saveState(s);
      }),
    'open-break-site': () => (BREAK_SITES[msg.site] ? chrome.tabs.create({ url: BREAK_SITES[msg.site] }) : null),
    'pair-companion': () => pair(msg.code, msg.port),
  };
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve(handler()).then(
    (result) => sendResponse(result ?? { ok: true }),
    (err) => sendResponse({ error: String(err) }),
  );
  return true;
});

chrome.tabs.onActivated.addListener(() => locked(evaluate));

chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (tab.active && (info.url || info.title || info.status === 'complete')) locked(evaluate);
});

chrome.tabs.onRemoved.addListener((tabId) =>
  locked(async () => {
    const s = await loadState();
    if (s.lastOnTaskTabId === tabId) {
      s.lastOnTaskTabId = null;
      await saveState(s);
    }
  }),
);

chrome.windows.onFocusChanged.addListener((windowId) =>
  locked(async () => {
    const s = await loadState();
    if (s.mode === 'off') return;
    s.blurred = windowId === chrome.windows.WINDOW_ID_NONE;
    await saveState(s);
    await evaluate();
  }),
);

// Closing the fallback prompt window without answering: show it again on the next page.
chrome.windows.onRemoved.addListener((windowId) =>
  locked(async () => {
    const s = await loadState();
    if (s.prompt?.windowId === windowId) {
      s.prompt.windowId = null;
      await saveState(s);
    }
  }),
);

// Idle on a page for too long: a chime and a "still with it?" card. A tab
// playing audio (a lecture video) is someone listening, not someone idle, and
// a locked screen is someone who walked away on purpose.
chrome.idle.onStateChanged.addListener((idleState) =>
  locked(async () => {
    const s = await loadState();
    if (s.mode === 'off') return;
    const settings = await getSettings();
    const tab = s.current && !s.current.neutral ? await chrome.tabs.get(s.current.tabId).catch(() => null) : null;
    const listening = idleState === 'idle' && !!tab?.audible;
    let chime = false;
    if (idleState === 'idle' && !listening && s.mode === 'active' && settings.idleMinutes > 0 && !inBreak(s) && tab) {
      if (s.prompt) await hidePrompt(s);
      s.prompt = newPrompt('idle', { domain: s.current.domain, idleMinutes: settings.idleMinutes });
      await showPrompt(s);
      s.stats.idles = (s.stats.idles || 0) + 1;
      chime = true;
    }
    s.idle = idleState !== 'active' && !listening;
    await saveState(s);
    await evaluate();
    if (chime) await playChime();
  }),
);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'observe') runInference(false);
  if (alarm.name === 'dwell') locked(onDwell);
  if (alarm.name === 'timer') locked(onTimer);
  if (alarm.name === 'sync') connectSync();
  if (alarm.name === 'badge') loadState().then(updateBadge);
});

// Earlier versions could store a Claude API key; don't keep one around.
async function dropStoredApiKey() {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings && 'apiKey' in settings) {
    delete settings.apiKey;
    await chrome.storage.local.set({ settings });
  }
}

// On from the moment it's installed and every time the browser starts.
chrome.runtime.onInstalled.addListener(() => locked(() => dropStoredApiKey().then(() => startSession(null))));
chrome.runtime.onStartup.addListener(() => locked(() => startSession(null)));
