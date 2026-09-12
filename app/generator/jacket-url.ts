"use client";

/**
 * 画像URLからジャケットの画像ファイルを作る。
 *
 * 貼り付けたURLをそのまま文書へ持たせる方法は採らない。`item.source.coverUrl`はRelease Master由来の
 * 取り込み原稿で、次の読み直しで上書きされるため、利用者が貼った値の置き場所にはできない。
 * 代わりに**ブラウザで画像を読み、既存のジャケット差し替え（非公開Storageの画像）として保存する**。
 * これならAPIも保存形式も変えずに済み、差し替え済みの画像として描画・保存・履歴に乗る。
 *
 * 読み込みは描画と同じ`crossOrigin = "anonymous"`で行う。CORSを許していない配信元では
 * canvasから取り出せないので、その場合は理由を返してファイル選択へ誘導する。
 */
import { httpsImageUrl } from "@/lib/generator/cover-source";

const MAX_SIDE = 2400;
const QUALITY = 0.92;

export class JacketUrlError extends Error {}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    // onerrorでは、CORSで止められたのか404なのかを区別できない。
    // 実際に多いのはCORS非対応の配信元（Bandcampのf4.bcbits.comなど、2026-09-13に実測）なので、
    // そちらを先に挙げ、いま使える手順まで書く。
    image.onerror = () => reject(new JacketUrlError(
      "この画像はブラウザから読み込めませんでした。配信元がブラウザからの読み取りを許していない（Bandcampなど）か、"
      + "URLが画像を直接指していない可能性があります。画像を保存してから、上のファイル選択で差し替えてください。",
    ));
    image.src = src;
  });
}

export async function jacketFileFromUrl(value: string): Promise<File> {
  const src = httpsImageUrl(value);
  if (!src) throw new JacketUrlError("httpsで始まる画像のURLを貼り付けてください。");
  const image = await load(src);
  const side = Math.max(image.naturalWidth, image.naturalHeight);
  if (!side) throw new JacketUrlError("画像の大きさを読み取れませんでした。");
  const scale = side > MAX_SIDE ? MAX_SIDE / side : 1;
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new JacketUrlError("画像を変換できませんでした。");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => {
    try {
      canvas.toBlob(resolve, "image/jpeg", QUALITY);
    } catch {
      // canvasが汚染されている（配信元がCORSを許していない）。
      resolve(null);
    }
  });
  if (!blob) {
    throw new JacketUrlError("この配信元の画像はブラウザから取り出せません。画像を保存してから、ファイルを選んでください。");
  }
  return new File([blob], "jacket.jpg", { type: "image/jpeg" });
}
