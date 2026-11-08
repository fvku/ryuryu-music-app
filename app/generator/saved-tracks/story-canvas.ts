import { coverCrop, fitText, jacketUrlCandidates, STORY, type FittedText } from "@/lib/generator/saved-tracks";

const FONT_STACK = '"Oswald", "Noto Sans JP", sans-serif';
const FONT_SHEET = "https://fonts.googleapis.com/css2?family=Oswald:wght@200;400&family=Noto+Sans+JP:wght@200;400&display=block";
const TEXT_SUPERSAMPLE = 4;

export type StoryImages = {
  title: HTMLImageElement;
  logo: HTMLImageElement;
  stills: Record<"a" | "b", HTMLImageElement>;
};

export type StoryBackground = { source: CanvasImageSource; width: number; height: number; pan: number };

export type StoryContent = {
  background: StoryBackground;
  jacket: HTMLImageElement;
  title: string;
  artist: string;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    image.src = url;
  });
}

let imagesPromise: Promise<StoryImages> | null = null;

export function loadStoryImages(): Promise<StoryImages> {
  imagesPromise ??= Promise.all(["title.png", "logo.png", "still-a.jpg", "still-b.jpg"].map(name => loadImage(`/saved-tracks/${name}`)))
    .then(([title, logo, a, b]) => ({ title, logo, stills: { a, b } }))
    .catch(error => { imagesPromise = null; throw error; });
  return imagesPromise;
}

const jackets = new Map<string, Promise<HTMLImageElement>>();

/** Spotifyの画像はCanvasへ描けるよう、既存の同一オリジンの中継を通す。 */
export function loadJacket(coverUrl: string): Promise<HTMLImageElement> {
  let task = jackets.get(coverUrl);
  if (!task) {
    task = (async () => {
      let failure: unknown;
      for (const url of jacketUrlCandidates(coverUrl)) {
        try { return await loadImage(`/api/generator/remote-image?url=${encodeURIComponent(url)}`); }
        catch (error) { failure = error; }
      }
      throw failure;
    })();
    jackets.set(coverUrl, task);
    task.catch(() => jackets.delete(coverUrl));
  }
  return task;
}

let sheetPromise: Promise<void> | null = null;

function loadFontSheet(): Promise<void> {
  sheetPromise ??= new Promise<void>((resolve, reject) => {
    const link = window.document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_SHEET;
    link.onload = () => resolve();
    link.onerror = () => { sheetPromise = null; reject(new Error("フォントを読み込めませんでした。")); };
    window.document.head.appendChild(link);
  });
  return sheetPromise;
}

/** 和文は文字ごとに分割配信されるので、実際に描く文字を渡して読み込む。 */
export async function ensureStoryFonts(texts: string[]): Promise<void> {
  await loadFontSheet();
  const sample = `${texts.join("")}…`;
  await Promise.all([STORY.text.title.weight, STORY.text.artist.weight].flatMap(weight => [
    window.document.fonts.load(`${weight} 40px "Oswald"`, sample),
    window.document.fonts.load(`${weight} 40px "Noto Sans JP"`, sample),
  ]));
}

function roundedPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function clearShadow(context: CanvasRenderingContext2D) {
  context.shadowColor = "transparent";
  context.shadowBlur = context.shadowOffsetX = context.shadowOffsetY = 0;
}

function setShadow(context: CanvasRenderingContext2D, scale: number, color: string, x: number, y: number, blur: number) {
  // shadow系の値はキャンバスの拡大縮小に従わないので、自分で倍率を掛ける。
  context.shadowColor = color;
  context.shadowOffsetX = x * scale;
  context.shadowOffsetY = y * scale;
  context.shadowBlur = blur * scale;
}

/** 半透明の面の下に影が透けないよう、面の外側だけに影を落とす（Figmaの showShadowBehindNode: false）。 */
function outerShadow(
  context: CanvasRenderingContext2D,
  scale: number,
  shape: { x: number; y: number; width: number; height: number; radius: number },
  shadow: { color: string; x: number; y: number; blur: number },
) {
  context.save();
  context.beginPath();
  context.rect(0, 0, STORY.width, STORY.height);
  context.roundRect(shape.x, shape.y, shape.width, shape.height, shape.radius);
  context.clip("evenodd");
  setShadow(context, scale, shadow.color, shadow.x, shadow.y, shadow.blur);
  context.fillStyle = "#000";
  roundedPath(context, shape.x, shape.y, shape.width, shape.height, shape.radius);
  context.fill();
  context.restore();
}

