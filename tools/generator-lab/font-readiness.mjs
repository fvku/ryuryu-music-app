import Layout from './core/layout.mjs';
import Fonts from './core/fonts.mjs';

// Google Fonts splits Japanese glyphs into many unicode-range subsets. Loading
// a fixed sample does not cover newly typed titles/body text. Resolve every
// required subset before measuring or drawing any tile.
export async function ensurePageFonts(page) {
  const text = 'BESbswyあ一RECOMMEND' + page.slots.flatMap(slot => Object.values(slot.fields)).join('');
  const requests = new Set();
  for (const font of Fonts.NEEDED) for (const weight of font.weights) {
    requests.add(`${weight} 40px "${font.family}"`);
  }
  for (const spec of Object.values(Layout.TYPE)) {
    const family = spec.family.split(',')[0].replace(/"/g, '').trim();
    requests.add(`${spec.weight} 40px "${family}"`);
    requests.add(`${Layout.renderWeightOf(spec)} 40px "${family}"`);
  }
  await Promise.all([...requests].map(font => document.fonts.load(font, text)));
  if ([...requests].some(font => !document.fonts.check(font, text))) {
    throw new Error('本文・作品名に必要なフォントを読み込めませんでした');
  }
}
