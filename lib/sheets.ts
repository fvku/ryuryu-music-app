import { google } from "googleapis";
import { Score } from "./types";
import { dedupeLatestScores } from "./score-utils";
import { getGoogleAuth } from "./google-auth";

function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getGoogleAuth(true) });
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) throw new Error("GOOGLE_SPREADSHEET_ID is not set");
  return id;
}

/**
 * UID優先のアルバム一致判定。
 * 行と検索条件の両方にUIDがあればUIDのみで判定し（改名に耐える）、
 * どちらかが欠けていれば従来のtitle+artist（trim後完全一致）で判定する。
 */
function matchesAlbum(
  rowUid: string | undefined,
  rowTitle: string | undefined,
  rowArtist: string | undefined,
  uid: string | undefined,
  albumTitle: string,
  artistName: string
): boolean {
  const ru = (rowUid ?? "").trim();
  if (ru && uid) return ru === uid;
  return (rowTitle ?? "").trim() === albumTitle.trim() && (rowArtist ?? "").trim() === artistName.trim();
}

export async function initScoresSheet(): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const scoresRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "scores!A1:H1",
  });
  if (!scoresRes.data.values || scoresRes.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "scores!A1:H1",
      valueInputOption: "RAW",
      requestBody: {
        values: [["reviewId", "memberName", "score", "comment", "submittedAt", "albumTitle", "artistName", "albumUid"]],
      },
    });
  }
}

function rowToScore(row: string[]): Score {
  return {
    reviewId: row[0] || "",
    memberName: row[1] || "",
    score: row[2] !== "" && row[2] !== undefined ? parseFloat(row[2]) : null,
    comment: row[3] || "",
    submittedAt: row[4] || "",
    albumTitle: row[5] || "",
    artistName: row[6] || "",
    albumUid: (row[7] || "").trim(),
  };
}

export async function getAllScores(): Promise<Score[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "scores!A2:H" });
  const rows = response.data.values;
  if (!rows || rows.length === 0) return [];
  return rows.filter((row) => row[0]).map(rowToScore);
}

export async function getScoresForAlbum(albumTitle: string, artistName: string, albumUid?: string): Promise<Score[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "scores!A2:H",
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) return [];

  const matched = rows
    .filter((row) => matchesAlbum(row[7], row[5], row[6], albumUid, albumTitle, artistName))
    .map(rowToScore);

  // 同一メンバーの重複エントリは最新のもののみ残す（単一アルバム内なのでメンバー単位で判定）
  return dedupeLatestScores(matched, false);
}

export async function addScore(scoreData: Omit<Score, "submittedAt"> & { submittedAt?: string }): Promise<Score> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const submittedAt = scoreData.submittedAt ?? new Date().toISOString();
  const score: Score = { ...scoreData, submittedAt };

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "scores!A:H",
    valueInputOption: "RAW",
    requestBody: {
      values: [[score.reviewId, score.memberName, score.score ?? "", score.comment, score.submittedAt, score.albumTitle || "", score.artistName || "", score.albumUid || ""]],
    },
  });

  return score;
}

export async function hasScore(albumTitle: string, artistName: string, memberName: string, altNames: string[] = [], albumUid?: string): Promise<boolean> {
  const scores = await getScoresForAlbum(albumTitle, artistName, albumUid);
  const allNames = [memberName, ...altNames].map((n) => n.trim().toLowerCase());
  return scores.some((s) => allNames.includes(s.memberName.trim().toLowerCase()));
}

