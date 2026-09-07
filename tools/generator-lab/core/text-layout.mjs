import L from './layout.mjs';
import T from './textEngine.mjs';
import { defaultLeading } from './field-type.mjs';

function linesOf(ctx, text, base, style = {}, width = Infinity, jp) {
  const spec = { ...base, tracking: style.tracking || 0, kerns: style.kerns || {} };
  const japanese = jp ? { ...jp, tracking: style.tracking || 0, kerns: style.kerns || {} } : null;
  const result = []; let offset = 0;
  for (const paragraph of String(text ?? '').split('\n')) {
    const cls = T.toClusters(T.applyCase(paragraph, spec.case));
    for (const cl of cls) cl.at += offset;
    if (japanese) T.prepareMixed(ctx, cls, japanese, spec); else T.prepare(ctx, cls, spec);
    const wrapped = cls.length ? T.wrap(ctx, cls, spec, width) : [[]];
    for (const clusters of wrapped) result.push({ clusters, width: T.widthOf(clusters), spec, mixed: !!japanese });
    offset += paragraph.length + 1;
  }
  return result;
}

function drawLine(ctx, line, x, y) {
  if (line.mixed) T.drawMixedClusters(ctx, line.clusters, x, y);
  else T.drawClusters(ctx, line.clusters, line.spec, x, y, 0, L.renderWeightOf(line.spec));
}

export function titleLayout(ctx, d, cell) {
  const type = d.typography || {};
  const width = cell.w - 2 * L.TEXT_RULE.titleInsetX;
  const title = linesOf(ctx, d.title, L.TYPE.title, type.title, width, L.TYPE.titleJP);
  const artist = linesOf(ctx, d.artist, L.TYPE.artist, type.artist, width, L.TYPE.artistJP);
  const titleLead = (type.title?.leading ?? defaultLeading('title')) * L.TYPE.title.size;
  const artistLead = (type.artist?.leading ?? defaultLeading('artist')) * L.TYPE.artist.size;
  const first = cell.y + cell.h / 2 + L.TEXT_RULE.blockK - titleLead * title.length / 2 - artistLead * (artist.length - 1) / 2;
  const artistFirst = first + titleLead * (title.length - 1) + L.TEXT_RULE.artistGap;
  const overflow = [...title, ...artist].some(line => line.width > width) ||
    first - L.TYPE.title.size < cell.y || artistFirst + artistLead * (artist.length - 1) + L.TYPE.artist.size * .25 > cell.y + cell.h;
  return { title, artist, titleLead, artistLead, first, artistFirst, overflow, cell };
}

export function drawTitleLayout(ctx, layout) {
  const { cell } = layout;
  ctx.save(); ctx.beginPath(); ctx.rect(cell.x + L.TEXT_RULE.titleInsetX, cell.y,
    cell.w - 2 * L.TEXT_RULE.titleInsetX, cell.h); ctx.clip();
  const x = cell.x + L.TEXT_RULE.titleInsetX;
  layout.title.forEach((line, i) => drawLine(ctx, line, x, layout.first + i * layout.titleLead));
  layout.artist.forEach((line, i) => drawLine(ctx, line, x, layout.artistFirst + i * layout.artistLead));
  ctx.restore();
}

export function bandLayout(ctx, segments, base, cell, typography = {}, preferredGap = 50) {
  const margin = L.TEXT.bodyPad; // Keep frame padding; separator gaps may shrink independently to zero.
  const parts = segments.map(segment => {
    const style = typography[segment.key] || {};
    const spec = { ...base, case: segment.case || base.case };
    const kerns = segment.prefix ? Object.fromEntries(Object.entries(style.kerns || {}).map(([i, n]) => [+i + segment.prefix, n])) : style.kerns;
    const lines = linesOf(ctx, segment.text, spec, { ...style, kerns });
    const lead = (style.leading ?? 1.2) * base.size;
    return { key: segment.key || null, lines, lead, width: Math.max(0, ...lines.map(line => line.width)), height: base.size + (lines.length - 1) * lead };
  });
  const available = cell.w - 2 * margin;
  const widths = parts.reduce((n, p) => n + p.width, 0);
  const gaps = Math.max(0, parts.length - 1);
  const gap = gaps ? Math.max(0, Math.min(preferredGap, (available - widths) / gaps)) : 0;
  const total = widths + gap * gaps;
  return { parts, gap, margin, total, cell,
    overflow: total > available + .01 || parts.some(part => part.height > cell.h) };
}

export function drawBandLayout(ctx, layout) {
  const { cell, margin, gap, total } = layout;
  ctx.save(); ctx.beginPath(); ctx.rect(cell.x + margin, cell.y, cell.w - 2 * margin, cell.h); ctx.clip();
  let x = cell.x + (cell.w - total) / 2;
  for (const part of layout.parts) {
    const baseline = cell.y + cell.h / 2 + 13 - part.lead * (part.lines.length - 1) / 2;
    part.lines.forEach((line, i) => drawLine(ctx, line, x + (part.width - line.width) / 2, baseline + i * part.lead));
    x += part.width + gap;
  }
  ctx.restore();
}
