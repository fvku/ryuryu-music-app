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

  // 背景の合成規則。🔵 2026-09-09確定。Koheiの説明（Figmaは「地の色100%の上に、waveをブレンドモード
  // **Luminosity**・不透明度**50%**」）を実物投稿で検算した。2026-09-04の「特別なブレンドモードは
  // 使われていない＝ただの通常合成」という当時の判断は誤りで、通常合成では地の色の彩度が半分に薄まる。
  //
  // 検算：`reference/2026#36`の実物7枚と、同じ月のwaveで
  //   out = 0.5·SetLum(C, Lum(wave)) + 0.5·C   （W3C Compositing 1 のLuminosity。Lum = 0.3/0.59/0.11）
  // を解くと、作品面5枚とも残差は平均0.34階調・最大2階調で一致する（Other Releasesのみ平均1.9）。
  // 「waveをそのままの色で50%」だとチャンネルごとの実効不透明度が0.25/0.68/0.45とばらけて合わない。
  // 再検算は`background-check.html`（generator-labサーバ8778番）。
  //
  // ⚠️ **waveの素材は月替わりで、Koheiが月ごとに未加工の原版を渡す**（2026-09-09に確定）。
  //    原版は`node tools/generator-lab/make-wave.mjs <原版.png>`でグレースケール化して
  //    `assets/waves/wave26MM.png`へ置き、アプリは文書の対象月から自動で選ぶ（`runtime.tsx`の`BUNDLED_WAVES`）。
  //    月が違うwaveでは背景が一致しないので、実物との突き合わせでは必ずその月の素材を使うこと。
  //    αが焼き込まれた旧方式の素材（アップロードで来る可能性がある）でも実効50%になるよう、
  //    `Render.drawBackground()`が掛ける不透明度を補正する。
  const BACKGROUND = { waveOpacity: 0.5, waveBlend: 'luminosity' };

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

    // 和文の作品名・アーティスト名。
    //
    // 経緯: Figma では Oswald 指定のまま和文が来ると、和文グリフが無いため OS が勝手に
    // フォールバックしていた（検証の結果 YuGothic Bold。docs/08 §4）。誰かが意図して選んだものでは
    // なかったため、2026-09-04 に Zen Kaku Gothic New（作品名 Bold／アーティスト Light）を正式に決めた。
    // ただし当時は比較できる実物が無く、太さは見た目の判断だった。
    //
    // 🔵 2026-09-09に実物で検算し、**Noto Sans JP へ変更**（Koheiの決定）。
    // Weeklyの実物投稿（reference/weekly和文サンプル/2026_W-5.png、作品名「行方不明」・
    // アーティスト「川辺素」）を画素で測ると、幅はどの候補も±1px以内で一致する一方、インクの量は
    // Zen Kaku 700 が実物比 +50.6%、Zen Kaku 300 が −34.6% と大きく外れていた。Noto Sans JP 400 は
    // +2.1% でほぼ一致する（同条件の欧文で +20% の系統差が出るので、それを割り引いても
    // Zen Kaku 700 は太すぎ、300 は細すぎ）。照合は `jp-font-check.html`。
    // ウェイトは **作品名 400／アーティスト 300** でKoheiが確定（2026-09-09）。
    // アーティストは Oswald ExtraLight の軽さに合わせる意図を優先した（実物との一致だけを見ると
    // 300 は −13.0%、400 は +29.9% で 400 のほうが近いが、見比べたうえで 300 を採用）。
    // **この値は Monthly・Japan・Weekly の3企画すべてに適用する**（Koheiの決定）。
    // Monthly／Japan は `Layout.TYPE`、Weekly は `Layout.WEEKLY.TYPE` の側にあり、どちらも同じ値にしてある。
    //
    // サイズ・字間・textCase は Oswald 版の title/artist をそのまま踏襲する。
    // 和文はコンデンス体ではないので Oswald と横幅の詰まり方は揃わない（Google Fonts に和文の
    // 本格的なコンデンス書体はほぼ無い。踏襲するなら有料書体の別途調達が要る）。
    titleJP:  { family:'Noto Sans JP', weight:400, size:54, color:'#ffffff', case:'ORIGINAL', tracking:0 },
    artistJP: { family:'Noto Sans JP', weight:300, size:42, color:'#ffffff', case:'ORIGINAL', tracking:0 },
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

  // ============================================================
  // Weekly（NEW RELEASE WEEK）の作品面（feature）🔵 2026-09-08実測
  // 出典: Koheiから受領した実物投稿7枚（2026 WEEK 36、tools/generator-lab/reference/2026#36/）。
  // generator-weekly-design.md §6.1は「罫・パネル塗りは無い」としていたが誤りだった。
  // 実測すると、Monthlyとまったく同じ規則（各セルの外側6px白罫、黒系60%パネル）が使われている。
  // パネルの色は投稿ごとに色相が違う（背景に応じて変わる）ので、Monthlyと同じ
  // 「黒を乗算」方式と判断した（PANEL_FILLをそのまま流用。個別の係数再検証はしていない）。
  //
  // 罫の実測（1200基準、5投稿で確認）: x194–200 と x1000–1006（Frame 5の左右外側）、
  // y44–50（ジャケット上）、y850–856（ジャケットとパネルの境界）、y1150–1156（パネル下）。
  // すべてMonthlyの「セル外側6px」の描き方（strokeRect を RULE/2 だけ膨らませる）と一致する。
  const WEEKLY = {
    CELLS: {
      jacket: { x: 200, y: 50, w: 800, h: 800 },
      panel:  { x: 200, y: 850, w: 800, h: 300 },   // タイトル・アーティスト・メタ帯をまとめて塗る1枚のパネル
    },
    // 作品名・アーティスト名の内枠。generator-weekly-design.md §6.1「Album (224,880) 752×240」＝
    // panel(200,850,800,300)を左右24pxずつ内側に入れた幅（800-48=752）と一致する。
    TITLE_INSET_X: 24,
    // ベースライン（1200基準）。実物5投稿（I Know Too Much / We Want Bass / ACT III / Kismet / ATOMEW、
    // いずれも1行・ディセンダ無し）でインク下端が全投稿でy948.5に一致し確定した。
    // 設計文書のy904（cap基準の枠、高さ44）から逆算した948とも一致する。
    TITLE_BASELINE: 948.5,
    // アーティスト名はGoulding／Tempalayにディセンダ（g/p/y）があったため、
    // ディセンダの無い3投稿（We Want Bass／ACT III／Kismet）のインク下端 y1017.5 で確定。
    // 設計文書のy980+高さ40=1020という予測より2.5px上だが、実測を正とする。
    ARTIST_BASELINE: 1017.5,
    // メタ帯のベースライン。5投稿全てで最頻値1096（設計文書のy1064+高さ32=1096と一致）。
    META_BASELINE: 1096,
    // メタ帯の要素間ギャップ。generator-weekly-design.md §6.1「要素間 gap16px」を
    // 既存のbandLayout()にそのまま渡すと、実物とインク位置が1px以内で一致することを確認済み
    // （Monthlyのbrand.TEXT.bandGap=24.5とは別の値。取り違えないこと）。
    META_GAP: 16,
    // bandLayout()のcell引数。cell.y+cell.h/2+13 が META_BASELINE と一致するように定義している
    // （drawBandLayout()の実装がこの式でベースラインを決めるため。text-layout.mjs参照）。
    META_CELL: { x: 200, y: 1067, w: 800, h: 32 },
    TYPE: {
      // 字間-2%はimportWeeklyDocument()がtypography.titleとして持たせる想定（取り込み側の責務）。
      // ここ（版面側の既定値）に書いても、text-layout.mjs の linesOf() が
      // style.tracking（=呼び出し側の値）を必ず優先するため描画に反映されない
      // （generator-weekly-design.md §6.1「字間−2%をどこに持たせるか」参照）。
      title:  { family: 'Oswald', weight: 400, size: 54, color: '#ffffff', case: 'ORIGINAL', tracking: 0,
                shadow: { dx: 10, dy: 10, blur: 40, color: 'rgba(0,0,0,.3)' } },
      artist: { family: 'Oswald', weight: 200, size: 42, color: '#ffffff', case: 'ORIGINAL', tracking: 0 },
      // meta帯の字体・区切りはMonthlyの TYPE.meta と実質同じ（フォールバック・UPPER・「・」区切りも共通）。
      meta:   { family: 'Oswald", "Noto Sans JP', weight: 300, size: 32, color: '#ffffff', case: 'UPPER', tracking: 0,
                shadow: { dx: 0, dy: 0, blur: 40, color: 'rgba(0,0,0,.3)' } },
      // 和文が混じった場合の書体。🔵 2026-09-09、実物（reference/weekly和文サンプル/2026_W-5.png）で
      // 検算して確定した。Monthlyの`TYPE.titleJP`と同じ値・同じ根拠なので、そちらのコメントを参照。
      titleJP:  { family: 'Noto Sans JP', weight: 400, size: 54, color: '#ffffff', case: 'ORIGINAL', tracking: 0 },
      artistJP: { family: 'Noto Sans JP', weight: 300, size: 42, color: '#ffffff', case: 'ORIGINAL', tracking: 0 },
    },

    // Other Releases（`others`）🔵 2026-09-08実測（2026_W-6.png、実データ30行）
    // 罫・パネルはfeatureとまったく同じ規則（外側6px白罫、黒系60%パネル、実測で確認）。
    // Koheiの指示（2026-09-08）：件数は週によって変動するので、行送りを表示エリアに合わせて
    // 自動で詰める／広げる。Monthlyの本文（bodyLayoutFor）とまったく同じ考え方で、
    // 天地のマージン（ここではASCENT/DESCENT）を固定し、そのあいだを行数で均等に割る。
    OTHERS: {
      CELL: { x: 200, y: 50, w: 800, h: 1100 },   // 内枠。featureのFrame 5と違い縦罫・横罫とも外周だけ
      HEADING: { CELL: { x: 200, y: 50, w: 800, h: 172 }, BASELINE: 169.5 },  // 中央揃え。実測: インク下端169.5
      // 本文の「天地幅」。実測30行で先頭行ベースライン248.5・最終行ベースライン1089.5、
      // 行送り29.0（=(1089.5-248.5)/29）と、フォントサイズ29pxがほぼ一致した（境界に近い密度）。
      // ボックス(240,222)720×870 に対し ASCENT=26.5（天）・DESCENT=2.5（地）を引いた841pxを
      // 行数-1で割ると行送りが決まる。本文が1行だけの場合はbodyLayoutForと同様に天地中央に置く。
      BODY: {
        BOX: { x: 240, y: 222, w: 720, h: 870 },
        ASCENT: 26.5, DESCENT: 2.5,
      },
      TYPE: {
        heading: { family: 'Oswald', weight: 400, size: 71, color: '#ffffff', case: 'ORIGINAL', tracking: 0 },
        // 曲名/アーティストは"Title / Artist"の1文字列として組む（区切りは半角スラッシュ、実物どおり）。
        // [EP]プレフィックスは落とさない（Weeklyの取り込み規則、generator-weekly-design.md §1）。
        // 和文アーティスト（石若駿、サバシスターなど）が混じるため、metaと同じ和文フォールバックを持つ。
        // renderWeight: 🔵 2026-09-09、Koheiの「太く感じる」という指摘を受けて実測した。
        // 実物（2026_W-6.png、30行）と突き合わせると幅は±0.5pxで一致する一方、インクの量は
        // 欧文だけの行でも +20.1%、和文まじりの行でも同程度に濃く出ていた。和文だけの問題ではなく、
        // SPEC §9.5 の「ChromeのfillTextはFigmaよりインクが濃い」がこの小さい文字で効いている。
        // そこで本文（TYPE.body）と同じ手当てとして、**測る太さは400のまま、描く太さだけ下げる**。
        // 350はOswald・Noto Sans JPとも可変フォントの範囲内で、字送り・折り返しは一切変わらない。
        body: { family: 'Oswald", "Noto Sans JP', weight: 400, renderWeight: 350, size: 29, color: '#ffffff', case: 'ORIGINAL', tracking: 0 },
      },
      /**
       * n行を天地の中で均等に配置する行送りとベースライン。Layout.bodyLayoutFor と同型。
       * 収まる最小行送り＝フォントサイズ（29px）を下回ったら呼び出し側がoverflowとして扱う
       * （othersFits(n)を使うこと）。
       */
      layoutFor(lineCount) {
        const n = Math.max(1, lineCount || 1);
        const { BOX, ASCENT, DESCENT } = WEEKLY.OTHERS.BODY;
        const top = BOX.y, bottom = BOX.y + BOX.h;
        const first = top + ASCENT, last = bottom - DESCENT;
        if (n === 1) return { lead: 0, baseline: (top + bottom) / 2 + (ASCENT - DESCENT) / 2 };
        return { lead: (last - first) / (n - 1), baseline: first };
      },
      fits(lineCount) {
        const n = Math.max(1, lineCount || 1);
        return n === 1 || WEEKLY.OTHERS.layoutFor(n).lead >= WEEKLY.OTHERS.TYPE.body.size;
      },
    },

    // 表紙（`cover`）🔵 2026-09-08実測（2026_W-0.png、実物投稿）。書体まわりだけKoheiから受領したファイルで校正。
    COVER: {
      // 縦帯5本。左から帯の順に何位（1〜5位、feature 1〜5の並び）を割り当てるかは
      // generator-weekly-design.md §6.2の実測どおり「1位が中央、外側ほど下位」。
      // RANK_TO_BAND[i] は「(i+1)位の作品を何番目（0=左端）の帯に描くか」。
      // 帯の並び[4,2,1,3,5]の逆写像: 1位→index2, 2位→index1, 3位→index3, 4位→index0, 5位→index4。
      BAND_ORDER: [4, 2, 1, 3, 5],
      RANK_TO_BAND: [2, 1, 3, 0, 4],
      bandCell(index) { return { x: index * 240, y: 0, w: 240, h: 1200 }; },
      // 帯の上に重なる色オーバーレイ。🔵 2026-09-09確定。Koheiから受け取ったFigmaの原本値 #0040C7・不透明度60%。
      // 実物投稿でも裏付け済み: 表紙(2026_W-0.png)の帯と、同じジャケットが無加工で写っている作品面
      // (2026_W-1〜5.png、セル200,50,800×800)を突き合わせ、dst=(1-a)*src+a*C を画素回帰で解いた。
      // 5本中4本がα=0.599〜0.602・C=(0, 63.5〜64.1, 198.6〜199.2)＝#0040C7@60%に一致し、平均誤差1.2階調。
      // （残る1本＝帯index1は縦位置・倍率が完全一致のまま横の切り出しだけ中央40%ではなく18.4%だった。
      //   手作業で作られた実物投稿側のトリミング差で、オーバーレイの値とは無関係。）
      // 再検算は tools/generator-lab/measure/overlay-of.mjs で行える。
      OVERLAY: { color: 'rgba(0,64,199,0.6)' },
      // 毛筆ロゴ。既存アセットをそのまま描く（テキストではなく画像）。下端はキャンバス下端と揃う
      // （50+1023+176.66=1199.66）ため、実装ではキャンバス下端基準で置く。
      LOGO: { x: 450, y: 1023, w: 300, h: 176.66 },
      // 週タイトル。実測（1200基準、実物投稿から）:
      //   "NEW RELEASE"      ベースライン581、インク幅477.5（実測。字間+1%込み）
      //   "{年} WEEK {週番号}" ベースライン699、インク幅508.5
      //   行送り118（＝フォントサイズと同じ。字間はあっても行送りには影響しない）
      //   どちらも中心x≈600（設計文書の「(408,499)左寄せ383×217」は誤りで、実際は中央揃え）
      // フォントはgenerator-lab/assets/alternate-gothic-no2-d-regular.ttf（Koheiから受領、fonts.mjs参照）。
      // サイズ118・字間+1%はdocs/10_投稿デザインルール.md §6の値が実測とほぼ一致した（誤差1px未満）。
      TITLE: {
        LINE1_BASELINE: 581, LINE2_BASELINE: 699, LEAD: 118, CENTER_X: 600,
      },
      TYPE: {
        // "NEW RELEASE"／週番号行はどちらも固定文言・算出値であり、Release Master由来の
        // 編集可能なテキストではないので、呼び出し側が最初から大文字で組み立てる（case:'ORIGINAL'）。
        title: { family: 'Alternate Gothic No2 D', weight: 400, size: 118, color: '#ffffff', case: 'ORIGINAL', tracking: 0.01 },
      },
    },
  };

  return {
    CANVAS, EXPORT_SUPER_SAMPLE, RULE, RULE_COLOR, PANEL_FILL, BACKGROUND, CELLS, LISTED, TYPE, TEXT, TEXT_RULE, WEEKLY,
    MIN_WEIGHT, renderWeightOf, baselinesFor, titleBaselines, bodyBand, bodyLead, bodyLayoutFor, bodyFits,
    get renderWeightDelta() { return renderWeightDelta; },
    set renderWeightDelta(v) { renderWeightDelta = v; },
  };
})();

export default Layout;
