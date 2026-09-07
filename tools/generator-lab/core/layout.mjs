// ============================================================
// layout.js — 版面の実数
// 出典: tools/monthly-generator/reference/figma.png の実測（2400px を 1/2 して 1200 基準に換算）
//        測定スクリプト: tools/monthly-generator/measure/*.js
// SPEC.md §4 の 🟡「Album の内部構造」はここで確定した。
// ============================================================
const Layout = (() => {
  const CANVAS = 1200;          // 制作 canvas。Figma と同じ
  // SPEC.md §9.5: Chrome の fillText は Figma よりインクが濃く出る（実測 1.13〜1.28倍）。
  // 高解像度で描いてから縮小するとこれが大きく減ることを確認した（Kohei 承認・2026-09-03）。
  // 4 を超えると Chrome の canvas 面積上限（約2.68億画素）を超えて描画が壊れるので、これより上げない。
  const EXPORT_SUPER_SAMPLE = 4;
  const RULE = 6;               // 白い罫の太さ。各セルの「外側」に描かれる
  const RULE_COLOR = '#ffffff';
  const PANEL_FILL = 'rgba(0,0,0,0.6)';   // 実測: 背景を 0.4 倍する ＝ 黒 60%

  // 背景の合成 🔵 2026-09-04 実測（reference/background.png ＋ reference/wave.png）
  //
  // **特別なブレンドモードは使われていない。ただの通常合成だった。**
  // 波が background.png のものと同一であることを確認（輝度の相関 r=0.9999）したうえで、
  // チャンネルごとに B = a·W + b を最小二乗フィットすると 3チャンネルとも a≈0.5（R²≥0.9995）。
  //
  // ⚠️ **50% は wave.png のアルファチャンネルに焼き込まれている**（全画素 α=128）。
  //    Figma から書き出した波レイヤーが不透明度を持ったまま出てくるため。
  //    したがってツール側で重ねて不透明度を掛けてはいけない（掛けると実効25%になる。実際に一度やった）。
  //    ここが 1 なのはそのため。将来アルファを持たない波（α=255）が来たら、ここを 0.5 にして補う。
  const BACKGROUND = { waveOpacity: 1 };

  // セル（塗りの領域。罫はこの外側 6px）
  // 検証: 罫の実測位置 y44–50 / 504–510 / 584–590 / 610–616 / 1070–1076 / 1150–1156
  //       x44–50 / 504–510 / 1150–1156 がすべてこの定義から導かれる
  const CELLS = {
    jacket: { x:  50, y:   50, w:  454, h: 454 },
    title:  { x: 510, y:   50, w:  640, h: 454 },
    meta:   { x:  50, y:  510, w: 1100, h:  74 },
    body:   { x:  50, y:  616, w: 1100, h: 454 },
    rec:    { x:  50, y: 1076, w: 1100, h:  74 },
  };
  // 掲載枠（レビューなし）のセル 🔵 2026-09-04 実測（reference/listed.png、2400px を 1/2 して 1200 基準）
  //
  // **採用枠のセルは流用できない。** 採用枠はメタ帯が全幅でジャケットの下に通るが、
  // 掲載枠はメタ帯がジャケットの右にあり、ジャケットが作品名セルとメタ帯の両方の高さにまたがる。
  //
  // 実測した罫（すべて太さ6px、セルの外側）:
  //   全幅の横罫  y 71–77 / 451–457 / 477–483 / 557–563 / 637–643 / 1017–1023 / 1043–1049 / 1123–1129
  //   右カラムのみの横罫  y 371–377 と 937–943（x 424–1156。作品名セルとメタ帯を分ける）
  //   縦罫  x 44–50 と 1150–1156（全体）／ x 424–430（アルバムブロックの中だけ）
  //
  // 外周は左右 44・上下 71（罫の外縁まで）。採用枠は上下左右とも 44 なので、**縦のマージンだけ違う**。
  const LISTED = {
    GROUP_TOP: [77, 643],       // 上下2ブロックの上端。ピッチ 566
    /** ブロック i（0=上, 1=下）のセル */
    cellsOf(i) {
      const T = LISTED.GROUP_TOP[i];
      return {
        jacket: { x:  50, y: T,       w:  374, h: 374 },   // 正方形
        title:  { x: 430, y: T,       w:  720, h: 294 },
        meta:   { x: 430, y: T + 300, w:  720, h:  74 },   // 294 ＋ 罫6 = 300
        rec:    { x:  50, y: T + 406, w: 1100, h:  74 },   // 374 ＋ 罫6 ＋ 背景20 ＋ 罫6 = 406
      };
    },
  };

  // Album = jacket/title + meta（y50–584, 高さ534）
  // Review = body + rec（y616–1150, 高さ534）
  // 584–616 の 32px が SPEC §4 の区切り。うち 584–590 と 610–616 は罫、590–610 は背景が素通し

  // 書体。サイズはインク幅を figma.png に合わせて逆算し、縦方向の実測とも一致することを確認した
  const TYPE = {
    title:  { family:'Oswald',       weight:400, size:54, color:'#ffffff', case:'ORIGINAL', tracking:0 },
    artist: { family:'Oswald',       weight:200, size:42, color:'#ffffff', case:'ORIGINAL', tracking:0 },
    meta:   { family:'Oswald", "Noto Sans JP', weight:300, size:32, color:'#ffffff', case:'UPPER',    tracking:0 },
    rec:    { family:'Oswald", "Noto Sans JP', weight:300, size:32, color:'#ffffff', case:'ORIGINAL', tracking:0 },
    // 約物の詰め: reference/text.md が「範囲指定のカーニング」と呼んでいるもの。
    // trim は句読点1つあたり送りから引く px 数。figma.png との画素差分を最小化して 14 と確定
    // （＝全角 28 の半角化）。13 でも 15 でも誤差が増える。
    // 字間: figma.png の最終行（均等割り付けがかからない行）の字送り実測は 28.0 ＝ 全角そのまま。
    //       docs/10 §6 の「+3%」はこの回には当てはまらない。
    // renderWeight: SS=4 採用後、本文だけ Kohei から追加で「もう少し細く」の指名リクエストがあり、
    // 見た目のウェイトだけ 400→370 に下げた（字送りは weight:400 の測定のまま。SPEC.md §9.5）。
    // 意匠上の個別調整であり、太さの原因究明（要素ごとに調整しない）の話とは別。
    body:   { family:'Noto Sans JP', weight:400, renderWeight:370, size:28, color:'#ffffff', case:'ORIGINAL', tracking:0,
              punct: { chars:'、。', trim: 14 } },

    // 和文の作品名・アーティスト名（2026-09-04、Kohei と実物を見比べて決定）。
    // Figma では Oswald 指定のまま和文が来ると、和文グリフが無いため OS が勝手にフォールバックしていた
    // （検証の結果 YuGothic Bold。docs/08 §4）。これは誰かが意図して選んだものではなかったため、
    // 改めて Web で正式に決めた。作品名は Oswald Regular の「静かに置く」役割に合わせて Bold、
    // アーティスト名は Oswald ExtraLight の軽さに合わせて Light。
    // サイズ・字間・textCase は Oswald 版の title/artist をそのまま踏襲する。
    // 和文はコンデンス体ではないので Oswald と横幅の詰まり方は揃わない（Google Fonts に和文の
    // 本格的なコンデンス書体はほぼ無い。踏襲するなら有料書体の別途調達が要る。Phase 1 以降の課題）。
    // renderWeight（§9.5 の太さ対策）は本文と違い比較対象の Figma 実例が無く、実測して補正する
    // 手立てが無いので今回はかけていない。実例が手に入り次第、太さを見て要調整。
    titleJP:  { family:'Zen Kaku Gothic New', weight:700, size:54, color:'#ffffff', case:'ORIGINAL', tracking:0 },
    artistJP: { family:'Zen Kaku Gothic New', weight:300, size:42, color:'#ffffff', case:'ORIGINAL', tracking:0 },
  };

  // 文字の基準位置（1200基準）。すべて figma.png の実測から
  const TEXT = {
    titleX: 542,          // 描画原点 x（インク左端 544.5 − 左ベアリング 2.6）
    titleBaseline: 230,   // 1行目のベースライン。**作品名が2行のときの値**（baselinesFor を見ること）
    titleLead: 72,        // 行送り（ベースライン間隔）。docs/10 の 60 とは一致しない → SPEC §5 の訂正が要る
    artistBaseline: 368,  // **作品名が2行のときの値**（baselinesFor を見ること）
    metaBaseline: 560,  // 中央揃え
    bandGap: 24.5,          // 帯のセグメント間のアキ（送り）。実測の空き 27–28 / 39 から逆算
    bodyX: 74.25, bodyW: 1050,
    bodyBaseline: 664.25,    // **8行のときの値**（bodyLayoutFor を見ること）
    bodyLead: 54,            // **8行のときの値**（bodyLayoutFor を見ること）
    bodyMaxLead: 42,         // 手動制限へ切り替えた場合の初期値。自動時は天地25pxまで最大化する。
    // 本文の余白とグリフの伸び。2026-08 の Monthly/Japan 採用14ページの実測（measure/body_metrics.js）
    bodyPad: 25,        // 白枠の内側から本文のインクまで。左右で実測 25（x50/1150 に対しインク 75/1125）
    bodyAscent: 23.25,  // 1行目のベースラインからインク上端まで
    bodyDescent: 2.25,  // 最終行のベースラインからインク下端まで
    // 参考: 実物の行送り（規則ではなく記録）。7→60 / 8→54 / 9→48
    bodyLeadObserved: { 7: 60, 8: 54, 9: 48 },
    recBaseline: 1126,    // 中央揃え
  };

  // SPEC.md §9.5 approach2: 可変フォントの wght を落として線だけ細くする。
  // 送り幅（cl.adv）は TextEngine.prepare() が t.weight（このオブジェクトの値）で測るため、
  // renderWeightDelta を変えても位置・行分割は一切変わらない。変わるのは fillText の見た目だけ。
  const MIN_WEIGHT = { 'Oswald': 200, 'Noto Sans JP': 100 };   // Google Fonts の可変軸の下限
  function renderWeightOf(t) {
    // meta/rec は "Oswald", "Noto Sans JP" のフォールバック指定なので先頭のファミリーで判定する
    const fam = t.family.split(',')[0].replace(/"/g, '').trim();
    const min = MIN_WEIGHT[fam] || 100;
    // t.renderWeight があれば最優先（要素個別の意匠調整。Kohei の指名リクエストのみで使う。
    // §9.5 の「原因は1つ」は太さの原因究明の話で、SS=4 採用後の意匠上の微調整はこれとは別）
    if (t.renderWeight != null) return Math.max(min, Math.round(t.renderWeight));
    return Math.max(min, Math.round(t.weight - renderWeightDelta));
  }
  let renderWeightDelta = 0;   // 0 のとき従来と完全に同じ。verify.html の ?wdelta= で上書きして検証する

  // 文字をセルのどこに置くかの規則 🔵 2026-09-04 実測
  // **採用枠と掲載枠で共通**であることを、2つの参照画像の実測から確かめた（SPEC.md §5）。
  // セルの寸法が違っても、下の4つの定数だけで両方の実数が再現できる。
  const TEXT_RULE = {
    titleInsetX:  32,   // 作品名・アーティスト名の描画原点 x ＝ セル左端 ＋ 32
    blockK:       25,   // 縦中央に置かれるかたまりの補正項（titleBaselines を見ること）
    artistGap:    66,   // 作品名の最終行 → アーティスト名 のベースライン間隔
    bandBaseline: 50,   // 帯（メタ／RECOMMEND）のベースライン ＝ セル上端 ＋ 50。横は中央揃え
  };

  /**
   * 作品名1行目とアーティスト名のベースライン。**セルと行数から決まる。**
   *
   * 作品名とアーティスト名は独立した固定位置ではなく、1つのかたまりとしてセル内で縦中央に置かれている
   * （2026-09-04 実測。Kohei の指摘で発覚した。SPEC.md §5）。
   * かたまりの高さは行数で変わるので、行が1本増えると上下に半行（lead/2）ずつ広がる。
   *
   * 実測との突き合わせ（1200基準）:
   *
   * | 参照画像 | セル | 行数 | 作品名 | アーティスト名 |
   * |---|---|---|---|---|
   * | `figma.png`（採用・Melaina Kol） | y50 h454 | 2 | 230 | 368 |
   * | `title1line.png`（採用・一張羅） | y50 h454 | 1 | **266** | **331.5**（式は 332） |
   * | `listed.png`（掲載・上ブロック） | y77 h294 | 1 | **213** | **279** |
   * | `listed.png`（掲載・下ブロック） | y643 h294 | 1 | **779** | **845** |
   *
   * 4つとも同じ式・同じ定数で出る。
   */
  function titleBaselines(cell, lineCount) {
    const n = lineCount || 1;
    const title = cell.y + cell.h / 2 - TEXT.titleLead / 2 * n + TEXT_RULE.blockK;
    return { title, artist: title + TEXT.titleLead * (n - 1) + TEXT_RULE.artistGap };
  }

  /**
   * 採用枠での titleBaselines。呼び出し側の互換のために残してある。
   *
   * **作品名とアーティスト名は独立した固定位置ではない。1つのかたまりとしてセル内で縦中央に置かれている**
   * （2026-09-04 実測。Kohei の指摘で発覚した。SPEC.md §5）。
   * かたまりの高さは作品名の行数で変わるので、行が1本増えると上下に半行（lead/2 = 36）ずつ広がる。
   * つまり作品名は 36 上がり、アーティスト名は 36 下がる。
   *
   * 実測（1200基準、書体のディセンダ量を仮定せず、同じ書体で描いたインク下端のオフセットで換算した）:
   *
   * | 参照画像 | 行数 | 作品名 | アーティスト名 |
   * |---|---|---|---|
   * | `reference/figma.png`（Melaina Kol） | 2 | 230 | 368 |
   * | `reference/title1line.png`（一張羅） | 1 | **266** | **331.5**（予測 332） |
   *
   * TEXT.titleBaseline / TEXT.artistBaseline は「2行のときの値」なので、
   * **lineCount が 2 ならこの関数は素通しで従来と完全に同じ値を返す**。
   * Phase 0 の検証（figma.png との画素差分）はそれで変わらない。
   */
  function baselinesFor(lineCount) {
    return titleBaselines(CELLS.title, lineCount);
  }

  /**
   * 本文は上下25pxの余白内に置く。自動時は先頭行と最終行を天地へ揃え、
   * 使える高さを最大限使う。手動指定時だけmaxLeadで行送りを抑え、
   * かたまりを縦中央にする。成立する最小行送りは本文文字サイズと同じ28px。
   */
  function bodyBand() {
    const top = CELLS.body.y + TEXT.bodyPad;
    const bottom = CELLS.body.y + CELLS.body.h - TEXT.bodyPad;
    return { top, bottom, first: top + TEXT.bodyAscent, last: bottom - TEXT.bodyDescent };
  }
  function bodyLayoutFor(lineCount, maxLead) {
    const n = Math.max(1, lineCount || 1);
    const { top, bottom, first, last } = bodyBand();
    if (n === 1)                                    // 1行なら天地の中央に置く
      return { lead: 0, baseline: (top + bottom) / 2 + (TEXT.bodyAscent - TEXT.bodyDescent) / 2 };
    const cap = Number.isFinite(maxLead) ? Math.max(TYPE.body.size, maxLead) : Infinity;
    const lead = Math.min((last - first) / (n - 1), cap);
    // 手動上限に達した短文は、行を広げず本文のかたまりを中央に置く。
    return { lead, baseline: first + ((last - first) - lead * (n - 1)) / 2 };
  }
  function bodyLead(lineCount) { return bodyLayoutFor(lineCount).lead; }

  /**
   * 本文のかたまりが成立するか。天地幅を埋める規則なので上下には必ず収まるが、
   * 行数が多すぎると行送りが文字サイズを下回って行が重なる。
   */
  function bodyFits(lineCount) {
    const n = Math.max(1, lineCount || 1);
    return n === 1 || bodyLead(n) >= TYPE.body.size;
  }

  return {
    CANVAS, EXPORT_SUPER_SAMPLE, RULE, RULE_COLOR, PANEL_FILL, BACKGROUND, CELLS, LISTED, TYPE, TEXT, TEXT_RULE,
    MIN_WEIGHT, renderWeightOf, baselinesFor, titleBaselines, bodyBand, bodyLead, bodyLayoutFor, bodyFits,
    get renderWeightDelta() { return renderWeightDelta; },
    set renderWeightDelta(v) { renderWeightDelta = v; },
  };
})();

export default Layout;
