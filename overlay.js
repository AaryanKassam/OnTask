// The on-page prompt. Injected into the active tab by the background worker,
// and loaded directly by prompt.html for pages extensions can't draw on.
// Rendered in a closed shadow root so the host page's CSS can't reach it.

(() => {
  if (window.__onTaskOverlay) return;

  const CSS = `
    :host { all: initial; }
    .card {
      --bg: #ffffff; --fg: #17191c; --muted: #5b626b; --line: #e2e5e9; --hover: #f3f4f6;
      --accent: #1f5c42; --accent-hover: #184a35; --warn: #c2410c; --field: #ffffff;
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: 340px; box-sizing: border-box; padding: 16px 18px 16px;
      background: var(--bg); color: var(--fg);
      border: 1px solid var(--line); border-radius: 12px;
      box-shadow: 0 14px 36px rgba(15, 20, 25, 0.18), 0 2px 6px rgba(15, 20, 25, 0.08);
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      text-align: left; animation: enter 160ms ease-out;
    }
    .card.embedded { position: static; width: auto; border: 0; box-shadow: none; animation: none; padding: 20px; }
    @keyframes enter { from { opacity: 0; transform: translateY(8px); } }
    @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
    .top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .eyebrow { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600;
      letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
    .drift .dot { background: var(--warn); }
    .close { all: unset; cursor: pointer; color: var(--muted); font-size: 18px; line-height: 1;
      width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; }
    .close:hover { background: var(--hover); color: var(--fg); }
    h2 { margin: 0 0 6px; font-size: 16px; font-weight: 600; line-height: 1.35; color: var(--fg); }
    p { margin: 0 0 14px; color: var(--muted); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    button.btn { font: inherit; font-size: 13px; font-weight: 600; border-radius: 8px; padding: 8px 12px;
      cursor: pointer; border: 1px solid transparent; }
    .btn.primary { background: var(--accent); color: #fff; }
    .btn.primary:hover { background: var(--accent-hover); }
    .btn.secondary { background: var(--bg); color: var(--fg); border-color: var(--line); }
    .btn.secondary:hover { background: var(--hover); }
    .link { all: unset; cursor: pointer; margin-top: 12px; font-size: 12px; color: var(--muted); text-decoration: underline; }
    .link:hover { color: var(--fg); }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    input { box-sizing: border-box; width: 100%; margin: 0 0 12px; padding: 8px 10px; font: inherit; font-size: 14px;
      color: var(--fg); background: var(--field); border: 1px solid var(--line); border-radius: 8px; }
    @media (prefers-color-scheme: dark) {
      .card { --bg: #1c1f23; --fg: #eceef0; --muted: #a2a9b1; --line: #33383e; --hover: #262a2f;
        --accent: #2f8a62; --accent-hover: #34996c; --warn: #f0803c; --field: #14171a; }
    }
  `;

  let host = null;

  function hide() {
    host?.remove();
    host = null;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  }

  function since(ts) {
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 90) return `${s} seconds`;
    const m = Math.round(s / 60);
    return `${m} minute${m === 1 ? '' : 's'}`;
  }

  function show(p, opts = {}) {
    hide();
    host = document.createElement('ontask-prompt');
    const root = host.attachShadow({ mode: 'closed' });
    const card = el('div', { className: `card ${p.kind}${opts.embedded ? ' embedded' : ''}` });
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-live', 'polite');
    root.append(el('style', { textContent: CSS }), card);

    const answer = (action, value) => {
      chrome.runtime.sendMessage({ type: 'answer', promptId: p.id, action, value });
      hide();
      opts.onDone?.();
    };

    const header = (closeAction, closeLabel) =>
      el('div', { className: 'top' }, [
        el('div', { className: 'eyebrow' }, [el('span', { className: 'dot' }), 'OnTask']),
        el('button', { className: 'close', textContent: '×', title: closeLabel, ariaLabel: closeLabel, onclick: () => answer(closeAction) }),
      ]);

    const button = (text, cls, onclick, title) => el('button', { className: `btn ${cls}`, textContent: text, onclick, title: title || '' });

    if (p.kind === 'confirm') {
      const ask = () => {
        card.replaceChildren(
          header('confirm-later', 'Ask me again later'),
          el('h2', { textContent: `Are you working on “${p.guess}”?` }),
          el('p', { textContent: 'Guessed from your last few minutes of tabs. I’ll stay quiet unless you drift for a while.' }),
          el('div', { className: 'actions' }, [
            button('Yes, stay on task', 'primary', () => answer('confirm-yes')),
            button('No', 'secondary', correct),
          ]),
        );
      };
      const correct = () => {
        const input = el('input', { placeholder: 'e.g. CS 246 assignment', ariaLabel: 'What are you working on?' });
        const submit = () => input.value.trim() && answer('confirm-correct', input.value.trim());
        input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
        card.replaceChildren(
          header('confirm-later', 'Ask me again later'),
          el('h2', { textContent: 'What are you working on?' }),
          input,
          el('div', { className: 'actions' }, [
            button('Start', 'primary', submit),
            button('Keep watching', 'secondary', () => answer('confirm-later'), 'Watch for another minute and guess again'),
          ]),
        );
        input.focus();
      };
      ask();
    } else {
      const detail = `You’ve been away from “${p.task}” for ${since(p.driftStart)}. Right now you’re on ${p.domain}.`;
      card.replaceChildren(
        header('drift-snooze', 'Remind me in 5 minutes'),
        el('h2', { textContent: 'You’re off task' }),
        el('p', { textContent: detail }),
        el('div', { className: 'actions' }, [
          button('Back to task', 'primary', () => answer('drift-back')),
          button('Yes, this counts', 'secondary', () => answer('drift-allow'), `Stop flagging ${p.domain} for this session`),
        ]),
        el('button', { className: 'link', textContent: 'Give me 5 more minutes', onclick: () => answer('drift-snooze') }),
      );
    }

    (document.body || document.documentElement).append(host);
  }

  window.__onTaskOverlay = { show, hide };
})();
