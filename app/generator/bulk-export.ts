import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import type { GeneratorDocument } from "@/lib/generator/model";

/** まとめる前の1枚。canvasは解放済みで、ここにはPNGの実体だけが残る。 */
export type ArchiveEntry = { name: string; blob: Blob };

/**
 * 複数のPNGを1つのファイルへまとめる役。
 * PNGは既に圧縮済みなので、ZIP側では再圧縮しない（method 0 = stored）。
 */
export type ArchivePacker = (entries: ArchiveEntry[]) => Promise<Blob>;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32(value: number, bytes: Uint8Array): number {
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value;
}

async function blobCrc32(blob: Blob): Promise<number> {
  // Blobのstreamを順に読むため、CRC計算でもPNG全体を追加のArrayBufferへ複製しない。
  const reader = blob.stream().getReader();
  let value = 0xffffffff;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      value = updateCrc32(value, chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(value: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, value.getFullYear()));
  return {
    time: ((value.getHours() & 31) << 11) | ((value.getMinutes() & 63) << 5) | ((Math.floor(value.getSeconds() / 2)) & 31),
    date: (((year - 1980) & 127) << 9) | (((value.getMonth() + 1) & 15) << 5) | (value.getDate() & 31),
  };
}

class ZipWriter {
  readonly bytes: Uint8Array<ArrayBuffer>;
  private readonly view: DataView;
  private offset = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(new ArrayBuffer(size));
    this.view = new DataView(this.bytes.buffer);
  }

  u16(value: number) {
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  u32(value: number) {
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
  }

  raw(value: Uint8Array) {
    this.bytes.set(value, this.offset);
    this.offset += value.length;
  }
}

type ZipRecord = {
  name: Uint8Array;
  blob: Blob;
  crc: number;
  size: number;
  offset: number;
};

function localHeader(record: ZipRecord, date: number, time: number): Uint8Array<ArrayBuffer> {
  const writer = new ZipWriter(30 + record.name.length);
  writer.u32(0x04034b50);
  writer.u16(20); // 展開に必要なバージョン
  writer.u16(0x0800); // ファイル名はUTF-8
  writer.u16(0); // 圧縮方式 0 = stored
  writer.u16(time); writer.u16(date);
  writer.u32(record.crc);
  writer.u32(record.size); writer.u32(record.size);
  writer.u16(record.name.length); writer.u16(0);
  writer.raw(record.name);
  return writer.bytes;
}

function centralHeader(record: ZipRecord, date: number, time: number): Uint8Array<ArrayBuffer> {
  const writer = new ZipWriter(46 + record.name.length);
  writer.u32(0x02014b50);
  writer.u16(20); writer.u16(20);
  writer.u16(0x0800); writer.u16(0);
  writer.u16(time); writer.u16(date);
  writer.u32(record.crc);
  writer.u32(record.size); writer.u32(record.size);
  writer.u16(record.name.length); writer.u16(0); writer.u16(0);
  writer.u16(0); writer.u16(0); writer.u32(0);
  writer.u32(record.offset);
  writer.raw(record.name);
  return writer.bytes;
}

function endRecord(count: number, centralSize: number, centralOffset: number): Uint8Array<ArrayBuffer> {
  const writer = new ZipWriter(22);
  writer.u32(0x06054b50);
  writer.u16(0); writer.u16(0);
  writer.u16(count); writer.u16(count);
  writer.u32(centralSize); writer.u32(centralOffset);
  writer.u16(0);
  return writer.bytes;
}

/** ZIP32の範囲で、複数のBlobを再圧縮せず1つのアーカイブへまとめる。 */
async function packArchive(entries: ArchiveEntry[]): Promise<Blob> {
  if (entries.length > 0xffff) throw new Error("ZIPに入れられるファイル数を超えています。");
  const encoder = new TextEncoder();
  const records: ZipRecord[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    if (!name.length || name.length > 0xffff) throw new Error("ZIP内のファイル名が不正です。");
    if (entry.blob.size > 0xffffffff) throw new Error(`${entry.name} がZIP32の上限を超えています。`);
    const record = { name, blob: entry.blob, crc: await blobCrc32(entry.blob), size: entry.blob.size, offset };
    records.push(record);
    offset += 30 + name.length + record.size;
    if (offset > 0xffffffff) throw new Error("ZIPの合計サイズがZIP32の上限を超えています。");
  }

  const { date, time } = dosDateTime(new Date());
  const parts: BlobPart[] = [];
  for (const record of records) parts.push(localHeader(record, date, time), record.blob);

  const centralOffset = offset;
  for (const record of records) {
    const header = centralHeader(record, date, time);
    parts.push(header);
    offset += header.length;
  }
  const centralSize = offset - centralOffset;
  if (offset + 22 > 0xffffffff) throw new Error("ZIPの合計サイズがZIP32の上限を超えています。");
  parts.push(endRecord(records.length, centralSize, centralOffset));
  return new Blob(parts, { type: "application/zip" });
}

