import Layout from './core/layout.mjs';
import Render from './core/render.mjs';
import { ensurePageFonts } from './font-readiness.mjs';

// Positions are in final output pixels; gutters preserve the downsampling filter
// around tile boundaries. The legacy renderer still owns all layout decisions.
export function tilePlan(size, tileSize = 512, gutter = 8, superSample = 4) {
  if (![size, tileSize, superSample].every(n => Number.isInteger(n) && n > 0) ||
      !Number.isInteger(gutter) || gutter < 0 || size > 2400 || superSample > 4) {
    throw new RangeError('Unsupported output dimensions');
  }
  const tiles = [];
  for (let y = 0; y < size; y += tileSize) {
    for (let x = 0; x < size; x += tileSize) {
      const width = Math.min(tileSize, size - x);
      const height = Math.min(tileSize, size - y);
      tiles.push({ x, y, width, height, paddedWidth: width + gutter * 2,
        paddedHeight: height + gutter * 2 });
    }
  }
  const scratchPixels = Math.max(...tiles.map(t =>
    t.paddedWidth * t.paddedHeight * (superSample ** 2 + 1)));
  return { size, tiles, gutter, superSample,
    estimatedPixelBytes: (size * size + scratchPixels) * 4 };
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  if (!canvas.getContext('2d')) throw new Error('描画領域を確保できませんでした');
  return canvas;
}

export function releaseCanvas(canvas) {
  if (canvas) { canvas.width = 0; canvas.height = 0; }
}

// The original renderer expects the page color on its first slot. Adapt only at
// this boundary; persistent/editor state keeps one color on the page itself.
export function drawPage(ctx, page, images) {
  const slots = page.slots.map((slot, i) => i === 0 ? { ...slot, bgColor: page.bgColor } : slot);
  Render.drawPage(ctx, { ...page, slots }, images);
}

export async function renderTiled(page, images, { size = 2400, signal, onProgress } = {}) {
  const plan = tilePlan(size);
  signal?.throwIfAborted();
  await ensurePageFonts(page);
  signal?.throwIfAborted();
  const output = makeCanvas(size, size);
  const scratch = makeCanvas(1, 1);
  const reduced = makeCanvas(1, 1);
  const out = output.getContext('2d');
  out.imageSmoothingEnabled = false;
  const { gutter, superSample: ss } = plan;
  const scale = size / Layout.CANVAS;
  try {
    for (let i = 0; i < plan.tiles.length; i++) {
      signal?.throwIfAborted();
      const tile = plan.tiles[i];
      scratch.width = tile.paddedWidth * ss;
      scratch.height = tile.paddedHeight * ss;
      const ctx = scratch.getContext('2d');
      if (!ctx) throw new Error('描画領域を確保できませんでした');
      ctx.setTransform(scale * ss, 0, 0, scale * ss,
        (gutter - tile.x) * ss, (gutter - tile.y) * ss);
      drawPage(ctx, page, images);
      reduced.width = tile.paddedWidth;
      reduced.height = tile.paddedHeight;
      const down = reduced.getContext('2d');
      down.imageSmoothingEnabled = true;
      down.imageSmoothingQuality = 'high';
      down.drawImage(scratch, 0, 0, reduced.width, reduced.height);
      out.drawImage(reduced, gutter, gutter, tile.width, tile.height,
        tile.x, tile.y, tile.width, tile.height);
      onProgress?.(i + 1, plan.tiles.length);
      // Permit input, cancellation and painting between bounded allocations.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    signal?.throwIfAborted();
    return { canvas: output, plan };
  } catch (error) {
    releaseCanvas(output);
    throw error;
  } finally {
    releaseCanvas(scratch);
    releaseCanvas(reduced);
  }
}

export function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNGを生成できませんでした')), 'image/png');
    } catch (error) { reject(error); }
  });
}
