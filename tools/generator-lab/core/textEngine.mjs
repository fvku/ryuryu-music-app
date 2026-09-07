// ============================================================
// textEngine.js — Canvas 2D 上で組版する
// SPEC.md §2 の必須条件により、CSS が肩代わりしていたもの（折り返し・行送り・
// 禁則・均等割り付け・約物の詰め）はすべてここで自前に持つ。
// 描画の入り口は drawClusters に一本化してあり、Phase 4 でグリフのパス描画に
// 差し替えるならここだけを置き換える。
// ============================================================
const TextEngine = (() => {

  // ---- textCase（Figma が表示時に変換しているものと同じ挙動）----
  function applyCase(s, mode) {
    if (mode === 'UPPER') return s.toUpperCase();
    if (mode === 'TITLE') return s.replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1));
    return s;
  }

  // ---- 禁則 ----
  const NO_LINE_START = '、。，．・：；？！ゝゞーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ）〕］｝〉》」』】”’〟…‥';
  const NO_LINE_END   = '（〔［｛〈《「『【“‘〝';

  // ---- クラスタ分割 ----
  // 和文は1文字＝1クラスタ、欧文は1単語＝1クラスタ（単語内のカーニングを保つため）。
  // 空白はクラスタの区切りとして扱い、直前のクラスタに空白ぶんの送りとして持たせる。
  const LATIN = /[A-Za-z0-9À-ɏ'’\-–—.,&()\/]/;
  // cl.at / cl.len は元の文字列でのクラスタの位置と長さ。
  // 文字ごとのカーニング（SPEC.md §5）を、どの文字に効かせるか決めるのに使う。
  function toClusters(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === ' ') { if (out.length) { const p = out[out.length - 1]; p.space = true; p.len++; } i++; continue; }
      if (LATIN.test(ch)) {
        let j = i;
        while (j < s.length && LATIN.test(s[j])) j++;
        out.push({ text: s.slice(i, j), space: false, latin: true, at: i, len: j - i });
        i = j;
      } else {
        out.push({ text: ch, space: false, latin: false, at: i, len: 1 });
        i++;
      }
    }
    return out;
  }

  /**
   * 文字ごとのカーニング。`t.kerns` は 文字の位置 → 詰め量（em）の対応表。
   * クラスタがまたぐ文字ぶんを合計して、そのクラスタの送り幅に足す。
   * Figma の「範囲を選んで手でカーニング」に対応する（SPEC.md §5）。
   */
  function kernOf(cl, t) {
    const k = t.kerns;
    if (!k || cl.at == null) return 0;
    let sum = 0;
    for (let i = cl.at; i < cl.at + cl.len; i++) if (k[i]) sum += k[i];
    return sum * t.size;
  }

  // weightOverride: SPEC.md §9.5 approach2 用。指定があれば見た目の描画だけそのウェイトにする。
  // 送り幅の計測（prepare）は常に t.weight を使うので、ここを変えても位置・行分割は変わらない。
  function fontString(t, weightOverride) {
    const w = weightOverride != null ? weightOverride : t.weight;
    return `${w} ${t.size}px "${t.family}"`;
  }

  // クラスタ1つぶんの送り幅を確定させる。折り返し・均等割り付け・描画は
  // すべてこの値を使う（3箇所で別々に測ると必ずズレる）。
  function prepare(ctx, clusters, t) {
    ctx.font = fontString(t);
    const track = (t.tracking || 0) * t.size;
    const spaceW = ctx.measureText(' ').width;
    const trimChars = (t.punct && t.punct.chars) || '';
    const trim = (t.punct && t.punct.trim) || 0;
    for (const cl of clusters) {
      cl.glyphW = ctx.measureText(cl.text).width;
      cl.track = track;
      cl.trim = (cl.text.length === 1 && trimChars.includes(cl.text)) ? trim : 0;
      const spaceKern = kernOf({ at: cl.at + cl.text.length, len: cl.len - cl.text.length }, t);
      cl.spaceW = cl.space ? spaceW + track + spaceKern : 0;
      delete cl.parts;
      cl.kern = kernOf(cl, t);
      cl.adv = cl.glyphW + track * cl.text.length - cl.trim + cl.spaceW + cl.kern - spaceKern;
      if (track !== 0 || cl.kern !== 0 || (t.kerns && Object.keys(t.kerns).some(i => +i >= cl.at && +i < cl.at + cl.text.length))) {
        let offset = 0;
        cl.parts = Array.from(cl.text, ch => {
          const at = cl.at + offset; offset += ch.length;
          let kern = 0;
          for (let i = at; i < at + ch.length; i++) kern += t.kerns?.[i] || 0;
          return { text: ch, adv: ctx.measureText(ch).width + track * ch.length + kern * t.size };
        });
        cl.adv = cl.parts.reduce((n, p) => n + p.adv, 0) - cl.trim + cl.spaceW;
      }
    }
    return { track, spaceW };
  }

  // 行の実幅（末尾の tracking は含めない）
  function widthOf(clusters) {
    if (!clusters.length) return 0;
    const last = clusters[clusters.length - 1];
    return clusters.reduce((a, c) => a + c.adv, 0) - last.track - last.spaceW;
  }

  // ---- 折り返し ----
  function wrap(ctx, clusters, t, frameW) {
    const lines = [];
    let start = 0;
    while (start < clusters.length) {
      let w = 0, end = start;
      // 枠幅ちょうどで収まる場合は次行に送る（figma.png の実測に合わせた）。
      while (end < clusters.length && w + clusters[end].adv < frameW - 0.01) { w += clusters[end].adv; end++; }
      if (end === start) end = start + 1;                       // 1クラスタで溢れる場合
      if (end < clusters.length) {
        let guard = 0;
        while (end > start + 1 && guard++ < 8 &&
               (NO_LINE_START.includes(clusters[end].text) || NO_LINE_END.includes(clusters[end - 1].text))) end--;
      }
      lines.push(clusters.slice(start, end));
      start = end;
    }
    return lines;
  }

  // ---- 描画（すべてのテキスト描画はここを通る）----
  // weightOverride を渡すと、その見た目のウェイトで fillText する（送り幅には影響しない）。
  function drawClusters(ctx, clusters, t, x, baseline, extraPerGap, weightOverride) {
    ctx.font = fontString(t, weightOverride);
    ctx.fillStyle = t.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let pen = x;
    for (const cl of clusters) {
      if (cl.parts) {
        let p = pen;
        for (const part of cl.parts) { ctx.fillText(part.text, p, baseline); p += part.adv; }
      } else if (cl.track === 0) {
        ctx.fillText(cl.text, pen, baseline);
      } else {
        // tracking がある場合は1文字ずつ送る（単語内のカーニングは犠牲になるが Figma と揃う）
        let p = pen;
        for (const ch of cl.text) { ctx.fillText(ch, p, baseline); p += ctx.measureText(ch).width + cl.track; }
      }
      pen += cl.adv + (extraPerGap || 0);
    }
    return pen;
  }

  // 1行テキスト（左揃え／中央揃え）。opt.renderWeight があれば見た目だけそのウェイトで描く
  function drawSingle(ctx, text, t, opt) {
    const cls = toClusters(applyCase(text, t.case));
    prepare(ctx, cls, t);
    const x = opt.align === 'center' ? opt.cx - widthOf(cls) / 2 : opt.x;
    return drawClusters(ctx, cls, t, x, opt.baseline, 0, opt.renderWeight);
  }

  // 帯（メタ／RECOMMEND）: 要素を固定のアキで並べ、全体を中央に置く。
  // Figma 側も要素ごとに別ノードで並んでおり、アキは文字ではなくレイアウトで入っている。
  function drawBand(ctx, segments, t, opt) {
    const parts = segments.map(sg => {
      const cls = toClusters(applyCase(sg.text, sg.case || t.case));
      prepare(ctx, cls, t);
      return { cls, w: widthOf(cls) };
    });
    const total = parts.reduce((a, p) => a + p.w, 0) + opt.gap * (parts.length - 1);
    let x = opt.cx - total / 2;
    for (const p of parts) { drawClusters(ctx, p.cls, t, x, opt.baseline, 0, opt.renderWeight); x += p.w + opt.gap; }
    return total;
  }

  // 均等割り付けの段落。返り値は行ごとの実幅（検証で使う）
  function layoutParagraph(ctx, text, t, frameW) {
    const source = String(text ?? '');
    if (!source) return [];
    const lines = [];
    let offset = 0;
    for (const paragraph of source.split('\n')) {
      const cls = toClusters(applyCase(paragraph, t.case));
      for (const cl of cls) cl.at += offset;
      prepare(ctx, cls, t);
      const wrapped = cls.length ? wrap(ctx, cls, t, frameW) : [[]];
      wrapped.forEach((ln, index) => {
        const last = index === wrapped.length - 1;
        lines.push({ clusters: ln, width: widthOf(ln),
          start: index === 0 ? offset : ln[0].at,
          end: last ? offset + paragraph.length : wrapped[index + 1][0].at,
          paragraphEnd: last });
      });
      offset += paragraph.length + 1;
    }
    return lines;
  }

  function drawParagraph(ctx, text, t, opt) {
    const lines = layoutParagraph(ctx, text, t, opt.w);
    lines.forEach((ln, i) => {
      const last = ln.paragraphEnd;
      const gaps = ln.clusters.length - 1;
      const extra = (!last && opt.justify && gaps > 0) ? (opt.w - ln.width) / gaps : 0;
      drawClusters(ctx, ln.clusters, t, opt.x, opt.baseline + i * opt.lead, extra, opt.renderWeight);
    });
    return lines;
  }

  // ---- 和欧混植（作品名・アーティスト名が和文のとき）----
  // クラスタごとに latin/和文で書体を切り替え、各文字の字間も反映する。
  // isMixed(text) が false のときは呼び出し側が従来の drawSingle（Oswald 単体）を使うこと。
  function isMixed(text) {
    return toClusters(text).some(cl => !cl.latin);
  }

  function prepareMixed(ctx, clusters, jpSpec, latinSpec) {
    for (const cl of clusters) {
      const spec = cl.latin ? latinSpec : jpSpec;
      ctx.font = fontString(spec, spec.renderWeight);
      cl.glyphW = ctx.measureText(cl.text).width;
      cl.track = (spec.tracking || 0) * spec.size;
      cl.trim = 0;
      const spaceKern = kernOf({ at: cl.at + cl.text.length, len: cl.len - cl.text.length }, spec);
      cl.spaceW = cl.space ? ctx.measureText(' ').width + cl.track + spaceKern : 0;
      delete cl.parts;
      cl.kern = kernOf(cl, spec);
      cl.adv = cl.glyphW + cl.spaceW + cl.track * cl.text.length + cl.kern - spaceKern;
      if (cl.track || cl.kern || spec.kerns && Object.keys(spec.kerns).length) {
        let offset = 0;
        cl.parts = Array.from(cl.text, ch => {
          const at = cl.at + offset; offset += ch.length;
          let kern = 0;
          for (let i = at; i < at + ch.length; i++) kern += spec.kerns?.[i] || 0;
          return { text: ch, adv: ctx.measureText(ch).width + cl.track * ch.length + kern * spec.size };
        });
        cl.adv = cl.parts.reduce((n, p) => n + p.adv, 0) + cl.spaceW;
      }
      cl.spec = spec;
    }
  }

  function drawMixedClusters(ctx, clusters, x, baseline) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let pen = x;
    for (const cl of clusters) {
      ctx.font = fontString(cl.spec, cl.spec.renderWeight);
      ctx.fillStyle = cl.spec.color;
      if (cl.parts) {
        let p = pen;
        for (const part of cl.parts) { ctx.fillText(part.text, p, baseline); p += part.adv; }
      } else ctx.fillText(cl.text, pen, baseline);
      pen += cl.adv;
    }
    return pen;
  }

  // jpSpec.case を全体の textCase として使う（作品名・アーティスト名はどちらも ORIGINAL で揃っている）
  function drawMixedSingle(ctx, text, jpSpec, latinSpec, opt) {
    const cls = toClusters(applyCase(text, jpSpec.case));
    prepareMixed(ctx, cls, jpSpec, latinSpec);
    const x = opt.align === 'center' ? opt.cx - widthOf(cls) / 2 : opt.x;
    return drawMixedClusters(ctx, cls, x, opt.baseline);
  }

  return { applyCase, toClusters, prepare, prepareMixed, kernOf, widthOf, wrap, drawSingle, drawBand,
           drawParagraph, layoutParagraph, drawClusters, fontString,
           isMixed, drawMixedSingle, drawMixedClusters };
})();

export default TextEngine;
