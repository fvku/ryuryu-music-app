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
    await loadStylesheet();
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
  }
  return { loadAll, NEEDED };
})();

export default Fonts;
