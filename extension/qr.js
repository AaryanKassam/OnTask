// A QR code as an SVG element. Always dark on white, whatever the theme,
// so phone cameras can read it.

import qrcode from './vendor/qrcode.mjs';

export function qrSvg(text, label = 'QR code') {
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
  svg.setAttribute('aria-label', label);
  svg.innerHTML = `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/>`;
  return svg;
}
