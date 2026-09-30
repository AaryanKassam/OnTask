// Toolbar panel: live status, task, stats, and settings. Polls the background
// once a second while open; rebuilds the body only when the mode changes so
// typing in a field isn't interrupted.

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
      el('p', { className: 'lead', textContent: 'Watching your tabs' }),
      el('p', { className: 'muted', id: 'countdown' }),
      el('div', { className: 'actions' }, [guessNow, stopButton('Turn off')]),
      taskForm({ label: 'Or just tell me', placeholder: 'e.g. CS 246 assignment', button: 'Set', type: 'set-task' }),
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
      el('p', { className: 'muted', textContent: s.guessEngine === 'claude' ? 'Guessed by Claude from your recent tabs.' : 'Guessed from the words in your recent tab titles.' }),
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
    );
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
    pill = s.current ? VERDICT_TEXT[verdict] ?? 'Checking…' : 'Away';
    cls = verdict ?? '';
  }
  status.textContent = pill;
  status.className = `pill ${cls}`;

  if (s.mode === 'observing') {
    const left = Math.max(0, s.observeUntil - v.now);
    $('#countdown').textContent = s.inferringSince ? 'Working out what you’re doing…' : `I’ll guess what you’re doing in ${fmt(left)}.`;
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

  const error = $('#error');
  error.hidden = !s.lastError;
  error.textContent = s.lastError || '';

  $('#engine').textContent = v.settings.hasKey
    ? `Using Claude (${v.settings.model}). Only each tab’s domain and title are sent. History and your allow-list stay on this machine.`
    : 'Using local keyword matching. Nothing leaves this machine. Add a Claude API key for better guesses and judgments.';
}

async function refresh(force = false) {
  view = await send({ type: 'get-view' });
  if (!view?.state) return;
  const s = view.state;
  const key = [s.mode, s.task, s.guess, s.prompt?.id, editingTask].join('|');
  if (force || key !== renderedKey) {
    renderedKey = key;
    build(view);
  }
  update(view);
}

async function initSettings() {
  const v = await send({ type: 'get-view' });
  $('#dwell').value = String(v.settings.dwellSeconds);
  $('#observe').value = String(v.settings.observeSeconds);
  $('#api-key').placeholder = v.settings.hasKey ? 'Saved. Paste a new key to replace, or clear it' : 'sk-ant-…';
  $('#dwell').onchange = (e) => send({ type: 'save-settings', settings: { dwellSeconds: Number(e.target.value) } });
  $('#observe').onchange = (e) => send({ type: 'save-settings', settings: { observeSeconds: Number(e.target.value) } });
  $('#key-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const apiKey = $('#api-key').value.trim();
    await send({ type: 'save-settings', settings: { apiKey } });
    $('#api-key').value = '';
    $('#api-key').placeholder = apiKey ? 'Saved. Paste a new key to replace, or clear it' : 'sk-ant-…';
    refresh(true);
  });
}

initSettings();
refresh(true);
setInterval(refresh, 1000);
