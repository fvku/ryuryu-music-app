import { titleLayout, drawTitleLayout, bandLayout, drawBandLayout } from './text-layout.mjs';
import Layout from "./layout.mjs";
import TextEngine from "./textEngine.mjs";
import Pages from "./pages.mjs";
// ============================================================
// render.js — 唯一のレンダラ（SPEC.md §2）
// 1200×1200 の実寸 canvas に描く。プレビューはこの canvas を CSS で縮めるだけ、
// 書き出しは同じ canvas を等倍で toBlob する。配置を計算する実装はここ1つしかない。
// ============================================================
const Render = (() => {
  const L = Layout;

  function drawCells(ctx) {
    // 罫: 各セルの「外側」6px だけを白で縁取る（内側は背景を素通しさせる）。
    // 実測した罫の位置 y44–50 / 504–510 / 584–590 / 610–616 / 1070–1076 / 1150–1156 と
    // x44–50 / 504–510 / 1150–1156 は、すべてこの定義から導かれる。
    ctx.strokeStyle = L.RULE_COLOR;
    ctx.lineWidth = L.RULE;
    for (const c of Object.values(L.CELLS))
      ctx.strokeRect(c.x - L.RULE / 2, c.y - L.RULE / 2, c.w + L.RULE, c.h + L.RULE);
    // 塗り: 黒 60%
    ctx.fillStyle = L.PANEL_FILL;
    for (const c of Object.values(L.CELLS)) ctx.fillRect(c.x, c.y, c.w, c.h);
  }

  /**
   * 背景を敷く。2通りある（SPEC.md §6）。
   *   ① `background` … Figma で合成済みのPNGをアップロードした場合。そのまま貼る（Phase 0 からの経路）
   *   ② `bgColor` ＋ `wave` … ツール側で合成する場合（案B）。色の面の上に波を**通常・不透明度50%**で重ねる
   * `background` があるときの挙動は Phase 0 と完全に同じ。
   */
  function drawBackground(ctx, img) {
    if (!img) return;
    if (img.background) { ctx.drawImage(img.background, 0, 0, L.CANVAS, L.CANVAS); return; }
    if (!img.bgColor) return;
    ctx.fillStyle = img.bgColor;
    ctx.fillRect(0, 0, L.CANVAS, L.CANVAS);
    if (!img.wave) return;
    ctx.save();
    ctx.globalAlpha = L.BACKGROUND.waveOpacity;
    ctx.drawImage(img.wave, 0, 0, L.CANVAS, L.CANVAS);
    ctx.restore();
  }

  /**
   * 作品名を行に割る。🔵 2026-09-04、実データで判明した必須処理。
   *
   * **Release Master の `Title` は1行のベタ書きで、改行を持っていない。**
   * Figma 側はテキストボックスの幅で自動的に折り返していた（実例:
   * `Okay that's a great idea because if I do that then` が2行に組まれている）。
   * データの `\n` だけを見ていると、長い作品名がセルからはみ出す。
   *
   * 折り返し幅はセル幅から左右の余白（`TEXT_RULE.titleInsetX`）を引いたもの。
   * 採用枠なら 640 − 64 = 576、掲載枠なら 720 − 64 = 656。
   * `figma.png` の実測から、576 が取りうる範囲 [473.15, 625.59) に入ることを確かめてある
   * （下限は2行目が収まる幅、上限はこれ以上だと1行目に `because` が入って figma と行分割が変わる幅）。
   *
   * データ側に `\n` があればそれも尊重する（段落として扱い、それぞれを折り返す）。
   */
  function titleLinesOf(ctx, text, cell) {
    const TY = L.TYPE;
    const frameW = cell.w - 2 * L.TEXT_RULE.titleInsetX;
    const out = [];
    for (const para of String(text == null ? '' : text).split('\n')) {
      const cl = TextEngine.toClusters(TextEngine.applyCase(para, TY.title.case));
      if (!cl.length) { out.push(''); continue; }
      if (TextEngine.isMixed(para)) TextEngine.prepareMixed(ctx, cl, TY.titleJP, TY.title);
      else TextEngine.prepare(ctx, cl, TY.title);
      for (const line of TextEngine.wrap(ctx, cl, TY.title, frameW))
        out.push(line.map(c => c.text + (c.space ? ' ' : '')).join('').trimEnd());
    }
    return out;
  }

  /**
   * 本文が何行に組まれるか。セルに入りきるかの判定に使う（Layout.bodyCapacity）。
   * 折り返しは描画とまったく同じ経路（TextEngine.wrap）を通すので、数えた行数と実際の行数はズレない。
   */
  function bodyLineCount(ctx, text, tracking, kerns) {
    return bodyLines(ctx, text, tracking, kerns).length;
  }

  // 編集欄と画像が同じ折り返し結果・原稿位置を使う。
  function bodyLines(ctx, text, tracking, kerns) {
    return TextEngine.layoutParagraph(ctx, text, bodySpec(tracking, kerns), L.TEXT.bodyW);
  }

  /**
   * 本文の書体指定。カーニング（字間）はページごとに人が決めるので、指定があれば差し替える。
   * **これは規則ではなく判断。** Kohei は原稿を削らず、行数・カーニング・行間で本文を収めている。
   * そのうち行間は規則になっていたが（Layout.bodyLayoutFor）、カーニングは単一の値では説明できなかった
   * ——全ページに -0.023em をかけると 2026-08 の14ページの行数はすべて合うが、
   * Phase 0 で figma と一致を確認済みの Melaina Kol の行分割が崩れる（SPEC.md §5）。
   */
  function bodySpec(tracking, kerns) {
    const hasKerns = kerns && Object.keys(kerns).length;
    if (!tracking && !hasKerns) return L.TYPE.body;
    return Object.assign({}, L.TYPE.body, { tracking: tracking || 0, kerns: hasKerns ? kerns : null });
  }

  /**
   * 本文を描く。**行数を先に数えてから、それに応じた行送りとベースラインで組む**
   * （Layout.bodyLayoutFor。2026-09-04 実測）。
   */
  function drawBody(ctx, text, tracking, kerns, maxLead, leadMode = 'auto') {
    const spec = bodySpec(tracking, kerns);
    const n = bodyLineCount(ctx, text, tracking, kerns);
    if (!n) return;
    const { lead, baseline } = L.bodyLayoutFor(n, leadMode === 'custom' ? maxLead : undefined);
    TextEngine.drawParagraph(ctx, text, spec, {
      x: L.TEXT.bodyX, w: L.TEXT.bodyW, baseline, lead, justify: true,
      renderWeight: L.renderWeightOf(L.TYPE.body),
    });
  }

  function drawCover(ctx, img, c) {
    if (!img) return;
    const s = Math.max(c.w / img.width, c.h / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.save(); ctx.beginPath(); ctx.rect(c.x, c.y, c.w, c.h); ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, c.x + (c.w - w) / 2, c.y + (c.h - h) / 2, w, h);
    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx  1200×1200 相当（scale 済みでもよい）
   * @param {object} d  { title, artist, meta, body, rec }
   * @param {object} img { background, jacket }
   */
  function draw(ctx, d, img) {
    const TY = L.TYPE;
    ctx.clearRect(0, 0, L.CANVAS, L.CANVAS);
    drawBackground(ctx, img);
    drawCells(ctx);
    drawCover(ctx, img.jacket, L.CELLS.jacket);

    // SPEC.md §9.5 approach2: 全テキストに同じ関数で見た目のウェイトだけ下げる。
    // renderWeightDelta が 0 のときは L.renderWeightOf(t) === t.weight なので従来と完全に同じ。

    drawTitleLayout(ctx, titleLayout(ctx, d, L.CELLS.title));
    drawBandLayout(ctx, bandLayout(ctx, d.meta || [], TY.meta, L.CELLS.meta, d.typography));

    // 本文（均等割り付け）。行送りとベースラインは行数から決まる（Layout.bodyLayoutFor）
    drawBody(ctx, d.body || '', d.tracking, d.kerns, d.bodyMaxLead, d.bodyLeadMode);

    // RECOMMEND 帯
    drawBandLayout(ctx, bandLayout(ctx, d.rec || [], TY.rec, L.CELLS.rec, d.typography));
  }

  // ============================================================
  // ここから下は Phase 1 の追加（SPEC.md §7.5「render.js の分岐」）。
  // **上の draw は署名も中身も一切変えていない。** verify.html と measure/*.js は
  // すべて draw を直接叩いているので、ここが変わらない限り Phase 0 の
  // 「figma.png との画素差分」の検証はいつでも再実行できる。これが回帰を守る唯一の担保。
  // ============================================================

  /**
   * 掲載枠（レビューなし）。🔵 2026-09-04、reference/listed.png の実測で実装した（SPEC.md §4）。
   *
   * 採用枠との違いは版面だけで、**文字をセルのどこに置くかの規則は共通**（Layout.TEXT_RULE）。
   * 掲載枠はメタ帯がジャケットの右にあり、ジャケットが作品名セルとメタ帯の両方の高さにまたがる。
   * 和文の評価文は入らない（これが採用枠との唯一かつ決定的な差）。
   *
   * 掲載件数が奇数で slot が1つしか無いときは、下ブロックを描かない（背景のまま）。
   * 運用では起きない前提の安全弁（SPEC.md §7）。
   */
  function drawListed(ctx, page, images) {
    const TY = L.TYPE;
    ctx.clearRect(0, 0, L.CANVAS, L.CANVAS);
    drawBackground(ctx, images);

    page.slots.forEach((slot, i) => {
      if (i > 1) return;                       // 掲載枠は1画像に2件まで
      const cells = L.LISTED.cellsOf(i);
      const list = [cells.jacket, cells.title, cells.meta, cells.rec];

      // 罫と塗り。採用枠と同じ描き方（罫はセルの外側6px）で、実測した罫の位置がすべて再現される
      ctx.strokeStyle = L.RULE_COLOR;
      ctx.lineWidth = L.RULE;
      for (const c of list) ctx.strokeRect(c.x - L.RULE / 2, c.y - L.RULE / 2, c.w + L.RULE, c.h + L.RULE);
      ctx.fillStyle = L.PANEL_FILL;
      for (const c of list) ctx.fillRect(c.x, c.y, c.w, c.h);

      drawCover(ctx, slot.jacket && slot.jacket.img, cells.jacket);

      // 作品名（複数行可）とアーティスト名。かたまりでセル内に縦中央（Layout.titleBaselines）
      const d = Pages.toDrawData(slot);
      drawTitleLayout(ctx, titleLayout(ctx, d, cells.title));
      drawBandLayout(ctx, bandLayout(ctx, d.meta || [], TY.meta, cells.meta, d.typography));
      drawBandLayout(ctx, bandLayout(ctx, d.rec || [], TY.rec, cells.rec, d.typography));

    });
  }

  /**
   * ページ1枚を描く。枠種で振り分けるだけ（SPEC.md §7.5）。
   * 採用枠は Pages.toDrawData で Phase 0 と同じ形に組んで、そのまま draw に渡す。
   * @param {object} page    { kind, slots, no }
   * @param {object} images  { background }  ジャケットは各 slot が持つ
   */
  function drawPage(ctx, page, images) {
    // 背景の色の面はページごと。掲載枠は上の Slot の色を使う（SPEC.md §6）
    const top = page.slots[0];
    const bg = {
      background: images && images.background,
      wave:       images && images.wave,
      bgColor:    top && top.bgColor,
    };
    if (page.kind === 'adopted')
      return draw(ctx, Pages.toDrawData(top), Object.assign({ jacket: top.jacket && top.jacket.img }, bg));
    return drawListed(ctx, page, bg);
  }

  function inspectPage(ctx, page) {
    const warnings = [];
    page.slots.forEach((slot, index) => {
      const d = Pages.toDrawData(slot);
      const cells = page.kind === 'listed' ? L.LISTED.cellsOf(index) : L.CELLS;
      const label = page.kind === 'listed' ? `${index === 0 ? '上段' : '下段'}：` : '';
      if (titleLayout(ctx, d, cells.title).overflow) warnings.push(label + '作品名・アーティスト名が枠に収まりません');
      const meta = bandLayout(ctx, d.meta, L.TYPE.meta, cells.meta, d.typography);
      if (meta.overflow) warnings.push(label + `曲数・総尺／ジャンル／国が最小間隔でも収まりません（必要幅${Math.ceil(meta.total)}px／利用可能幅${cells.meta.w - meta.margin * 2}px）`);
      if (bandLayout(ctx, d.rec, L.TYPE.rec, cells.rec, d.typography).overflow) warnings.push(label + 'おすすめ曲が枠に収まりません');
      if (page.kind !== 'listed' && !L.bodyFits(bodyLineCount(ctx, d.body, d.tracking, d.kerns))) warnings.push('評価文が枠に収まりません');
    });
    return warnings;
  }

  return { inspectPage, draw, drawCells, drawCover, drawBackground, titleLinesOf, bodyLineCount, bodyLines, bodySpec, drawBody, drawAdopted: draw, drawListed, drawPage };
})();

export default Render;