export async function updateScore(
  albumTitle: string,
  artistName: string,
  memberName: string, // canonical value to STORE
  score: number | null,
  comment: string,
  altNames: string[] = [], // additional names to SEARCH by (backward compat)
  submittedAtOverride?: string,
  albumUid?: string
): Promise<Score | null> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "scores!A2:H" });
  const rows = response.data.values;
  if (!rows) return null;

  const allSearchNames = [memberName, ...altNames].map((n) => n.trim().toLowerCase());
  const rowIndex = rows.findIndex(
    (row) => matchesAlbum(row[7], row[5], row[6], albumUid, albumTitle, artistName) && allSearchNames.includes(row[1]?.trim().toLowerCase() ?? "")
  );
  if (rowIndex === -1) return null;

  const sheetRowNumber = rowIndex + 2;
  const submittedAt = submittedAtOverride ?? new Date().toISOString();
  const existingReviewId = rows[rowIndex][0] || "";
  // UID未設定の旧行はこの機会にバックフィルする
  const storedUid = (rows[rowIndex][7] || "").trim() || albumUid || "";

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `scores!A${sheetRowNumber}:H${sheetRowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[existingReviewId, memberName, score ?? "", comment, submittedAt, albumTitle, artistName, storedUid]],
    },
  });

  return { reviewId: existingReviewId, memberName, score, comment, submittedAt, albumTitle, artistName, albumUid: storedUid };
}

export interface Recommendation {
  id: string;
  recommenderId: string;
  albumNo: string;
  albumTitle: string;
  artistName: string;
  coverUrl: string;
  message: string;
  createdAt: string;
  mentionedEmails: string[];
  albumUid: string;
}

export async function initRecommendationsSheet(): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const header = [["id", "recommenderId", "albumNo", "albumTitle", "artistName", "coverUrl", "message", "createdAt", "mentionedEmails", "albumUid"]];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "recommendations!A1:J1" });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({ spreadsheetId, range: "recommendations!A1:J1", valueInputOption: "RAW", requestBody: { values: header } });
    }
  } catch {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: "recommendations" } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId, range: "recommendations!A1:J1", valueInputOption: "RAW", requestBody: { values: header } });
  }
}

export async function getAllRecommendations(): Promise<Recommendation[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "recommendations!A2:J" });
  const rows = res.data.values;
  if (!rows || rows.length === 0) return [];
  return rows.filter((row) => row[0]).map((row) => ({
    id: row[0] || "",
    recommenderId: row[1] || "",
    albumNo: row[2] || "",
    albumTitle: row[3] || "",
    artistName: row[4] || "",
    coverUrl: row[5] || "",
    message: row[6] || "",
    createdAt: row[7] || "",
    mentionedEmails: row[8] ? row[8].split(",").map((e: string) => e.trim()).filter(Boolean) : [],
    albumUid: (row[9] || "").trim(),
  }));
}

export async function getRecommendationsForUser(userEmail: string): Promise<Recommendation[]> {
  const all = await getAllRecommendations();
  const email = userEmail.toLowerCase();
  return all.filter((r) => r.mentionedEmails.includes(email));
}

export async function addRecommendation(data: Omit<Recommendation, "id" | "createdAt">): Promise<Recommendation> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const id = `rec_${Date.now()}`;
  const createdAt = new Date().toISOString();
  const rec: Recommendation = { id, createdAt, ...data };
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "recommendations!A:J",
    valueInputOption: "RAW",
    requestBody: { values: [[rec.id, rec.recommenderId, rec.albumNo, rec.albumTitle, rec.artistName, rec.coverUrl, rec.message, rec.createdAt, rec.mentionedEmails.join(","), rec.albumUid || ""]] },
  });
  return rec;
}

// ── Bookmarks ──────────────────────────────────────────────

export interface Bookmark {
  memberName: string;
  albumTitle: string;
  artistName: string;
  savedAt: string;
  albumUid: string;
}

async function initBookmarksSheet(sheets: ReturnType<typeof getSheetsClient>, spreadsheetId: string): Promise<void> {
  const newHeader = [["memberName", "albumTitle", "artistName", "savedAt", "albumUid"]];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "bookmarks!A1:E1" });
    const colB = res.data.values?.[0]?.[1] || "";
    const colE = res.data.values?.[0]?.[4] || "";
    if (colB !== "albumTitle" || colE !== "albumUid") {
      // ヘッダーが旧フォーマット（albumNo / albumUidなし）または空 → 新フォーマットに更新
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: "bookmarks!A1:E1", valueInputOption: "RAW",
        requestBody: { values: newHeader },
      });
    }
  } catch {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: "bookmarks" } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: "bookmarks!A1:E1", valueInputOption: "RAW",
      requestBody: { values: newHeader },
    });
  }
}

export async function getBookmarks(memberName: string): Promise<Bookmark[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await initBookmarksSheet(sheets, spreadsheetId);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "bookmarks!A2:E" });
  const rows = res.data.values;
  if (!rows || rows.length === 0) return [];
  return rows.filter((row) => row[0]?.trim().toLowerCase() === memberName.trim().toLowerCase()).map((row) => ({
    memberName: row[0] || "",
    albumTitle: row[1] || "",
    artistName: row[2] || "",
    savedAt: row[3] || "",
    albumUid: (row[4] || "").trim(),
  }));
}

export async function addBookmark(memberName: string, albumTitle: string, artistName: string, albumUid?: string): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await initBookmarksSheet(sheets, spreadsheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: "bookmarks!A:E", valueInputOption: "RAW",
    requestBody: { values: [[memberName, albumTitle, artistName, new Date().toISOString(), albumUid || ""]] },
  });
}

// ── Sync Pending ──────────────────────────────────────────────

export interface SyncPending {
  albumNo: string;
  memberEmail: string;
  cellValue: string;
  detectedAt: string;
}

async function initSyncPendingSheet(sheets: ReturnType<typeof getSheetsClient>, spreadsheetId: string): Promise<void> {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "sync_pending!A1:D1" });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: "sync_pending!A1:D1", valueInputOption: "RAW",
        requestBody: { values: [["albumNo", "memberEmail", "cellValue", "detectedAt"]] },
      });
    }
  } catch {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: "sync_pending" } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: "sync_pending!A1:D1", valueInputOption: "RAW",
      requestBody: { values: [["albumNo", "memberEmail", "cellValue", "detectedAt"]] },
    });
  }
}

export async function getAllSyncPending(): Promise<SyncPending[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await initSyncPendingSheet(sheets, spreadsheetId);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "sync_pending!A2:D" });
  const rows = res.data.values;
  if (!rows || rows.length === 0) return [];
  return rows
    .filter((row) => row[0] && row[1])
    .map((row) => ({
      albumNo: row[0] || "",
      memberEmail: row[1] || "",
      cellValue: row[2] || "",
      detectedAt: row[3] || "",
    }));
}

export async function upsertSyncPending(albumNo: string, memberEmail: string, cellValue: string): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await initSyncPendingSheet(sheets, spreadsheetId);

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "sync_pending!A2:D" });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((r) => r[0] === albumNo && r[1] === memberEmail);

  if (rowIndex !== -1) {
    const existing = rows[rowIndex];
    if (existing[2] === cellValue) return; // same value, don't reset timer
    // value changed → reset timer
    const sheetRow = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `sync_pending!A${sheetRow}:D${sheetRow}`, valueInputOption: "RAW",
      requestBody: { values: [[albumNo, memberEmail, cellValue, new Date().toISOString()]] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: "sync_pending!A:D", valueInputOption: "RAW",
      requestBody: { values: [[albumNo, memberEmail, cellValue, new Date().toISOString()]] },
    });
  }
}

export async function removeSyncPending(albumNo: string, memberEmail: string): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await initSyncPendingSheet(sheets, spreadsheetId);

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "sync_pending!A2:D" });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((r) => r[0] === albumNo && r[1] === memberEmail);
  if (rowIndex === -1) return;

  const sheetRow = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `sync_pending!A${sheetRow}:D${sheetRow}`, valueInputOption: "RAW",
    requestBody: { values: [["", "", "", ""]] },
  });
}

export async function removeBookmark(memberName: string, albumTitle: string, artistName: string, albumUid?: string): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await initBookmarksSheet(sheets, spreadsheetId);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "bookmarks!A2:E" });
  const rows = res.data.values;
  if (!rows) return;
  const rowIndex = rows.findIndex(
    (row) =>
      row[0]?.trim().toLowerCase() === memberName.trim().toLowerCase() &&
      matchesAlbum(row[4], row[1], row[2], albumUid, albumTitle, artistName)
  );
  if (rowIndex === -1) return;
  const sheetRow = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `bookmarks!A${sheetRow}:E${sheetRow}`, valueInputOption: "RAW",
    requestBody: { values: [["", "", "", "", ""]] },
  });
}
