// Toolbar panel: live status, task, stats, and settings. Polls the background
// once a second while open; rebuilds the body only when the mode changes so
// typing in a field isn't interrupted.

import qrcode from './vendor/qrcode.mjs';

const $ = (sel) => document.querySelector(sel);
const send = (msg) => chrome.runtime.sendMessage(msg);

let renderedKey = null;
let view = null;
let editingTask = false;

function fmt(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 10) return `${m}m ${s % 60}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function taskForm({ label, placeholder, button, type }) {
  const input = el('input', { id: 'task-input', placeholder, autocomplete: 'off' });
  const form = el('form', { className: 'field' }, [
    el('span', { textContent: label }),
    el('div', { className: 'row' }, [input, el('button', { className: 'primary', textContent: button })]),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const task = input.value.trim();
    if (type === 'set-task' && !task) return;
    editingTask = false;
    await send({ type, task });
    refresh(true);
  });
  return form;
}

function summaryBlock(sum) {
  if (!sum) return el('div');
  const total = sum.onMs + sum.offMs + sum.ambiguousMs;
  const pct = total ? Math.round((sum.onMs / total) * 100) : 0;
  const where = sum.driftDomains.length
    ? `Drift went to ${sum.driftDomains.slice(0, 3).map((d) => `${d.domain} (${fmt(d.ms)})`).join(', ')}.`
    : 'No drift.';
  return el('div', { className: 'summary' }, [
    el('h3', { textContent: 'Last session' }),
    el('div', { textContent: `“${sum.task}”: ${fmt(sum.endedAt - sum.startedAt)} total, ${pct}% on task, ${sum.drifts} drift${sum.drifts === 1 ? '' : 's'}.` }),
    el('div', { className: 'muted small', textContent: where }),
  ]);
}

function build(v) {
  const s = v.state;
  const main = $('#main');
  main.replaceChildren();

  if (s.mode === 'off') {
    main.append(
      el('p', { className: 'lead', textContent: 'Not running' }),
      el('p', { className: 'muted', textContent: 'Leave the box empty and I’ll work out what you’re doing from your tabs.' }),
      taskForm({ label: 'What are you working on?', placeholder: 'Optional', button: 'Start', type: 'start' }),
      summaryBlock(v.lastSummary),
    );
  }

  if (s.mode === 'observing') {
    const guessNow = el('button', { className: 'secondary', textContent: 'Guess now' });
    guessNow.onclick = async () => {
      guessNow.disabled = true;
      guessNow.textContent = 'Guessing…';
      await send({ type: 'guess-now' });
      refresh(true);
    };
    main.append(
      taskForm({ label: 'What are you working on?', placeholder: 'e.g. CS 246 notes', button: 'Start', type: 'set-task' }),
      el('p', { className: 'muted', id: 'countdown' }),
      el('div', { className: 'actions' }, [guessNow, stopButton('Turn off')]),
    );
  }

  if (s.mode === 'confirming') {
    const yes = el('button', { className: 'primary', textContent: 'Yes, stay on task' });
    yes.onclick = async () => {
      await send({ type: 'answer', promptId: s.prompt?.id, action: 'confirm-yes' });
      refresh(true);
    };
    main.append(
      el('p', { className: 'lead', textContent: `Are you working on “${s.guess}”?` }),
      el('p', { className: 'muted', textContent: v.sync?.status === 'connected' ? 'Guessed by the model on this Mac from your screen and recent tabs.' : 'Guessed from the words in your recent tab titles.' }),
      el('div', { className: 'actions' }, [yes]),
      taskForm({ label: 'No, I’m working on', placeholder: 'e.g. CS 246 assignment', button: 'Set', type: 'set-task' }),
    );
  }

  if (s.mode === 'active') {
    const change = el('button', { className: 'link', textContent: 'Change' });
    change.onclick = () => {
      editingTask = true;
      refresh(true);
    };
    main.append(
      el('div', { className: 'task' }, [
        el('span', { className: 'label', textContent: 'Working on' }),
        el('div', { className: 'task-line' }, [el('strong', { textContent: s.task }), change]),
      ]),
      el('p', { className: 'timer-line', id: 'timer-line', hidden: true }),
      el('p', { className: 'timer-line', id: 'linked-line', hidden: true }),
    );
    if (s.timer?.flow && s.timer.phase === 'focus') {
      const take = el('button', { className: 'primary full', textContent: 'Take a break' });
      take.onclick = async () => {
        await send({ type: 'take-break' });
        refresh(true);
      };
      main.append(el('div', { className: 'actions' }, [take]));
    }
    if (s.timer?.phase === 'break') {
      main.append(
        el('span', { className: 'label', textContent: 'On your break' }),
        el('div', { className: 'sites' }, [['TikTok', 'tiktok'], ['YouTube', 'youtube'], ['Instagram', 'instagram'], ['X', 'x']].map(([label, site]) => {
          const b = el('button', { className: 'secondary', textContent: label });
          b.onclick = () => send({ type: 'open-break-site', site });
          return b;
        })),
      );
    }
    if (editingTask) {
      main.append(taskForm({ label: 'New task', placeholder: s.task, button: 'Set', type: 'set-task' }));
      $('#task-input')?.focus();
    }
    main.append(
      el('div', { className: 'now', id: 'now' }),
      el('div', { className: 'stats' }, [
        el('div', { className: 'stat' }, [el('b', { id: 'on-time' }), el('span', { textContent: 'On task' })]),
        el('div', { className: 'stat' }, [el('b', { id: 'off-time' }), el('span', { textContent: 'Off task' })]),
        el('div', { className: 'stat' }, [el('b', { id: 'drifts' }), el('span', { textContent: 'Drifts' })]),
      ]),
      el('span', { className: 'label', textContent: 'Where the drift went' }),
      el('ul', { className: 'list', id: 'drift-list' }),
      stopButton('End session', 'full'),
    );
  }
}

function stopButton(text, extra = '') {
  const b = el('button', { className: `secondary ${extra}`, textContent: text });
  b.onclick = async () => {
    await send({ type: 'stop' });
    refresh(true);
  };
  return b;
}

const VERDICT_TEXT = { on: 'On task', off: 'Off task', ambiguous: 'Unclear', neutral: 'Browser page' };

function update(v) {
  const s = v.state;
  const status = $('#status');
  let pill = { off: 'Off', observing: 'Watching', confirming: 'Waiting for you' }[s.mode];
  let cls = '';
  if (s.mode === 'active') {
    const verdict = s.current?.verdict;
    pill = s.timer?.phase === 'break' ? 'On a break' : s.current ? VERDICT_TEXT[verdict] ?? 'Checking…' : 'Away';
    cls = s.timer?.phase === 'break' ? '' : verdict ?? '';
    const line = $('#timer-line');
    line.hidden = !s.timer;
    if (s.timer) {
      const open = s.timer.endsAt === null; // Flowtime focus
      const t = fmt(open ? v.now - s.timer.phaseStartedAt : Math.max(0, s.timer.endsAt - v.now));
      line.textContent = s.timer.phase === 'break'
        ? `${s.timer.isLong ? 'Long break' : 'Break'} · ${t} left`
        : `Focus block ${s.timer.blocksDone + 1} · ${open ? `${t} so far` : `${t} left`}`;
    }
    const hub = v.sync?.status === 'connected' ? v.sync.hub : null;
    const linked = $('#linked-line');
    const parts = [];
    if (hub?.devices.phone) parts.push(hub.phone.away ? 'Phone: picked up' : `Phone: ${hub.phone.checks} check${hub.phone.checks === 1 ? '' : 's'}`);
    if (hub?.screen && hub.watcher.status === 'watching') parts.push(`Screen: ${hub.screen.activity}`);
    linked.hidden = !parts.length;
    linked.textContent = parts.join(' · ');
  }
  updateCompanion(v);
  status.textContent = pill;
  status.className = `pill ${cls}`;

  if (s.mode === 'observing') {
    const left = Math.max(0, s.observeUntil - v.now);
    $('#countdown').textContent = s.inferringSince ? 'Working out what you’re doing…' : `No answer? I’ll guess in ${fmt(left)} and check with you.`;
  }

  if (s.mode === 'active') {
    const c = s.current;
    const now = $('#now');
    if (!c) now.replaceChildren(el('div', { className: 'why', textContent: 'Chrome isn’t in front, or you’ve been idle. The clock is paused.' }));
    else if (c.neutral) now.replaceChildren(el('div', { className: 'why', textContent: 'On a browser page. Not counted either way.' }));
    else {
      let why = c.reason || 'Checking…';
      if (s.driftStart && (c.verdict === 'off' || c.verdict === 'ambiguous')) why += ` · drifting for ${fmt(v.now - s.driftStart)}`;
      now.replaceChildren(el('div', { className: 'where', textContent: c.domain }), el('div', { className: 'why', textContent: why }));
    }
    $('#on-time').textContent = fmt(s.stats.onMs);
    $('#off-time').textContent = fmt(s.stats.offMs + s.stats.ambiguousMs);
    $('#drifts').textContent = String(s.stats.drifts);
    const list = $('#drift-list');
    list.replaceChildren(
      ...(s.topDrift.length
        ? s.topDrift.map((d) => el('li', {}, [el('span', { textContent: d.domain }), el('span', { textContent: fmt(d.ms) })]))
        : [el('li', { className: 'muted', textContent: 'Nowhere yet' })]),
    );
  }
}

async function refresh(force = false) {
  view = await send({ type: 'get-view' });
  if (!view?.state) return;
  const s = view.state;
  const key = [s.mode, s.task, s.guess, s.prompt?.id, editingTask, s.timer?.kind, s.timer?.phase].join('|');
  if (force || key !== renderedKey) {
    renderedKey = key;
    build(view);
  }
  update(view);
}

const WATCHER_TEXT = {
  watching: 'watching the screen',
  idle: 'ready to watch the screen',
  'no-permission': 'screen watching needs permission',
  'no-model': 'screen watching needs the model',
  off: 'screen watching off',
  error: 'screen watcher error',
};

// A QR code as SVG. Always dark on white, whatever the theme, so it scans.
function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const margin = 3;
  const size = n + margin * 2;
  let path = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) path += `M${x + margin} ${y + margin}h1v1h-1z`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code for pairing a phone');
  svg.innerHTML = `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/>`;
  return svg;
}

function ago(ms) {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

let phonesKey = '';
let pairOpen = false;

function updateCompanion(v) {
  const sync = v.sync ?? { status: 'off' };
  const hub = sync.status === 'connected' ? sync.hub : null;
  const where = sync.computer?.name ? ` on ${sync.computer.name}` : '';
  let text;
  if (hub) {
    text = `Running${where} · ${WATCHER_TEXT[hub.watcher.status] ?? hub.watcher.status}`;
    if (['no-permission', 'no-model', 'error'].includes(hub.watcher.status) && hub.watcher.detail) text += `: ${hub.watcher.detail}`;
  } else if (sync.status === 'not-installed') text = 'Not set up yet.';
  else if (sync.status === 'error') text = sync.detail || 'Wrong pairing code';
  else if (sync.status === 'starting') text = 'Starting…';
  else if (sync.paired) text = 'Not connected. Is the companion running?';
  else text = 'Not set up yet.';
  $('#companion-status').textContent = text;
  $('#companion-setup').hidden = !!hub || (sync.paired && sync.status !== 'not-installed' && sync.status !== 'error');

  // Paired phones, rebuilt only when something about them changes.
  const phones = hub?.devices.phones ?? [];
  const key = JSON.stringify(phones.map((p) => [p.id, p.name, p.connected, Math.round((v.now - p.lastSeen) / 60_000)]));
  if (key !== phonesKey) {
    phonesKey = key;
    $('#phones').replaceChildren(
      ...phones.map((p) => {
        const forget = el('button', { className: 'link', textContent: 'Forget', title: `Unpair ${p.name}` });
        forget.onclick = () => send({ type: 'forget-phone', phoneId: p.id });
        return el('li', {}, [
          el('span', {}, [el('span', { className: 'phone-name', textContent: p.name }), ` · ${p.connected ? 'connected' : `seen ${ago(v.now - p.lastSeen)}`}`]),
          forget,
        ]);
      }),
    );
  }
  const pairButton = $('#pair-phone');
  pairButton.hidden = !hub;
  pairButton.textContent = pairOpen ? 'Done' : phones.length ? 'Phone QR code (open or pair)' : 'Pair a phone';
  if (!hub) pairOpen = false;
  $('#pair-panel').hidden = !pairOpen;
}

function openPairPanel(v) {
  const sync = v.sync;
  const link = sync.pairUrl;
  $('#pair-qr').replaceChildren(link ? qrSvg(link) : el('p', { className: 'muted small', textContent: 'Restart the companion to get a pairing link.' }));
  const c = sync.computer;
  $('#pair-manual').textContent = c ? `Can’t scan? In the app, tap Pair manually and enter ${c.host || c.addresses?.[0] || 'this Mac’s address'} and code ${sync.code ?? ''}.` : '';
}

async function initSettings() {
  const v = await send({ type: 'get-view' });
  $('#dwell').value = String(v.settings.dwellSeconds);
  $('#dwell').onchange = (e) => send({ type: 'save-settings', settings: { dwellSeconds: Number(e.target.value) } });
  $('#timer').value = v.settings.timer;
  $('#idle').value = String(v.settings.idleMinutes);
  $('#sound').checked = v.settings.sound;
  const showCustom = () => ($('#custom-times').hidden = $('#timer').value !== 'custom');
  $('#custom-focus').value = String(v.settings.customFocusMin);
  $('#custom-break').value = String(v.settings.customBreakMin);
  showCustom();
  $('#timer').onchange = (e) => {
    showCustom();
    send({ type: 'save-settings', settings: { timer: e.target.value } });
  };
  const minutes = (input, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(input.value) || lo)));
  $('#custom-focus').onchange = (e) => send({ type: 'save-settings', settings: { customFocusMin: minutes(e.target, 5, 180) } });
  $('#custom-break').onchange = (e) => send({ type: 'save-settings', settings: { customBreakMin: minutes(e.target, 1, 60) } });
  $('#idle').onchange = (e) => send({ type: 'save-settings', settings: { idleMinutes: Number(e.target.value) } });
  $('#sound').onchange = (e) => send({ type: 'save-settings', settings: { sound: e.target.checked } });
  $('#test-sound').onclick = () => send({ type: 'test-sound' });
  $('#pair-phone').onclick = () => {
    pairOpen = !pairOpen;
    if (pairOpen && view) openPairPanel(view);
    refresh();
  };
  $('#companion-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await send({ type: 'pair-companion', code: $('#companion-code').value });
    $('#companion-code').value = '';
    setTimeout(() => refresh(true), 400);
  });
}

initSettings();
refresh(true);
setInterval(refresh, 1000);
