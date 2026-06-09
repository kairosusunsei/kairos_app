/**
 * QR code as inline SVG <g> (for embedding in share-card SVG).
 */
const QRCode = require('qrcode');

/**
 * @param {string} data
 * @param {number} x top-left x in parent SVG
 * @param {number} y top-left y in parent SVG
 * @param {number} size total width/height
 * @param {string} [fill] module color
 * @returns {string} SVG fragment
 */
function buildQrSvgGroup(data, x, y, size, fill) {
  const text = String(data || '').trim();
  if (!text) return '';

  const moduleFill = fill || '#fdf8f0';
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const modules = qr.modules;
  const count = modules.size;
  if (!count) return '';

  const cell = size / count;
  const pad = cell * 0.08;
  const inner = size - pad * 2;
  const innerCell = inner / count;

  let rects = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!modules.get(row, col)) continue;
      const rx = x + pad + col * innerCell;
      const ry = y + pad + row * innerCell;
      rects += `<rect x="${rx.toFixed(2)}" y="${ry.toFixed(2)}" width="${innerCell.toFixed(2)}" height="${innerCell.toFixed(2)}" fill="${moduleFill}"/>`;
    }
  }

  return `<g aria-label="QR code">
  <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="8" fill="#0f0731" stroke="#9b773d" stroke-width="2"/>
  ${rects}
</g>`;
}

module.exports = { buildQrSvgGroup };
