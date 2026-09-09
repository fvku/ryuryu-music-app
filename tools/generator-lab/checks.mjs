import Fonts from './core/fonts.mjs';
import { demoPages, loadImage } from './model.mjs';
import { renderTiled, drawPage, releaseCanvas, canvasBlob } from './tiled-renderer.mjs';
import { ensurePageFonts } from './font-readiness.mjs';
const result = document.getElementById('result');
const run = document.getElementById('run');
const pages = demoPages();
let images;
try {
  const [, jacket, wave] = await Promise.all([Fonts.loadAll(), loadImage('./assets/jacket_2000.webp'), loadImage('./assets/waves/wave2608.png')]);
  for (const page of Object.values(pages)) for (const slot of page.slots) slot.jacket.img = jacket;
  images = { wave };
  run.disabled = false; result.textContent = '比較できます';
} catch (error) { result.textContent = error.message; }

run.addEventListener('click', async () => {
  run.disabled = true;
  const records = [];
  document.querySelectorAll('.comparison').forEach(node => node.remove());
  try {
    const size = Number(document.getElementById('check-size').value);
    for (const page of Object.values(pages)) {
      result.textContent = `${page.kind} ${size}px を比較しています…`;
      await ensurePageFonts(page);
      const big = document.createElement('canvas');
      const baseline = document.createElement('canvas');
      let tiled;
      try {
        big.width = big.height = size * 4;
        const ctx = big.getContext('2d');
        ctx.scale(size / 1200 * 4, size / 1200 * 4);
        drawPage(ctx, page, images);
        baseline.width = baseline.height = size;
        const bctx = baseline.getContext('2d', { willReadFrequently: true });
        bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'high';
        bctx.drawImage(big, 0, 0, size, size);
        releaseCanvas(big);
        const t0 = performance.now();
        tiled = await renderTiled(page, images, { size });
        const a = bctx.getImageData(0, 0, size, size).data;
        const b = tiled.canvas.getContext('2d').getImageData(0, 0, size, size).data;
        let max = 0, total = 0, changed = 0, aboveTwo = 0;
        const bounds = [size, size, 0, 0];
        for (let i = 0; i < a.length; i += 4) {
          let pixelMax = 0;
          for (let c = 0; c < 4; c++) { const delta = Math.abs(a[i+c] - b[i+c]); total += delta; pixelMax = Math.max(pixelMax, delta); }
          max = Math.max(max, pixelMax);
          if (pixelMax) changed++;
          if (pixelMax > 2) {
            aboveTwo++;
            const x = (i / 4) % size, y = Math.floor(i / 4 / size);
            bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
            bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
          }
        }
        const blob = await canvasBlob(tiled.canvas);
        records.push({ mode: page.kind, size, maxChannelDifference: max,
          meanChannelDifference: total / a.length, changedPixels: changed, pixelsAboveTwo: aboveTwo,
          bounds, pngBytes: blob.size, renderMs: Math.round(performance.now() - t0),
          pixelMemoryMiB: +(tiled.plan.estimatedPixelBytes / 1024 ** 2).toFixed(1) });
        const compare = document.createElement('section'); compare.className = 'comparison';
        const title = document.createElement('h2'); title.textContent = `${page.kind}: 左が従来、右が区画描画`;
        compare.append(title);
        for (const source of [baseline, tiled.canvas]) {
          const preview = document.createElement('canvas'); preview.width = preview.height = 600;
          preview.style.width = '48%'; preview.style.height = 'auto';
          preview.getContext('2d').drawImage(source, 0, 0, 600, 600); compare.append(preview);
        }
        document.body.append(compare);
      } finally { releaseCanvas(big); releaseCanvas(baseline); releaseCanvas(tiled?.canvas); }
    }
    result.textContent = JSON.stringify({ browser: navigator.userAgent, comparisons: records }, null, 2);
  } catch (error) { result.textContent = `比較失敗: ${error.message}`; }
  finally { run.disabled = false; }
});
