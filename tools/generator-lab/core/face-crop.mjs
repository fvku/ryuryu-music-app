// ============================================================
// face-crop.mjs — 表紙（Weekly `cover`）の帯を人物の顔中心に切り抜くための顔検出。
//
// 表紙の帯（240×1200）は正方形ジャケットを高さでcover-fitし、幅方向は中央の240pxだけを見せる
// （generator-weekly-design.md §6.2）。人物が写ったジャケットは、この中央切り出しだと顔が
// 帯の外へ落ちることがある（2026-09-14、2026#37の目視で指摘）。
//
// 顔検出は MediaPipe Tasks Vision（BlazeFace short-range）をCDNから**実行時に**動的読み込みする。
// npm依存にしない理由: モデル本体（.tflite、約230KB）とWASM本体（約11MB）はどのみちHTTPで
// 取得する必要があり、webpackでバンドルする意味が無い。`vision_bundle.mjs`もCDN上のURLを
// 動的importで読むだけなので、webpackの静的解析対象から外す（webpackIgnore）。
//
// **検出できなくても失敗にしない。** ネットワーク不通・モデル未取得・顔が写っていない・
// 確信度が低い、いずれの場合もnullを返し、呼び出し側は中央切り出し（focusX=0.5、従来どおり）に
// フォールバックする。これは版面のはみ出し検出（§6.4）とは違い、出力を止める理由にはしない
// ——顔中心に寄せられないだけで、中央切り出し自体は今までどおり成立する画だから。
// ============================================================
const MODEL_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
// 全体検出でこの確信度に届かない場合だけ、2×2＋中央の5分割でも検出を試す（下記WHOLE_CONFIDENT_SCORE参照）。
const WHOLE_CONFIDENT_SCORE = 0.6;
const MIN_SCORE = 0.3;   // これを下回る検出は採用しない（中央フォールバックの方が無難）

let detectorPromise = null;
function loadDetector() {
  return detectorPromise ||= (async () => {
    const { FaceDetector, FilesetResolver } = await import(/* webpackIgnore: true */ `${MODEL_BASE}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MODEL_BASE}/wasm`);
    return FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: MIN_SCORE,
    });
  })().catch(error => { detectorPromise = null; throw error; });
}

/** 確信度が最も高い検出を返す（無ければnull）。 */
function bestOf(detections) {
  return detections.reduce((best, d) => (!best || d.categories[0].score > best.categories[0].score) ? d : best, null);
}

const focusCache = new Map();   // 画像のsrc → Promise<number|null>（同じジャケットで検出をやり直さない）

/**
 * 画像内の顔の水平中心を0〜1で返す（左端0・右端1）。検出できなければnull。
 *
 * BlazeFace short-rangeは「顔が画面の大部分を占める」自撮り向けのモデルで、
 * アルバムジャケットのように顔が画面の一部でしかない構図では全体検出だけだと見逃しやすい
 * （tools/generator-lab/face-crop-check.htmlでの実測: 2026#36/#37の10枚中、全体検出は5枚で「なし」）。
 * そこで全体検出の確信度が低いときだけ、画像を2×2＋中央の5枚（各半分サイズ）に分けて検出し直す
 * （同実測で10枚中9枚が実物の切り抜き位置と一致した）。
 */
export async function detectFocusX(image) {
  const key = image.src || image;
  if (focusCache.has(key)) return focusCache.get(key);
  const promise = (async () => {
    try {
      const detector = await loadDetector();
      const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
      if (!w || !h) return null;
      let best = bestOf(detector.detect(image).detections);
      if (!best || best.categories[0].score < WHOLE_CONFIDENT_SCORE) {
        const half = Math.round(Math.min(w, h) / 2);
        const tile = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(half, half) : document.createElement('canvas');
        tile.width = half; tile.height = half;
        const tctx = tile.getContext('2d');
        const regions = [[0, 0], [w - half, 0], [0, h - half], [w - half, h - half], [(w - half) / 2, (h - half) / 2]];
        for (const [tx, ty] of regions) {
          tctx.clearRect(0, 0, half, half);
          tctx.drawImage(image, tx, ty, half, half, 0, 0, half, half);
          for (const d of detector.detect(tile).detections) {
            const cand = { boundingBox: { originX: tx + d.boundingBox.originX, width: d.boundingBox.width }, categories: d.categories };
            if (!best || cand.categories[0].score > best.categories[0].score) best = cand;
          }
        }
      }
      if (!best || best.categories[0].score < MIN_SCORE) return null;
      return Math.min(1, Math.max(0, (best.boundingBox.originX + best.boundingBox.width / 2) / w));
    } catch {
      return null;   // モデル未取得・CORS・タイムアウト等はすべて中央フォールバック（呼び出し側の責務）
    }
  })();
  focusCache.set(key, promise);
  return promise;
}
