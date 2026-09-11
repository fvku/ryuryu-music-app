/**
 * プレイリストの収録内容を蓄積するアーカイブ。
 *
 * 埋め込みページから読めるのは先頭100曲までで、しかも日付順ではない。
 * 101曲目以降に今日のリリースが埋まっていることがあり、その回のクロールでは取れない。
 * プレイリストは随時入れ替わるので、日々クロールして見えたものを貯めておけば、
 * 後日100曲の窓に入ってきた時点で拾える。その貯蔵庫がこのシート。
 *
 * 保存先はアプリ用スプレッドシートの `playlist_archive` シート。
 *   A=playlistId, B=label, C=kind, D=key, E=name, F=months, G=firstSeenAt, H=lastSeenAt
 *
 * months は「その収録曲のアルバムのリリース月」（"YYYY/MM" のカンマ区切り）。
 * 照合時にこの月を使って対象行を絞る。これが無いと、判定基準が
 * 「そのアーティストの曲が1曲でも入っているか」なので、
 * 2年前にプレイリストへ載ったアーティストの新作にまでタグが付いてしまう。
 */

import { google } from "googleapis";
import { getGoogleAuth } from "@/lib/google-auth";

const SHEET_NAME = "playlist_archive";

/** 何か月分を保持するか。これより古いエントリは書き込み時に捨てる */
const RETENTION_MONTHS = 15;

/** 1エントリが持つ月の上限（古いものから捨てる） */
const MAX_MONTHS_PER_ENTRY = 24;

/** 照合時に許す月のズレ。Release Master の日付は掲載週なので、リリース月と1か月ずれることがある */
export const MONTH_TOLERANCE = 1;

/** 索引の経路。lib/ops/sync-playlist-tags.ts の4つの索引に対応する */
export type ArchiveKind = "albumId" | "albumKey" | "artistId" | "artistName";

export interface ArchiveEntry {
  playlistId: string;
  /** 書き込むプレイリスト表示名 */
  label: string;
  kind: ArchiveKind;
  /** 照合キー（アルバムID、アルバム名::アーティスト名、アーティストID、正規化済みアーティスト名） */
  key: string;
  /** 人が読むための名前。照合には使わない */
  name: string;
  /** そのキーを見かけた作品のリリース月（"YYYY/MM"、昇順） */
  months: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

/** "2026-09-11" / "2026-09" → "2026/09"。年だけの粗い日付は月を特定できないので捨てる */
export function releaseDateToMonth(releaseDate: string): string {
  const m = (releaseDate ?? "").trim().match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}` : "";
}

/** "2026/09/11" や "2026/09" の先頭から "YYYY/MM" を取り出す */
export function rowDateToMonth(date: string): string {
  const m = (date ?? "").trim().match(/^(\d{4})\/(\d{1,2})/);
  return m ? `${m[1]}/${m[2].padStart(2, "0")}` : "";
}

/** "YYYY/MM" を通し番号に直す。月の差を取るため */
function monthIndex(month: string): number | null {
  const m = (month ?? "").match(/^(\d{4})\/(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 12 + Number(m[2]);
}

/** 2つの月が tolerance か月以内に収まっているか */
export function isNearMonth(a: string, b: string, tolerance = MONTH_TOLERANCE): boolean {
  const x = monthIndex(a);
  const y = monthIndex(b);
  if (x === null || y === null) return false;
  return Math.abs(x - y) <= tolerance;
}

function entryId(playlistId: string, kind: ArchiveKind, key: string): string {
  return `${playlistId}|${kind}|${key}`;
}

function spreadsheetId(): string {
  const id = process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) throw new Error("GOOGLE_SPREADSHEET_ID is not set");
  return id;
}

/** playlist_archive シートが無ければ作る */
async function ensureSheet(sheets: ReturnType<typeof google.sheets>) {
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  if (meta.data.sheets?.some((s) => s.properties?.title === SHEET_NAME)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${SHEET_NAME}!A1:H1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [["playlistId", "label", "kind", "key", "name", "months", "firstSeenAt", "lastSeenAt"]],
    },
  });
}

const VALID_KINDS: ArchiveKind[] = ["albumId", "albumKey", "artistId", "artistName"];

/** アーカイブを全件読む。シートが無ければ作って空を返す */
export async function readPlaylistArchive(): Promise<ArchiveEntry[]> {
  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });
  await ensureSheet(sheets);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET_NAME}!A2:H`,
  });

  return (res.data.values ?? [])
    .map((row) => ({
      playlistId: String(row[0] ?? "").trim(),
      label: String(row[1] ?? "").trim(),
      kind: String(row[2] ?? "").trim() as ArchiveKind,
      key: String(row[3] ?? "").trim(),
      name: String(row[4] ?? "").trim(),
      months: String(row[5] ?? "").split(",").map((m) => m.trim()).filter(Boolean),
      firstSeenAt: String(row[6] ?? ""),
      lastSeenAt: String(row[7] ?? ""),
    }))
    .filter((e) => e.playlistId && e.key && VALID_KINDS.includes(e.kind));
}

