// A small fake of the chrome.* APIs background.js uses, with a controllable
// clock, so whole sessions can be driven from Node tests.

const ev = () => {
  const ls = [];
  return { addListener: (f) => ls.push(f), fire: (...a) => ls.map((f) => f(...a)) };
};
const store = (obj) => ({
  get: async (k) => ({ [k]: structuredClone(obj[k]) }),
  set: async (o) => Object.assign(obj, structuredClone(o)),
  remove: async (k) => delete obj[k],
});

export function installChrome({ now = Date.UTC(2026, 9, 12, 14), tabs = [], settings } = {}) {
  const t = {
    now,
    session: {},
    local: settings ? { settings } : {},
    alarms: {},
    injected: [], // overlay cards shown: { tabId, view }
    hidden: 0,
    windows: [], // fallback prompt windows
    opened: [], // tabs created (break links)
    chimes: 0,
    tabs: tabs.map((tab, i) => ({ windowId: 1, status: 'complete', active: i === 0, ...tab })),
  };
  Date.now = () => t.now;
  let offscreen = false;

  globalThis.chrome = {
    storage: { session: store(t.session), local: store(t.local) },
    idle: { setDetectionInterval: (n) => (t.idleInterval = n), onStateChanged: ev() },
    action: { setBadgeText: (o) => (t.badge = o.text), setBadgeBackgroundColor() {} },
    alarms: {
      create: async (n, o) => (t.alarms[n] = o.when ?? `every ${o.periodInMinutes}m`),
      clear: async (n) => delete t.alarms[n],
      clearAll: async () => Object.keys(t.alarms).forEach((k) => delete t.alarms[k]),
      onAlarm: ev(),
    },
    tabs: {
      query: async (q) => (q.active ? t.tabs.filter((x) => x.active) : t.tabs),
      get: async (id) => {
        const tab = t.tabs.find((x) => x.id === id);
        if (!tab) throw new Error('no tab');
        return tab;
      },
      update: async (id) => {
        t.tabs.forEach((x) => (x.active = x.id === id));
        chrome.tabs.onActivated.fire({ tabId: id });
        return t.tabs.find((x) => x.id === id);
      },
      create: async (o) => (t.opened.push(o.url), { id: 999 }),
      onActivated: ev(),
      onUpdated: ev(),
      onRemoved: ev(),
    },
    windows: {
      WINDOW_ID_NONE: -1,
      update: async () => {},
      remove: async () => {},
      getLastFocused: async () => ({ left: 0, top: 0, width: 1200 }),
      create: async (o) => (t.windows.push(o), { id: 99 }),
      onFocusChanged: ev(),
      onRemoved: ev(),
    },
    scripting: {
      executeScript: async (o) => {
        const tab = t.tabs.find((x) => x.id === o.target.tabId);
        if (tab?.url?.startsWith('chrome')) throw new Error('Cannot access a chrome:// URL');
        if (o.args) t.injected.push({ tabId: o.target.tabId, view: o.args[0] });
        else if (o.func) t.hidden++;
      },
    },
    runtime: {
      getURL: (p) => `chrome-extension://test/${p}`,
      onMessage: ev(),
      onInstalled: ev(),
      onStartup: ev(),
      getContexts: async () => (offscreen ? [{}] : []),
      sendMessage: async (m) => {
        if (m.target === 'offscreen') t.chimes++;
      },
    },
    offscreen: { createDocument: async () => (offscreen = true) },
  };

  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  Object.assign(t, {
    settle,
    state: () => t.session.state,
    lastCard: () => t.injected.at(-1)?.view,
    send: (msg) => new Promise((resolve) => chrome.runtime.onMessage.fire(msg, {}, resolve)),
    async answer(action, value) {
      const r = await t.send({ type: 'answer', promptId: t.state().prompt.id, action, value });
      await settle();
      return r;
    },
    async visit(id, url, title) {
      let tab = t.tabs.find((x) => x.id === id);
      if (!tab) t.tabs.push((tab = { id, windowId: 1, status: 'complete' }));
      Object.assign(tab, { url, title, status: 'complete' });
      t.tabs.forEach((x) => (x.active = x.id === id));
      chrome.tabs.onActivated.fire({ tabId: id });
      await settle();
    },
    async fire(name) {
      chrome.alarms.onAlarm.fire({ name });
      await settle(60);
    },
    async advanceTo(name) {
      t.now = t.alarms[name];
      await t.fire(name);
    },
  });
  return t;
}