function drawCard(context: CanvasRenderingContext2D, scale: number) {
  const { card } = STORY;
  outerShadow(context, scale, card, { color: "rgba(0,0,0,.25)", x: 0, y: 4, blur: 4 });

  // CSSの linear-gradient(130.6deg, …) と同じ始点・終点。
  const angle = 130.60677507321194 * Math.PI / 180, sin = Math.sin(angle), cos = Math.cos(angle);
  const length = Math.abs(card.width * sin) + Math.abs(card.height * cos);
  const centerX = card.x + card.width / 2, centerY = card.y + card.height / 2;
  const gradient = context.createLinearGradient(
    centerX - sin * length / 2, centerY + cos * length / 2,
    centerX + sin * length / 2, centerY - cos * length / 2,
  );
  gradient.addColorStop(0.044171, "rgba(255,255,255,.1)");
  gradient.addColorStop(0.51995, "rgba(255,255,255,.024)");
  gradient.addColorStop(0.9999, "rgba(255,255,255,.056)");
  roundedPath(context, card.x, card.y, card.width, card.height, card.radius);
  context.fillStyle = gradient;
  context.fill();

  // 内側の光。面の外側に大きな枠を塗り、その影だけを面の中へ落とす。
  context.save();
  roundedPath(context, card.x, card.y, card.width, card.height, card.radius);
  context.clip();
  context.beginPath();
  context.rect(card.x - 200, card.y - 200, card.width + 400, card.height + 400);
  context.roundRect(card.x, card.y, card.width, card.height, card.radius);
  setShadow(context, scale, "rgba(255,255,255,.25)", 6, 6, 40);
  context.fillStyle = "#000";
  context.fill("evenodd");
  context.restore();

  roundedPath(context, card.x + 0.15, card.y + 0.15, card.width - 0.3, card.height - 0.3, card.radius);
  context.strokeStyle = "rgba(255,255,255,.38)";
  context.lineWidth = 0.3;
  context.stroke();
}

/** FigmaのGlassエフェクトはCanvasでは作れないので、光の当たる縁だけを細い線で近づける。 */
function drawPill(context: CanvasRenderingContext2D, scale: number) {
  const { pill } = STORY;
  outerShadow(context, scale, pill, { color: "rgba(0,0,0,.25)", x: 4, y: 4, blur: 10 });
  roundedPath(context, pill.x, pill.y, pill.width, pill.height, pill.radius);
  context.fillStyle = "rgba(0,0,0,.6)";
  context.fill();
  const rim = context.createLinearGradient(pill.x, pill.y, pill.x + pill.width, pill.y + pill.height);
  rim.addColorStop(0, "rgba(255,255,255,.16)");
  rim.addColorStop(0.5, "rgba(255,255,255,.03)");
  rim.addColorStop(1, "rgba(255,255,255,.1)");
  roundedPath(context, pill.x + 0.5, pill.y + 0.5, pill.width - 1, pill.height - 1, pill.radius - 0.5);
  context.strokeStyle = rim;
  context.lineWidth = 1;
  context.stroke();
}

function drawJacket(context: CanvasRenderingContext2D, scale: number, jacket: HTMLImageElement) {
  const { x, y, size, radius } = STORY.jacket;
  context.save();
  setShadow(context, scale, "rgba(0,0,0,.25)", 4, 4, 10);
  roundedPath(context, x, y, size, size, radius);
  context.fillStyle = "#000";
  context.fill();
  context.restore();
  context.save();
  roundedPath(context, x, y, size, size, radius);
  context.clip();
  const crop = coverCrop(jacket.naturalWidth, jacket.naturalHeight, size, size);
  context.drawImage(jacket, crop.x, crop.y, crop.width, crop.height, x, y, size, size);
  context.restore();
}

function fontOf(weight: number, size: number) {
  return `${weight} ${size}px ${FONT_STACK}`;
}

function trackedWidth(context: CanvasRenderingContext2D, text: string, tracking: number) {
  return context.measureText(text).width + Array.from(text).length * tracking;
}

