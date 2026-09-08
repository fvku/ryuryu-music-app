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
   * Weekly（NEW RELEASE WEEK）の作品面（feature）。🔵 2026-09-08、実物投稿7枚を実測して確定
   * （generator-weekly-design.md §6.1、Layout.WEEKLYのコメント参照）。
   *
   * Monthlyの`draw()`とは別関数にしている。`drawPage()`の既存分岐（'adopted'以外はdrawListedへ）に
   * weeklyを混ぜると、Render.drawWeeklyFeatureが無かった時期にweekly文書がMonthlyの掲載枠として
   * 誤描画される事故につながるため、呼び出し側（canvas-preview.ts）で明示的にkindを見て振り分ける。
   *
   * @param {object} slot  { fields, show, tracking, kerns, typography, jacket:{img}, bgColor }
   * @param {object} images { background, wave, bgColor }
   */
  function drawWeeklyFeature(ctx, slot, images) {
    const W = L.WEEKLY, TY = W.TYPE;
    ctx.clearRect(0, 0, L.CANVAS, L.CANVAS);
    drawBackground(ctx, images);

    // 罫: Monthlyと同じ「各セルの外側6px」。ジャケットとパネルが縦に並ぶだけで描き方は同じ
    ctx.strokeStyle = L.RULE_COLOR;
    ctx.lineWidth = L.RULE;
    for (const c of Object.values(W.CELLS)) ctx.strokeRect(c.x - L.RULE / 2, c.y - L.RULE / 2, c.w + L.RULE, c.h + L.RULE);
    // パネル塗り: タイトル・アーティスト・メタ帯をまとめた1枚だけ（ジャケットは塗らない）
    ctx.fillStyle = L.PANEL_FILL;
    ctx.fillRect(W.CELLS.panel.x, W.CELLS.panel.y, W.CELLS.panel.w, W.CELLS.panel.h);

    drawCover(ctx, slot.jacket && slot.jacket.img, W.CELLS.jacket);

    const d = Pages.toWeeklyDrawData(slot);
    const cx = L.CANVAS / 2;
    const maxWidth = W.CELLS.panel.w - 2 * W.TITLE_INSET_X;

    // 作品名（中央揃え・1行固定）。内枠に入りきらなければ字間を自動で詰める（Koheiの決定。§6.1・§6.4）。
    if (d.title) {
      const titleStyle = d.typography.title || {};
      const fit = fitWeeklyTitle(ctx, d.title, titleStyle.tracking ?? TY.title.tracking, maxWidth, titleStyle.kerns);
      const titleSpec = Object.assign({}, TY.title, titleStyle, { tracking: fit.tracking });
      withShadow(ctx, TY.title.shadow, () => {
        const opt = { cx, baseline: W.TITLE_BASELINE, align: 'center' };
        if (TextEngine.isMixed(d.title)) TextEngine.drawMixedSingle(ctx, d.title, TY.titleJP, titleSpec, opt);
        else TextEngine.drawSingle(ctx, d.title, titleSpec, opt);
      });
    }

    // アーティスト名（中央揃え・1行固定。シャドウ指定なし）
    if (d.artist) {
      const artistSpec = Object.assign({}, TY.artist, d.typography.artist || {});
      const opt = { cx, baseline: W.ARTIST_BASELINE, align: 'center' };
      if (TextEngine.isMixed(d.artist)) TextEngine.drawMixedSingle(ctx, d.artist, TY.artistJP, artistSpec, opt);
      else TextEngine.drawSingle(ctx, d.artist, artistSpec, opt);
    }

    // メタ帯（曲数・総尺・ジャンル・国）。既存のbandLayout/drawBandLayoutをそのまま使う。
    // gapはMonthlyの24.5ではなくWeekly実測の16（Layout.WEEKLY.META_GAPコメント参照）。
    withShadow(ctx, TY.meta.shadow, () => {
      drawBandLayout(ctx, bandLayout(ctx, d.meta, TY.meta, W.META_CELL, d.typography, W.META_GAP));
    });
  }

  /** ctx.shadow* を設定して描画し、必ず元に戻す */
  function withShadow(ctx, shadow, fn) {
    if (!shadow) return fn();
    const { shadowOffsetX, shadowOffsetY, shadowBlur, shadowColor } = ctx;
    ctx.shadowOffsetX = shadow.dx; ctx.shadowOffsetY = shadow.dy; ctx.shadowBlur = shadow.blur; ctx.shadowColor = shadow.color;
    try { fn(); } finally {
      ctx.shadowOffsetX = shadowOffsetX; ctx.shadowOffsetY = shadowOffsetY; ctx.shadowBlur = shadowBlur; ctx.shadowColor = shadowColor;
    }
  }

  /**
   * 作品名がWEEKLY.CELLS.panelの内枠（800-24*2=752px）に入りきらない場合、字間を自動で詰める
   * （Koheiの決定。2026-09-08）。折り返しはしない（テンプレートが1行前提のため、§6.1）。
   * 詰める下限はmodel.tsのtracking検証範囲と同じ-20%。それでも収まらなければoverflow:trueを返す
   * （呼び出し側ははみ出し警告としてPNG生成を止める。§6.4）。
   */
  function fitWeeklyTitle(ctx, text, baseTracking, maxWidth, kerns) {
    const TY = L.WEEKLY.TYPE.title;
    const widthAt = (tracking) => {
      const spec = Object.assign({}, TY, { tracking, kerns: kerns || null });
      const cls = TextEngine.toClusters(TextEngine.applyCase(text, spec.case));
      TextEngine.prepare(ctx, cls, spec);
      return TextEngine.widthOf(cls);
    };
    const FLOOR = -0.2;
    if (widthAt(baseTracking) <= maxWidth) return { tracking: baseTracking, overflow: false };
    if (widthAt(FLOOR) > maxWidth) return { tracking: FLOOR, overflow: true };
    // lo は常に「収まることが分かっている」側、hi は「収まらないことが分かっている」側。
    // 収まる中でbaseTrackingに一番近い（＝字間を詰めすぎない）値に収束させるのでloを返す。
    let lo = FLOOR, hi = baseTracking;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (widthAt(mid) <= maxWidth) lo = mid; else hi = mid;
    }
    return { tracking: lo, overflow: false };
  }

  /**
   * Weekly（NEW RELEASE WEEK）の表紙（`cover`）。🔵 2026-09-08、実物投稿（2026_W-0.png）を実測して確定
   * （generator-weekly-design.md §6.2・§12、Layout.WEEKLY.COVERのコメント参照）。
   * オーバーレイの色（🟡未検証・単一投稿からの推定）を除き、帯の順序・ロゴ・週タイトルは実測どおり。
   *
   * @param {object} cover  { jackets: HTMLImageElement[5]（1〜5位の順）, year: number, week: number, logo: HTMLImageElement }
   * @param {object} images { background, wave, bgColor }
   */
  function drawWeeklyCover(ctx, cover, images) {
    const W = L.WEEKLY, C = W.COVER;
    ctx.clearRect(0, 0, L.CANVAS, L.CANVAS);
    drawBackground(ctx, images);

    // 帯5本。各帯にランクどおりのジャケットを敷き、色オーバーレイを重ねる（帯ごとではなく全体に1回でよい。
    // 帯の外に出ない前提でクリップは省略できるが、drawCoverが各帯のセルでクリップするので安全）。
    C.RANK_TO_BAND.forEach((bandIndex, rank) => {
      const jacket = cover.jackets && cover.jackets[rank];
      if (jacket) drawCover(ctx, jacket, C.bandCell(bandIndex));
    });
    ctx.fillStyle = C.OVERLAY.color;
    ctx.fillRect(0, 0, L.CANVAS, L.CANVAS);

    // ロゴはオーバーレイの上（実物で白のまま＝オーバーレイの影響を受けていないことを確認済み）
    if (cover.logo) ctx.drawImage(cover.logo, C.LOGO.x, C.LOGO.y, C.LOGO.w, C.LOGO.h);

    // 週タイトル。中央揃え（設計文書の左寄せ座標は実測と食い違っており、中央揃えを正とする。§12）
    const line1 = 'NEW RELEASE';
    const line2 = `${cover.year} WEEK ${cover.week}`;
    const opt = { cx: C.TITLE.CENTER_X, align: 'center' };
    TextEngine.drawSingle(ctx, line1, C.TYPE.title, Object.assign({}, opt, { baseline: C.TITLE.LINE1_BASELINE }));
    TextEngine.drawSingle(ctx, line2, C.TYPE.title, Object.assign({}, opt, { baseline: C.TITLE.LINE2_BASELINE }));
  }

  /**
   * Weekly（NEW RELEASE WEEK）のOther Releases（`others`）。🔵 2026-09-08、実物投稿（2026_W-6.png）を実測して確定
   * （generator-weekly-design.md §6.3・§12、Layout.WEEKLY.OTHERSのコメント参照）。
   *
   * 件数は週によって変動するため、行送りをLayout.WEEKLY.OTHERS.layoutFor(n)で自動的に
   * 詰める／広げる（Koheiの決定、2026-09-08。Monthlyの本文`bodyLayoutFor`と同じ考え方）。
   * 収まる最小行送り（フォントサイズ29px）を下回る件数は呼び出し側がoverflowとして扱うこと
   * （`othersFits`／`inspectWeeklyOthers`）。
   *
   * @param {object[]} slots  各項目 { fields, show, typography }（jacket・tracking等は使わない）
   * @param {object} images  { background, wave, bgColor }
   */
  function drawWeeklyOthers(ctx, slots, images) {
    const W = L.WEEKLY, O = W.OTHERS, TY = O.TYPE;
    ctx.clearRect(0, 0, L.CANVAS, L.CANVAS);
    drawBackground(ctx, images);

    ctx.strokeStyle = L.RULE_COLOR;
    ctx.lineWidth = L.RULE;
    ctx.strokeRect(O.CELL.x - L.RULE / 2, O.CELL.y - L.RULE / 2, O.CELL.w + L.RULE, O.CELL.h + L.RULE);
    ctx.fillStyle = L.PANEL_FILL;
    ctx.fillRect(O.CELL.x, O.CELL.y, O.CELL.w, O.CELL.h);

    // heading・本文とも、Monthlyのメタ帯・RECOMMEND帯と同じ「フォントスタックのフォールバック」方式
    // （family: 'Oswald", "Noto Sans JP'）。isMixed()＋drawMixedSingle()は使わない
    // （あちらは作品名／アーティスト名だけの特別扱いで、和文用に書体・ウェイトを差し替える場合の経路）。
    const cx = L.CANVAS / 2;
    TextEngine.drawSingle(ctx, 'Other Releases', TY.heading, { cx, baseline: O.HEADING.BASELINE, align: 'center' });

    const lines = slots.map(Pages.toWeeklyOtherLine);
    const { lead, baseline } = O.layoutFor(lines.length);
    lines.forEach((line, i) => {
      if (!line) return;
      TextEngine.drawSingle(ctx, line, TY.body, { cx, baseline: baseline + i * lead, align: 'center' });
    });
  }

  /**
   * ページ1枚を描く。枠種で振り分けるだけ（SPEC.md §7.5）。
   * 採用枠は Pages.toDrawData で Phase 0 と同じ形に組んで、そのまま draw に渡す。
   * @param {object} page    { kind, slots, no }
   * @param {object} images  { background }  ジャケットは各 slot が持つ
   */
  function drawPage(ctx, page, images) {
    // 背景の色の面はページごと。LegacyスロットのbgColorは旧ラボ互換のフォールバック。
    const top = page.slots[0];
    const bg = {
      background: images && images.background,
      wave:       images && images.wave,
      bgColor:    page.bgColor || (top && top.bgColor),
    };
    if (page.kind === 'adopted')
      return draw(ctx, Pages.toDrawData(top), Object.assign({ jacket: top.jacket && top.jacket.img }, bg));
    if (page.kind === 'listed') return drawListed(ctx, page, bg);
    if (page.kind === 'feature') return drawWeeklyFeature(ctx, top, bg);
    if (page.kind === 'others') return drawWeeklyOthers(ctx, page.slots, bg);
    if (page.kind === 'cover') return drawWeeklyCover(ctx, {
      jackets: page.slots.map(slot => slot.jacket && slot.jacket.img),
      year: page.week && page.week.year,
      week: page.week && page.week.number,
      logo: images && images.logo,
    }, bg);
    throw new Error(`未対応の画像種別です: ${page.kind}`);
  }

  function singleWidth(ctx, text, spec, mixedSpec) {
    const clusters = TextEngine.toClusters(TextEngine.applyCase(text, spec.case));
    if (mixedSpec && TextEngine.isMixed(text)) TextEngine.prepareMixed(ctx, clusters, mixedSpec, spec);
    else TextEngine.prepare(ctx, clusters, spec);
    return TextEngine.widthOf(clusters);
  }

  function inspectWeeklyFeature(ctx, page) {
    const slot = page.slots[0];
    if (!slot) return ['作品が割り当てられていません'];
    const warnings = [], W = L.WEEKLY, TY = W.TYPE, d = Pages.toWeeklyDrawData(slot);
    const maxWidth = W.CELLS.panel.w - 2 * W.TITLE_INSET_X;
    const titleStyle = d.typography.title || {};
    if (d.title && fitWeeklyTitle(ctx, d.title, titleStyle.tracking ?? TY.title.tracking, maxWidth, titleStyle.kerns).overflow)
      warnings.push('作品名が字間を下限まで詰めても枠に収まりません');
    const artistSpec = Object.assign({}, TY.artist, d.typography.artist || {});
    if (d.artist && singleWidth(ctx, d.artist, artistSpec, TY.artistJP) > maxWidth)
      warnings.push('アーティスト名が枠に収まりません');
    const meta = bandLayout(ctx, d.meta, TY.meta, W.META_CELL, d.typography, W.META_GAP);
    if (meta.overflow) warnings.push('曲数・総尺／ジャンル／国が枠に収まりません');
    return warnings;
  }

  function inspectWeeklyOthers(ctx, page) {
    const warnings = [], O = L.WEEKLY.OTHERS;
    if (!O.fits(page.slots.length)) warnings.push(`Other Releasesの${page.slots.length}件が表示領域に収まりません（最大30件）`);
    page.slots.forEach((slot, index) => {
      const line = Pages.toWeeklyOtherLine(slot);
      if (line && singleWidth(ctx, line, O.TYPE.body) > O.BODY.BOX.w) warnings.push(`${index + 1}行目の作品名／アーティスト名が枠に収まりません`);
    });
    return warnings;
  }

  function inspectPage(ctx, page) {
    if (page.kind === 'cover') return [];
    if (page.kind === 'feature') return inspectWeeklyFeature(ctx, page);
    if (page.kind === 'others') return inspectWeeklyOthers(ctx, page);
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

  return { inspectPage, draw, drawCells, drawCover, drawBackground, titleLinesOf, bodyLineCount, bodyLines, bodySpec, drawBody, drawAdopted: draw, drawListed, drawPage, drawWeeklyFeature, fitWeeklyTitle, drawWeeklyOthers, drawWeeklyCover };
})();

export default Render;