export function getArchivePacker(): ArchivePacker | null {
  return packArchive;
}

type Named = Pick<GeneratorDocument, "series" | "period">;

function seriesSlug(value: Named): string {
  return value.series === "japan" ? "monthly-japan" : value.series === "weekly" ? "weekly" : "monthly";
}

function isoWeek(value: string): { year: number; week: number } {
  const source = new Date(`${value}T00:00:00.000Z`), thursday = new Date(source);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear(), yearStart = new Date(Date.UTC(year, 0, 1));
  return { year, week: Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7) };
}

/** 1枚書き出しと一括書き出しで同じ規則を使う。例: monthly_26_08_02.png */
export function pngFileName(value: Named, no: number): string {
  if (value.series === "weekly") {
    const { year, week } = isoWeek(value.period.start);
    return `weekly_${String(year).slice(2)}_W${String(value.period.weekNumber ?? week).padStart(2, "0")}_${String(no).padStart(2, "0")}.png`;
  }
  const [year, month] = value.period.start.slice(0, 7).split("-");
  return `${seriesSlug(value)}_${year.slice(2)}_${month}_${String(no).padStart(2, "0")}.png`;
}

/** まとめたファイルの名前。例: monthly_26_08.zip */
export function archiveFileName(value: Named): string {
  if (value.series === "weekly") {
    const { year, week } = isoWeek(value.period.start);
    return `weekly_${String(year).slice(2)}_W${String(value.period.weekNumber ?? week).padStart(2, "0")}.zip`;
  }
  const [year, month] = value.period.start.slice(0, 7).split("-");
  return `${seriesSlug(value)}_${year.slice(2)}_${month}.zip`;
}

/** はみ出し等で1枚でも書き出せない場合は、何も作らずに止める。 */
export class BulkExportBlocked extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super("書き出せない画像があります。");
    this.name = "BulkExportBlocked";
    this.reasons = reasons;
  }
}

export class BulkExportAborted extends Error {
  constructor() {
    super("書き出しを中止しました。");
    this.name = "BulkExportAborted";
  }
}

/** 描画コアへの入口。テストから差し替えられるよう、呼び出し側で束ねて渡す。 */
export type BulkExportDeps<Prepared> = {
  prepare(page: CanvasPreviewPage): Promise<Prepared>;
  /** 1枚ずつのはみ出し検査。描画と同じ `inspectPage` を使う。 */
  inspect(prepared: Prepared): string[];
  numberOf(prepared: Prepared): number;
  render(prepared: Prepared): Promise<HTMLCanvasElement>;
  toBlob(canvas: HTMLCanvasElement): Promise<Blob>;
  /** 2400px のキャンバスを持ち続けると落ちるので、1枚ごとに必ず解放する。 */
  release(canvas: HTMLCanvasElement): void;
};

export type BulkProgress = { phase: "check" | "render"; done: number; total: number };

/**
 * 全ページを順に描いてPNGの一覧を作る。
 *
 * - 先に全ページを検査し、1枚でも書き出せなければ何も作らずに止める。
 *   文書全体の未保存で止める既存の条件（仕様書§7）は呼び出し側が先に判定する。
 * - 描画は1枚ずつで、キャンバスは都度解放する。
 * - 中止は各段の区切りで効く。描画中の1枚は最後まで進む。
 */
export async function buildArchiveEntries<Prepared>({
  document: value,
  pages,
  deps,
  onProgress,
  shouldAbort,
}: {
  document: Named;
  pages: CanvasPreviewPage[];
  deps: BulkExportDeps<Prepared>;
  onProgress(progress: BulkProgress): void;
  shouldAbort(): boolean;
}): Promise<ArchiveEntry[]> {
  const total = pages.length;
  const prepared: Prepared[] = [];
  const blocked: string[] = [];

  for (const [index, page] of pages.entries()) {
    if (shouldAbort()) throw new BulkExportAborted();
    const ready = await deps.prepare(page);
    prepared.push(ready);
    const warnings = deps.inspect(ready);
    if (warnings.length > 0) blocked.push(`画像 ${deps.numberOf(ready)}: ${warnings.join(" / ")}`);
    onProgress({ phase: "check", done: index + 1, total });
  }
  if (blocked.length > 0) throw new BulkExportBlocked(blocked);

  const entries: ArchiveEntry[] = [];
  for (const [index, ready] of prepared.entries()) {
    if (shouldAbort()) throw new BulkExportAborted();
    const canvas = await deps.render(ready);
    try {
      entries.push({ name: pngFileName(value, deps.numberOf(ready)), blob: await deps.toBlob(canvas) });
    } finally {
      deps.release(canvas);
    }
    onProgress({ phase: "render", done: index + 1, total });
  }
  return entries;
}