/** 日本時間の当月を "YYYY/MM" で返す */
function currentMonthTokyo(): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  return `${year}/${month.padStart(2, "0")}`;
}

/** 保持期間を過ぎたエントリか（持っている月がすべて古い） */
function isExpired(entry: ArchiveEntry, nowIndex: number): boolean {
  if (entry.months.length === 0) return false; // 月が分からないものは残す
  const newest = entry.months
    .map(monthIndex)
    .filter((v): v is number => v !== null)
    .reduce((a, b) => Math.max(a, b), -Infinity);
  if (!Number.isFinite(newest)) return false;
  return nowIndex - newest > RETENTION_MONTHS;
}

export interface MergeArchiveResult {
  added: number;
  updated: number;
  pruned: number;
  total: number;
  written: boolean;
  /** マージ後の全エントリ。照合にそのまま使える */
  entries: ArchiveEntry[];
}

/**
 * 観測したエントリをアーカイブへマージする（冪等）。
 *
 * 同じ playlistId + kind + key のエントリは月を足し合わせ、lastSeenAt を更新するだけ。
 * 追記なので、100曲の窓から外れた過去の観測は消えない。
 *
 * apply=false ならシートには書かず、マージ結果だけを返す。
 * dry-run でも本番と同じ照合結果を見せるため。
 */
export async function mergePlaylistArchive(
  observed: ArchiveEntry[],
  apply: boolean
): Promise<MergeArchiveResult> {
  const existing = await readPlaylistArchive();
  const byId = new Map<string, ArchiveEntry>();
  for (const e of existing) byId.set(entryId(e.playlistId, e.kind, e.key), e);

  const nowIndex = monthIndex(currentMonthTokyo()) ?? 0;

  // 保持期間より古い月は入れる前に落とす。
  // プレイリストには旧譜も混ざっていて、入れてもその場で期限切れになるだけ。
  // 毎回「追加してすぐ削除」を繰り返すと、変更が無いのにシート全体を書き直すことになる
  const fresh: ArchiveEntry[] = [];
  for (const o of observed) {
    const months = o.months.filter((m) => {
      const i = monthIndex(m);
      return i === null || nowIndex - i <= RETENTION_MONTHS;
    });
    // 元から月が分からないものは残す。月が分かっていて全部古いものだけ捨てる
    if (o.months.length > 0 && months.length === 0) continue;
    fresh.push({ ...o, months });
  }

  let added = 0;
  let updated = 0;

  for (const obs of fresh) {
    const id = entryId(obs.playlistId, obs.kind, obs.key);
    const current = byId.get(id);
    if (!current) {
      byId.set(id, { ...obs, months: [...new Set(obs.months)].sort() });
      added += 1;
      continue;
    }

    const before = `${current.label}|${current.months.join(",")}`;
    const months = [...new Set([...current.months, ...obs.months])].sort();
    current.months = months.slice(Math.max(0, months.length - MAX_MONTHS_PER_ENTRY));
    current.label = obs.label; // 表示名は最新のものに合わせる
    if (obs.name) current.name = obs.name;
    current.lastSeenAt = obs.lastSeenAt;
    if (`${current.label}|${current.months.join(",")}` !== before) updated += 1;
  }

  const kept: ArchiveEntry[] = [];
  let pruned = 0;
  for (const entry of byId.values()) {
    if (isExpired(entry, nowIndex)) { pruned += 1; continue; }
    kept.push(entry);
  }

  const changed = added > 0 || updated > 0 || pruned > 0;
  if (changed && apply) await writeArchive(kept);

  return { added, updated, pruned, total: kept.length, written: changed && apply, entries: kept };
}

