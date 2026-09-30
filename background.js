// The monitoring loop. Runs only on tab changes, never on a polling timer:
//
//   observing  → watch tabs for a minute, then guess the task
//   confirming → "Are you working on …?" is on screen, waiting for an answer
//   active     → classify each tab against the task; sustained drift prompts
//
// All state lives in chrome.storage.session because the service worker can be
// torn down between any two events.

import { MODEL, classifyPage, inferTask, domainOf, cleanTitle, isNeutralUrl } from './classifier.js';

const DEFAULTS = { apiKey: '', dwellSeconds: 120, observeSeconds: 60 };
const PROMPTS_PER_HOUR = 6;
const SNOOZE_MS = 5 * 60 * 1000;
const OPEN_TAB_WEIGHT_MS = 1500; // tabs already open at start count a little
const MIN_OBSERVED_MS = 10_000;
const MAX_OBSERVATIONS = 200;
const HISTORY_LIMIT = 30;

chrome.idle.setDetectionInterval(120);

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
  const drifting = s.mode === 'active' && ['off', 'ambiguous'].includes(s.current?.verdict);
  const text = s.mode === 'observing' || s.mode === 'confirming' ? '?' : drifting && s.current.verdict === 'off' ? 'off' : '';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: text === 'off' ? '#c2410c' : '#6b7280' });
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
    if (c.verdict === 'on') st.onMs += ms;
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
    guessEngine: null,
    contextTokens: [],
    observeUntil: now + settings.observeSeconds * 1000,
    observations: {},
    observedMs: 0,
    inferringSince: null,
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
    lastError: null,
    stats: { onMs: 0, offMs: 0, ambiguousMs: 0, drifts: 0, driftDomains: {} },
  };
}

async function startSession(task) {
  const settings = await getSettings();
  const old = await loadState();
  if (old.prompt) await hidePrompt(old);
  await chrome.alarms.clearAll();
  const now = Date.now();
  const s = freshState(now, settings);
  if (task) {
    activate(s, task, 'declared', []);
  } else {
    for (const tab of await chrome.tabs.query({})) {
      const p = pageOf(tab);
      if (!p.neutral && !p.ours && !p.placeholder) addObservation(s, p, OPEN_TAB_WEIGHT_MS);
    }
    await chrome.alarms.create('observe', { when: s.observeUntil });
  }
  await saveState(s);
  await evaluate();
}

function activate(s, task, source, contextTokens) {
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
  chrome.alarms.clear('observe');
}

async function stopSession() {
  const s = await loadState();
  if (s.mode === 'off') return;
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
  if (s.mode === 'confirming' && ready && s.prompt && !s.prompt.windowId && !s.prompt.shownUrls.includes(page.tabId + page.url)) {
    await showPrompt(s); // they moved on without answering; follow them
  }

  if (s.mode === 'active' && ready) {
    const cached = s.cache[cacheKey(page)];
    if (s.allowList.includes(page.domain)) await applyVerdict(s, { verdict: 'on', reason: 'You said this site counts' });
    else if (cached) await applyVerdict(s, cached);
    else classifyLater(s, page);
  }
  // Neutral and still-loading pages leave any running drift clock alone.
  await saveState(s);
}

const inflight = new Set();

// Classification can take seconds with Claude, so it runs outside the lock and
// the result is applied only if the user is still on that page.
function classifyLater(s, page) {
  const key = cacheKey(page);
  if (inflight.has(key)) return;
  inflight.add(key);
  const input = { task: s.task, contextTokens: s.contextTokens, allowList: s.allowList, domain: page.domain, title: page.title };
  getSettings()
    .then((settings) => classifyPage(input, settings.apiKey))
    .then((result) =>
      locked(async () => {
        const s = await loadState();
        if (s.mode !== 'active' || s.task !== input.task) return;
        s.lastError = result.error ?? (result.engine === 'claude' ? null : s.lastError);
        s.cache[key] = { verdict: result.verdict, reason: result.reason };
        if (s.current && cacheKey(s.current) === key && !s.current.verdict) await applyVerdict(s, s.cache[key]);
        await saveState(s);
      }),
    )
    .finally(() => inflight.delete(key));
}

