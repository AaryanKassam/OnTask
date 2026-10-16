// The Devices tab: every phone paired with this computer, which ones follow
// OnTask sessions, and pairing a new one.

import { qrSvg } from './qr.js';

const $ = (sel) => document.querySelector(sel);
const send = (msg) => chrome.runtime.sendMessage(msg);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function ago(ms) {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

const WATCHER = {
  watching: 'watching your screen',
  idle: 'ready to watch your screen during sessions',
  'no-permission': 'needs Screen Recording permission for Google Chrome (System Settings → Privacy & Security)',
  'no-model': 'needs the screen model: run Set Up OnTask.command again',
  off: 'screen watching off',
  error: 'screen watcher error',
};

let listKey = '';
let pairOpen = false;
let qrFor = '';
let knownIds = null;

function renderComputer(sync) {
  const hub = sync.status === 'connected' ? sync.hub : null;
  const name = sync.computer?.name ?? 'This Mac';
  let text;
  if (hub) text = `${name} · companion running · ${WATCHER[hub.watcher.status] ?? hub.watcher.status}`;
  else if (sync.status === 'starting' || sync.status === 'connecting') text = 'Starting the companion…';
  else if (sync.status === 'not-installed' || !sync.paired) text = 'The companion isn’t set up yet.';
  else text = 'The companion isn’t running. Reload OnTask in chrome://extensions, or run Set Up OnTask.command again.';
  $('#computer-status').textContent = text;
  $('#setup').hidden = !!hub || sync.status === 'starting' || sync.status === 'connecting';
}

function renderDevices(sync, now) {
  const hub = sync.status === 'connected' ? sync.hub : null;
  const phones = hub?.devices.phones ?? [];
  $('#devices-card').hidden = !hub;
  $('#no-devices').hidden = phones.length > 0;

  // A phone that just paired: close the pairing panel.
  const ids = phones.map((p) => p.id);
  if (knownIds && ids.some((id) => !knownIds.includes(id))) pairOpen = false;
  knownIds = ids;

  // Don't rebuild while a name is being edited.
  if (document.activeElement?.classList.contains('name')) return;
  const key = JSON.stringify(phones.map((p) => [p.id, p.name, p.connected, p.active, Math.round((now - p.lastSeen) / 60_000)]));
  if (key === listKey) return;
  listKey = key;

  $('#devices').replaceChildren(
    ...phones.map((p) => {
      const name = el('input', { className: 'name', value: p.name, ariaLabel: 'Device name', maxLength: 40, spellcheck: false });
      const save = () => {
        const v = name.value.trim();
        if (v && v !== p.name) send({ type: 'rename-phone', phoneId: p.id, name: v });
        else name.value = p.name;
      };
      name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());
      name.addEventListener('blur', save);

      const toggle = el('input', { type: 'checkbox', checked: p.active, ariaLabel: `${p.name} follows OnTask sessions` });
      toggle.addEventListener('change', () => send({ type: 'set-phone-active', phoneId: p.id, active: toggle.checked }));

      const forget = el('button', { className: 'link', type: 'button', textContent: 'Forget', title: `Unpair ${p.name}` });
      forget.onclick = () => {
        if (confirm(`Unpair ${p.name}? You’d need to scan the QR code again to pair it.`)) send({ type: 'forget-phone', phoneId: p.id });
      };

      const status = p.connected ? 'Connected now' : `Last seen ${ago(now - p.lastSeen)}`;
      return el('li', { className: 'device' }, [
        el('div', { className: 'info' }, [
          name,
          el('div', { className: 'status' }, [el('span', { className: `dot${p.connected ? ' live' : ''}` }), `${status}${p.active ? '' : ' · switched off'}`]),
        ]),
        el('label', { className: 'switch' }, [toggle, 'Active']),
        forget,
      ]);
    }),
  );
}

function renderPair(sync) {
  const hub = sync.status === 'connected' ? sync.hub : null;
  $('#pair-toggle').hidden = !hub;
  $('#pair-toggle').textContent = pairOpen ? 'Done' : 'Pair a phone';
  $('#pair').hidden = !(hub && pairOpen);
  if (!hub || !pairOpen) return;
  if (sync.pairUrl && sync.pairUrl !== qrFor) {
    qrFor = sync.pairUrl;
    $('#qr').replaceChildren(qrSvg(sync.pairUrl, 'QR code for pairing a phone with OnTask'));
  }
  const c = sync.computer;
  $('#manual').textContent = c ? `Can’t scan it? In the OnTask app tap Pair → Pair manually, and enter ${c.host || c.addresses?.[0] || 'this Mac’s address'} with code ${sync.code ?? ''}.` : '';
}

async function refresh() {
  const view = await send({ type: 'get-view' });
  if (!view) return;
  const sync = view.sync ?? { status: 'off' };
  // With nothing paired yet, open straight to pairing.
  if (knownIds === null && sync.status === 'connected' && !(sync.hub?.devices.phones ?? []).length) pairOpen = true;
  renderComputer(sync);
  renderDevices(sync, view.now);
  renderPair(sync);
}

$('#pair-toggle').addEventListener('click', () => {
  pairOpen = !pairOpen;
  refresh();
});

refresh();
setInterval(refresh, 1500);