/** Safariには canvas の letterSpacing が無いので1文字ずつ置く。前の文字までの幅から置くのでカーニングは保たれる。 */
function drawTracked(context: CanvasRenderingContext2D, text: string, centerX: number, baseline: number, tracking: number) {
  if (tracking === 0) {
    context.textAlign = "center";
    context.fillText(text, centerX, baseline);
    return;
  }
  context.textAlign = "left";
  const characters = Array.from(text);
  const left = centerX - trackedWidth(context, text, tracking) / 2;
  characters.forEach((character, index) => {
    const before = characters.slice(0, index).join("");
    context.fillText(character, left + context.measureText(before).width + index * tracking, baseline);
  });
}

function drawTexts(context: CanvasRenderingContext2D, scale: number, title: string, artist: string): boolean {
  const { text, pill } = STORY;
  const fit = (value: string, spec: typeof text.title | typeof text.artist): FittedText => fitText(
    value,
    { size: spec.size, minSize: spec.minSize, maxWidth: text.maxWidth },
    (candidate, size) => {
      context.font = fontOf(spec.weight, size);
      return trackedWidth(context, candidate, size * spec.tracking);
    },
  );
  const fittedTitle = fit(title, text.title), fittedArtist = fit(artist, text.artist);

  // 影は2行まとめて1回だけ落とす。1文字ずつ描くと影が重なって濃くなる。
  // 等倍のcanvas文字はmacOSで太って見えるので、Figmaの細さに合わせて4倍で描いてから縮小する（Monthly等と同じ）。
  const layer = window.document.createElement("canvas");
  layer.width = Math.ceil(pill.width * scale * TEXT_SUPERSAMPLE);
  layer.height = Math.ceil(pill.height * scale * TEXT_SUPERSAMPLE);
  const inner = layer.getContext("2d");
  if (!inner) return false;
  inner.scale(scale * TEXT_SUPERSAMPLE, scale * TEXT_SUPERSAMPLE);
  inner.translate(-pill.x, -pill.y);
  inner.fillStyle = "#fff";
  inner.textBaseline = "alphabetic";
  inner.font = fontOf(text.title.weight, fittedTitle.size);
  drawTracked(inner, fittedTitle.text, text.centerX, text.title.baseline, fittedTitle.size * text.title.tracking);
  inner.font = fontOf(text.artist.weight, fittedArtist.size);
  drawTracked(inner, fittedArtist.text, text.centerX, text.artist.baseline, 0);

  context.save();
  setShadow(context, scale, "rgba(0,0,0,.3)", 10, 10, 40);
  context.drawImage(layer, pill.x, pill.y, pill.width, pill.height);
  context.restore();
  return fittedTitle.truncated || fittedArtist.truncated;
}

/** 1枚を描く。scale は 1080×1920 に対する倍率。文字を省略したときは true を返す。 */
export function drawStory(context: CanvasRenderingContext2D, content: StoryContent, images: StoryImages, scale: number): boolean {
  const { background, jacket } = content;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  clearShadow(context);

  const crop = coverCrop(background.width, background.height, STORY.width, STORY.height, background.pan);
  context.drawImage(background.source, crop.x, crop.y, crop.width, crop.height, 0, 0, STORY.width, STORY.height);

  drawCard(context, scale);
  drawPill(context, scale);
  drawJacket(context, scale, jacket);
  const truncated = drawTexts(context, scale, content.title, content.artist);

  const { logo, title } = STORY;
  const logoCrop = coverCrop(images.logo.naturalWidth, images.logo.naturalHeight, logo.width, logo.height);
  context.save();
  context.globalCompositeOperation = "screen";
  context.drawImage(images.logo, logoCrop.x, logoCrop.y, logoCrop.width, logoCrop.height, logo.x, logo.y, logo.width, logo.height);
  context.restore();

  const fit = Math.min(title.width / images.title.naturalWidth, title.height / images.title.naturalHeight);
  const titleWidth = images.title.naturalWidth * fit, titleHeight = images.title.naturalHeight * fit;
  context.drawImage(images.title, title.x + (title.width - titleWidth) / 2, title.y + (title.height - titleHeight) / 2, titleWidth, titleHeight);

  context.fillStyle = "#fff";
  for (const dot of STORY.dots) {
    context.beginPath();
    context.arc(dot.x, dot.y, dot.diameter / 2, 0, Math.PI * 2);
    context.fill();
  }
  return truncated;
}
