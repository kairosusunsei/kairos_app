/**
 * SVG → PNG（OG / シェアカード用）。@resvg/resvg-js が無い環境では null を返す。
 */

let Resvg = null;
try {
  // eslint-disable-next-line global-require
  Resvg = require('@resvg/resvg-js').Resvg;
} catch (_) {
  Resvg = null;
}

/**
 * @param {string} svg
 * @param {{ width?: number, height?: number }} [opts]
 * @returns {Buffer|null}
 */
function rasterizeSvgToPng(svg, opts) {
  if (!Resvg || !svg) return null;
  const width = opts && opts.width ? Number(opts.width) : undefined;
  const height = opts && opts.height ? Number(opts.height) : undefined;
  try {
    const init = { fitTo: width ? { mode: 'width', value: width } : undefined };
    if (!width && height) {
      init.fitTo = { mode: 'height', value: height };
    }
    const resvg = new Resvg(svg, init);
    const rendered = resvg.render();
    return Buffer.from(rendered.asPng());
  } catch (err) {
    console.error('[rasterizeSvgToPng]', err.message);
    return null;
  }
}

function isRasterizeAvailable() {
  return Boolean(Resvg);
}

module.exports = {
  rasterizeSvgToPng,
  isRasterizeAvailable,
};