/**
 * シートの行数を確保する。
 * 新規シートは1000行しかないため、そのまま書くと
 * "exceeds grid limits" で弾かれる。
 */
async function ensureRowCapacity(
  sheets: ReturnType<typeof google.sheets>,
  rowsNeeded: number
) {
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets(properties(sheetId,title,gridProperties))",
  });
  const props = meta.data.sheets?.find((s) => s.properties?.title === SHEET_NAME)?.properties;
  if (!props?.sheetId && props?.sheetId !== 0) return;
  if ((props.gridProperties?.rowCount ?? 0) >= rowsNeeded) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: {
      requests: [{
        updateSheetProperties: {
          properties: { sheetId: props.sheetId, gridProperties: { rowCount: rowsNeeded } },
          fields: "gridProperties.rowCount",
        },
      }],
    },
  });
}

async function writeArchive(entries: ArchiveEntry[]) {
  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });
  const id = spreadsheetId();

  // 並びを安定させておくと、シートを直接覗いたときに読める
  const sorted = [...entries].sort(
    (a, b) =>
      a.playlistId.localeCompare(b.playlistId) ||
      a.kind.localeCompare(b.kind) ||
      a.key.localeCompare(b.key)
  );

  if (sorted.length === 0) {
    await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `${SHEET_NAME}!A2:H` });
    return;
  }

  // ヘッダー1行 + データ。余白を少し持たせて、毎回リサイズしないようにする
  await ensureRowCapacity(sheets, sorted.length + 1 + 1000);

  // 先に上書きし、余った末尾だけを最後に消す。
  // 「全消し→書き直し」だと、途中で関数がタイムアウトした時に
  // アーカイブが空のまま残ってしまう
  const CHUNK = 2000;
  for (let i = 0; i < sorted.length; i += CHUNK) {
    const chunk = sorted.slice(i, i + CHUNK);
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${SHEET_NAME}!A${i + 2}:H${i + chunk.length + 1}`,
      valueInputOption: "RAW",
      requestBody: {
        values: chunk.map((e) => [
          e.playlistId, e.label, e.kind, e.key, e.name,
          e.months.join(","), e.firstSeenAt, e.lastSeenAt,
        ]),
      },
    });
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: id,
    range: `${SHEET_NAME}!A${sorted.length + 2}:H`,
  });
}

/** 照合用の索引。キー → そのキーで当たるプレイリスト名と月 */
export type ArchiveLookup = Map<string, { label: string; months: string[] }[]>;

export function lookupKey(kind: ArchiveKind, key: string): string {
  return `${kind}:${key}`;
}

/**
 * アーカイブから照合用の索引を組む。
 * 有効なプレイリストのエントリだけを残す（取得対象から外したものはタグを増やさない）。
 */
export function buildArchiveLookup(
  entries: ArchiveEntry[],
  activePlaylistIds: Set<string>
): ArchiveLookup {
  const lookup: ArchiveLookup = new Map();
  for (const e of entries) {
    if (!activePlaylistIds.has(e.playlistId)) continue;
    const k = lookupKey(e.kind, e.key);
    const list = lookup.get(k) ?? [];
    list.push({ label: e.label, months: e.months });
    lookup.set(k, list);
  }
  return lookup;
}

/**
 * 指定キーで当たるプレイリスト名を返す。
 * 行の月とエントリの月が離れているものは外す（別時期の作品への誤爆を防ぐ）。
 */
export function archiveLabelsFor(
  lookup: ArchiveLookup,
  kind: ArchiveKind,
  key: string,
  rowMonth: string
): string[] {
  if (!key || !rowMonth) return [];
  const hits = lookup.get(lookupKey(kind, key));
  if (!hits) return [];
  const labels: string[] = [];
  for (const hit of hits) {
    if (hit.months.some((m) => isNearMonth(m, rowMonth))) labels.push(hit.label);
  }
  return labels;
}