async function applyVerdict(s, { verdict, reason }) {
  const c = s.current;
  c.verdict = verdict;
  c.reason = reason;
  if (verdict === 'on') {
    s.lastOnTaskTabId = c.tabId;
    await resetDrift(s);
  } else {
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
  if (s.mode !== 'active' || !c || !s.driftStart || !['off', 'ambiguous'].includes(c.verdict)) return;
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
}

// --- inference --------------------------------------------------------------

async function runInference(force) {
  const job = await locked(async () => {
    const s = await loadState();
    const busy = s.inferringSince && Date.now() - s.inferringSince < 60_000;
    if (s.mode !== 'observing' || busy) return null;
    const now = Date.now();
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
    return { observations, apiKey: (await getSettings()).apiKey };
  });
  if (!job) return;

  const result = await inferTask(job.observations, job.apiKey).catch((err) => ({ error: String(err) }));

  await locked(async () => {
    const s = await loadState();
    if (s.mode !== 'observing') return;
    s.inferringSince = null;
    if (result?.error) s.lastError = result.error;
    if (!result?.task) {
      s.observeUntil = Date.now() + 30_000;
      await chrome.alarms.create('observe', { when: s.observeUntil });
      await saveState(s);
      return;
    }
    s.mode = 'confirming';
    s.guess = result.task;
    s.guessTokens = result.contextTokens ?? [];
    s.guessEngine = result.engine;
    s.prompt = newPrompt('confirm', { guess: result.task });
    await showPrompt(s);
    await saveState(s);
  });
}

// --- prompts ----------------------------------------------------------------

function newPrompt(kind, fields) {
  return { id: crypto.randomUUID(), kind, ...fields, tabIds: [], shownUrls: [], windowId: null };
}

function promptView(p) {
  return { id: p.id, kind: p.kind, guess: p.guess, task: p.task, domain: p.domain, driftStart: p.driftStart };
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
  if (action === 'confirm-correct' && !value?.trim()) return;
  const settings = await getSettings();
  const now = Date.now();
  const { domain } = s.prompt;
  await hidePrompt(s);

  switch (action) {
    case 'confirm-yes':
      activate(s, s.guess, 'inferred', s.guessTokens);
      break;
    case 'confirm-correct':
      activate(s, value.trim(), 'corrected', []);
      break;
    case 'confirm-later':
      s.mode = 'observing';
      s.observations = {};
      s.observedMs = 0;
      s.observeUntil = now + settings.observeSeconds * 1000;
      await chrome.alarms.create('observe', { when: s.observeUntil });
      break;
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
  }
  await saveState(s);
  if (s.mode === 'active' && !s.current) await evaluate();
}

async function setTask(task) {
  const s = await loadState();
  if (s.mode === 'off') return startSession(task);
  accrue(s, Date.now());
  if (s.prompt) await hidePrompt(s);
  activate(s, task, 'declared', []);
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
  return {
    state,
    lastSummary,
    now: Date.now(),
    settings: { dwellSeconds: settings.dwellSeconds, observeSeconds: settings.observeSeconds, hasKey: !!settings.apiKey, model: MODEL },
  };
}

async function saveSettings(patch) {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, ...patch } });
  const s = await loadState();
  if (patch.apiKey !== undefined && s.mode === 'active') {
    s.cache = {}; // new engine, fresh judgments
    s.lastError = null;
    await saveState(s);
  }
  if (patch.dwellSeconds !== undefined && s.driftStart) await scheduleDwell(s);
}

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

chrome.idle.onStateChanged.addListener((idleState) =>
  locked(async () => {
    const s = await loadState();
    if (s.mode === 'off') return;
    s.idle = idleState !== 'active';
    await saveState(s);
    await evaluate();
  }),
);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'observe') runInference(false);
  if (alarm.name === 'dwell') locked(onDwell);
});

// On from the moment it's installed and every time the browser starts.
chrome.runtime.onInstalled.addListener(() => locked(() => startSession(null)));
chrome.runtime.onStartup.addListener(() => locked(() => startSession(null)));
