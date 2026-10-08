// Fallback for pages the overlay can't be injected into (new tab, chrome://).
const view = await chrome.runtime.sendMessage({ type: 'get-prompt' });
if (view) window.__onTaskOverlay.show(view, { embedded: true, onDone: () => window.close() });
else window.close();
