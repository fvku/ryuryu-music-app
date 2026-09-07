import Pages from './core/pages.mjs';

function slot(id, title, artist) {
  const raw = {
    title, artist, date: '2026-08-01', duration: '10songs, 38min 20sec',
    genreMemo: 'Indie / Alternative', country: 'JP', mjTrackNo: '3',
    mjTrack: 'A Song for Tomorrow', mjAdoption: '掲載',
    mjText: '朝の光が差し込む部屋で、ゆっくりと音楽が動き始める。静かなギターと柔らかな声が重なり、日常の小さな変化を映し出していく。繰り返されるメロディーの奥では、リズムや音色が少しずつ姿を変える。立ち止まって耳を傾けると、それまで気づかなかった響きが聞こえてくる。軽やかさの中にも確かな温もりを感じる一枚だ。これは画像の文字組みを確認するためのサンプル原稿です。',
  };
  return { ...Pages.makeSlot(Pages.normalize(raw, 'monthly'), 'monthly'), id };
}

export function demoPages() {
  return {
    listed: { id: 'sample-listed', kind: 'listed', no: 2, bgColor: '#675479',
      slots: [slot('sample-a', 'A Quiet Place\nto Begin Again', 'Sample Artist A'),
        slot('sample-b', '遠くの街から', 'サンプルアーティスト B')] },
    adopted: { id: 'sample-adopted', kind: 'adopted', no: 2, bgColor: '#405f69',
      slots: [slot('sample-c', 'A Quiet Place\nto Begin Again', 'Sample Artist C')] },
  };
}

export function snapshotPage(page) {
  return { ...page, slots: page.slots.map(slot => ({ ...slot,
    fields: { ...slot.fields }, show: { ...slot.show }, kerns: { ...slot.kerns },
    jacket: { ...slot.jacket },
    typography: structuredClone(slot.typography || {}),
  })) };
}

export async function loadImage(src) {
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise((resolve, reject) => {
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('画像を読み込めませんでした。')), { once: true });
  });
  image.src = src;
  // 非表示タブでは decode() が解決しないことがある。load 済みなら描画には使える。
  // decode() の拒否が load より先でも、load の成否が確定するまでは待つ。
  const decoded = image.decode().then(() => image).catch(() => loaded);
  return Promise.race([decoded, loaded]);
}
