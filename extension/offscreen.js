// Plays the alert chime for the background worker, which has no audio of its
// own. Synthesised, so there's no sound file to ship: two soft bell notes.

function chime() {
  const ctx = new AudioContext();
  const notes = [
    { freq: 659.25, at: 0, dur: 1.0 },
    { freq: 880, at: 0.18, dur: 1.2 },
  ];
  for (const { freq, at, dur } of notes) {
    for (const [harmonic, level] of [[1, 0.22], [2, 0.07], [3, 0.025]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + at;
      osc.frequency.value = freq * harmonic;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur);
    }
  }
  setTimeout(() => ctx.close(), 1600);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  if (msg.type === 'chime') chime();
  sendResponse({ ok: true });
  return false;
});
