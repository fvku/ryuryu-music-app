/**
 * プレイリスト収録情報の取得対象を管理する。
 *
 * 登録内容はアプリ用スプレッドシートの `playlists` シートに保存する。
 * 管理画面（/admin）から追加・削除できるようにするため、コードではなくシートで持つ。
 *   A=playlistId, B=label, C=enabled, D=addedAt
 *
 * Spotify公式（エディトリアル）プレイリストは Web API から読めないため、
 * 収録曲の取得は埋め込みページ経由で行う（lib/ops/sync-playlist-tags.ts）。
 */

import { google } from "googleapis";
import { getGoogleAuth } from "@/lib/google-auth";

const SHEET_NAME = "playlists";

/** シート作成時に入れておく初期値 */
const SEED_SOURCES: { playlistId: string; label: string }[] = [
  { playlistId: "37i9dQZF1DXdbXrPNafg9d", label: "All New Indie" },
];

export interface PlaylistSource {
  /** プレイリストID */
  playlistId: string;
  /** シートに書き込む表示名 */
  label: string;
  /** false なら取得対象から外れる */
  enabled: boolean;
  addedAt: string;
}

/** URL・URI・生IDのいずれからでもプレイリストIDを取り出す */
export function parsePlaylistId(urlOrId: string): string {
  const trimmed = (urlOrId ?? "").trim();
  const fromUrl = trimmed.match(/playlist[/:]([A-Za-z0-9]+)/);
  if (fromUrl) return fromUrl[1];
  return trimmed;
}

/** アルバムURL・URIからアルバムIDを取り出す。取れなければ null */
export function parseAlbumId(urlOrId: string): string | null {
  const trimmed = (urlOrId ?? "").trim();
  if (!trimmed) return null;
  const m = trimmed.match(/album[/:]([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function spreadsheetId(): string {
  const id = process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) throw new Error("GOOGLE_SPREADSHEET_ID is not set");
  return id;
}

/** playlists シートが無ければ作る（初期値つき） */
async function ensureSheet(sheets: ReturnType<typeof google.sheets>) {
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  if (meta.data.sheets?.some((s) => s.properties?.title === SHEET_NAME)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
  });
  const now = new Date().toISOString();
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${SHEET_NAME}!A1:D${SEED_SOURCES.length + 1}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        ["playlistId", "label", "enabled", "addedAt"],
        ...SEED_SOURCES.map((s) => [s.playlistId, s.label, "TRUE", now]),
      ],
    },
  });
}

/** 登録済みプレイリストを全件返す（シートが無ければ作成して初期値を返す） */
export async function readPlaylistSources(): Promise<PlaylistSource[]> {
  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });
  await ensureSheet(sheets);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET_NAME}!A2:D`,
  });

  return (res.data.values ?? [])
    .filter((row) => (row[0] ?? "").trim())
    .map((row) => ({
      playlistId: String(row[0]).trim(),
      label: String(row[1] ?? "").trim(),
      enabled: String(row[2] ?? "TRUE").trim().toUpperCase() !== "FALSE",
      addedAt: String(row[3] ?? ""),
    }));
}

/** 有効なものだけ返す */
export async function readActivePlaylistSources(): Promise<PlaylistSource[]> {
  return (await readPlaylistSources()).filter((s) => s.enabled);
}

async function writeAll(sources: PlaylistSource[]) {
  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });
  await ensureSheet(sheets);
  const id = spreadsheetId();

  await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `${SHEET_NAME}!A2:D` });
  if (sources.length === 0) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${SHEET_NAME}!A2:D${sources.length + 1}`,
    valueInputOption: "RAW",
    requestBody: {
      values: sources.map((s) => [s.playlistId, s.label, s.enabled ? "TRUE" : "FALSE", s.addedAt]),
    },
  });
}

/** 追加（同じIDが既にあれば表示名を上書きして有効化する） */
export async function addPlaylistSource(urlOrId: string, label: string): Promise<PlaylistSource[]> {
  const playlistId = parsePlaylistId(urlOrId);
  if (!playlistId) throw new Error("プレイリストURLが読み取れません");
  if (!label.trim()) throw new Error("表示名を入力してください");

  const sources = await readPlaylistSources();
  const existing = sources.find((s) => s.playlistId === playlistId);
  if (existing) {
    existing.label = label.trim();
    existing.enabled = true;
  } else {
    sources.push({ playlistId, label: label.trim(), enabled: true, addedAt: new Date().toISOString() });
  }

  await writeAll(sources);
  return sources;
}

export async function removePlaylistSource(playlistId: string): Promise<PlaylistSource[]> {
  const sources = (await readPlaylistSources()).filter((s) => s.playlistId !== playlistId);
  await writeAll(sources);
  return sources;
}

export async function setPlaylistSourceEnabled(playlistId: string, enabled: boolean): Promise<PlaylistSource[]> {
  const sources = await readPlaylistSources();
  const target = sources.find((s) => s.playlistId === playlistId);
  if (!target) throw new Error("登録されていないプレイリストです");
  target.enabled = enabled;
  await writeAll(sources);
  return sources;
}
