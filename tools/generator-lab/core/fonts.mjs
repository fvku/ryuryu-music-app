import Layout from "./layout.mjs";
// ============================================================
// fonts.js — Google Fonts の読込（tools/timetable/editor/js/fonts.js を縮小して流用）
// 本ツールが使う書体は Oswald と Noto Sans JP の2つだけ。
// 注意: <link> の読み込み完了を待たずに document.fonts.load() を呼ぶと、
//       @font-face がまだ登録されていないため即座に解決してしまい、
//       以後フォールバック書体で組まれる。link.onload を必ず待つこと。
// ============================================================
const Fonts = (() => {
  const NEEDED = [
    { family: 'Oswald', weights: [200, 300, 400] },
    { family: 'Noto Sans JP', weights: [300, 400] },
  ];

  // Weekly（NEW RELEASE WEEK）表紙の書体。Google Fontsに無いためセルフホスト（SPEC変更不要、
  // generator-weekly-design.md §9-1）。Koheiが過去にフォントバンドルで入手したファイル
  // （権利者表記: URW Software, Copyright 1994 by URW。ライセンス文言の埋め込みは無い）を
  // 2026-09-08に受領し、使用の許可を得た。`assets/`直下に置く理由はwave.png・jacket_2000.webpと同じ
  // （スタンドアロン版のserve.mjsとNext.jsアプリの両方から、モジュール相対で解決できる場所にするため）。
  // `new URL(..., import.meta.url)` はモジュール自身の実際の取得元を基準にするため、
  // どちらの環境で読み込まれても正しいURLになる（wave.png等のようにNext.js側の静的importを
  // 呼び出し元に持たせる方式は取っていない。fonts.mjsはGoogle Fontsも含めて常に自分でURLを持つ設計のため）。
  const SELF_HOSTED = [
    { family: 'Alternate Gothic No2 D', file: 'alternate-gothic-no2-d-regular.ttf', weight: '400' },
  ];
  // 表紙（cover）専用の書体。Monthly／Japanはこれを一切使わないので、失敗しても
  // loadAll() 全体を落とさない（＝失敗してもMonthly／Japanの生成は影響を受けない）。
  // 表紙を実際に描く側（Render.drawWeeklyCover）が document.fonts.check() で
  // 個別に確認し、読み込めていなければそこで初めてエラーにする。
  let selfHostedLoaded = null;
  function loadSelfHosted() {
    return selfHostedLoaded ||= Promise.all(SELF_HOSTED.map(async f => {
      try {
        const url = new URL(`../assets/${f.file}`, import.meta.url);
        const face = new FontFace(f.family, `url(${url})`, { weight: f.weight });
        await face.load();
        document.fonts.add(face);
      } catch (error) {
        console.error(`セルフホスト書体の読み込みに失敗しました（表紙以外には影響しません）: ${f.family}`, error);
      }
    }));
  }

  // SPEC.md §9.5: renderWeightDelta（全体一律）や t.renderWeight（要素個別、例: 本文の意匠調整）で
  // 見た目用の細いウェイトが指定されていれば、それも合わせて読み込む
  // （prepare() が測るのは常に t.weight の側なので、両方要る）。
  // renderWeightOf(t) は何も指定が無ければ t.weight をそのまま返すので、常に呼んで無害。
  function withRenderWeights() {
    const merged = NEEDED.map(f => ({ family: f.family, weights: new Set(f.weights) }));
    const find = fam => merged.find(m => m.family === fam) || (merged.push({ family: fam, weights: new Set() }), merged[merged.length - 1]);
    if (typeof Layout !== 'undefined') {
      for (const t of Object.values(Layout.TYPE)) {
        const fam = t.family.split(',')[0].replace(/"/g, '').trim();
        find(fam).weights.add(Layout.renderWeightOf(t));
      }
    }
    return merged.map(m => ({ family: m.family, weights: [...m.weights].sort((a, b) => a - b) }));
  }

  function loadStylesheet() {
    return new Promise((resolve, reject) => {
      const list = withRenderWeights();
      const params = list.map(f => `family=${f.family.replace(/ /g, '+')}:wght@${f.weights.join(';')}`).join('&');
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?${params}&display=block`;
      link.onload = resolve;
      link.onerror = () => reject(new Error('Google Fonts の読み込みに失敗しました'));
      document.head.appendChild(link);
    });
  }
  async function loadAll() {
    await Promise.all([loadStylesheet(), loadSelfHosted()]);
    // document.fonts.load() はテキストを省略すると内部の既定サンプル（ラテン文字のみ）の
    // サブセットしか読み込まない。和文フォントは CJK のサブセットを明示的に指定しないと、
    // 実際に描画する文字のグリフが読み込まれないまま document.fonts.ready が解決してしまう。
    // 発見の経緯: Zen Kaku Gothic New の検証で document.fonts.check() が false になり判明した。
    const SAMPLE = 'BESbswyあ一';
    for (const f of withRenderWeights())
      for (const w of f.weights)
        await document.fonts.load(`${w} 40px "${f.family}"`, SAMPLE);
    await document.fonts.ready;
    // 実際に目的の書体で組めているかを確認する（フォールバックのまま進むと版面が全部ずれる）
    const c = document.createElement('canvas').getContext('2d');
    c.font = '400 100px "Oswald"';       const a = c.measureText('Melaina Kol').width;
    c.font = '400 100px sans-serif';     const b = c.measureText('Melaina Kol').width;
    if (Math.abs(a - b) < 1) throw new Error('Oswald が適用されていません（フォールバック書体のままです）');
    // 和文の全角グリフは書体を問わず送り幅がほぼ1emに揃うため、上と同じ幅の比較トリックが使えない。
    // document.fonts.check() で「その書体が実際に登録されているか」を直接確認する
    // （Figma の Oswald→和文フォールバックと同じ事故を、ここでも黙って起こさないため）。
    if (!document.fonts.check('700 40px "Zen Kaku Gothic New"', '一'))
      throw new Error('Zen Kaku Gothic New が適用されていません（フォールバック書体のままです）');
    // Alternate Gothic No2 D は表紙（weekly cover）専用。ここでは検証しない＝失敗していても
    // Monthly／Japan／作品面／Other Releasesの生成を止めない。表紙側の検証はcoverFontReady()。
  }
  /** 表紙を描く直前に呼ぶ。セルフホスト書体が実際に使える状態かをここで初めて厳密に確認する。 */
  function coverFontReady() {
    return document.fonts.check(`${SELF_HOSTED[0].weight} 40px "${SELF_HOSTED[0].family}"`);
  }
  return { loadAll, NEEDED, SELF_HOSTED, coverFontReady };
})();

export default Fonts;
