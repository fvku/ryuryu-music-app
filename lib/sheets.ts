import { google } from "googleapis";
import { Score } from "./types";

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  let credentials;
  try {
    const decoded = Buffer.from(keyJson, "base64").toString("utf-8");
    credentials = JSON.parse(decoded);
  } catch {
    try {
      credentials = JSON.parse(keyJson);
    } catch {
      credentials = JSON.parse(keyJson.replace(/\n/g, "\\n"));
    }
  }
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) throw new Error("GOOGLE_SPREADSHEET_ID is not set");
  return id;
}

export async function initScoresSheet(): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const scoresRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "scores!A1:G1",
  });
  if (!scoresRes.data.values || scoresRes.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "scores!A1:G1",
      valueInputOption: "RAW",
      requestBody: {
        values: [["reviewId", "memberName", "score", "comment", "submittedAt", "albumTitle", "artistName"]],
      },
    });
  }
}

export async function getAllScores(): Promise<Score[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "scores!A2:G" });
  const rows = response.data.values;
  if (!rows || rows.length === 0) return [];
  return rows.filter((row) => row[0]).map((row) => ({
    reviewId: row[0] || "",
    memberName: row[1] || "",
    score: row[2] !== "" && row[2] !== undefined ? parseFloat(row[2]) : null,
    comment: row[3] || "",
    submittedAt: row[4] || "",
    albumTitle: row[5] || "",
    artistName: row[6] || "",
  }));
}

export async function getScoresForAlbum(albumNo: string): Promise<Score[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "scores!A2:G",
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) return [];

  return rows
    .filter((row) => row[0] === albumNo)
    .map((row) => ({
      reviewId: row[0] || "",
      memberName: row[1] || "",
      score: row[2] !== "" && row[2] !== undefined ? parseFloat(row[2]) : null,
      comment: row[3] || "",
      submittedAt: row[4] || "",
      albumTitle: row[5] || "",
      artistName: row[6] || "",
    }));
}

export async function addScore(scoreData: Omit<Score, "submittedAt">): Promise<Score> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const submittedAt = new Date().toISOString();
  const score: Score = { ...scoreData, submittedAt };

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "scores!A:G",
    valueInputOption: "RAW",
    requestBody: {
      values: [[score.reviewId, score.memberName, score.score ?? "", score.comment, score.submittedAt, score.albumTitle || "", score.artistName || ""]],
    },
  });

  return score;
}

export async function hasScore(albumNo: string, memberName: string, altNames: string[] = []): Promise<boolean> {
  const scores = await getScoresForAlbum(albumNo);
  const allNames = [memberName, ...altNames].map((n) => n.trim().toLowerCase());
  return scores.some((s) => allNames.includes(s.memberName.trim().toLowerCase()));
}

export async function updateScore(
  albumNo: string,
  memberName: string, // canonical value to STORE
  score: number | null,
  comment: string,
  altNames: string[] = [] // additional names to SEARCH by (backward compat)
): Promise<Score | null> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "scores!A2:G" });
  const rows = response.data.values;
  if (!rows) return null;

  const allSearchNames = [memberName, ...altNames].map((n) => n.trim().toLowerCase());
  const rowIndex = rows.findIndex(
    (row) => row[0] === albumNo && allSearchNames.includes(row[1]?.trim().toLowerCase() ?? "")
  );
  if (rowIndex === -1) return null;

  const sheetRowNumber = rowIndex + 2;
  const submittedAt = new Date().toISOString();
  const existingAlbumTitle = rows[rowIndex][5] || "";
  const existingArtistName = rows[rowIndex][6] || "";

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `scores!A${sheetRowNumber}:G${sheetRowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[albumNo, memberName, score ?? "", comment, submittedAt, existingAlbumTitle, existingArtistName]],
    },
  });

  return { reviewId: albumNo, memberName, score, comment, submittedAt, albumTitle: existingAlbumTitle, artistName: existingArtistName };
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
}

export async function initRecommendationsSheet(): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const header = [["id", "recommenderId", "albumNo", "albumTitle", "artistName", "coverUrl", "message", "createdAt", "mentionedEmails"]];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "recommendations!A1:I1" });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({ spreadsheetId, range: "recommendations!A1:I1", valueInputOption: "RAW", requestBody: { values: header } });
    }
  } catch {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: "recommendations" } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId, range: "recommendations!A1:I1", valueInputOption: "RAW", requestBody: { values: header } });
  }
}

export async function getAllRecommendations(): Promise<Recommendation[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "recommendations!A2:I" });
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
    range: "recommendations!A:I",
    valueInputOption: "RAW",
    requestBody: { values: [[rec.id, rec.recommenderId, rec.albumNo, rec.albumTitle, rec.artistName, rec.coverUrl, rec.message, rec.createdAt, rec.mentionedEmails.join(",")]] },
  });
  return rec;
}

// ── Bookmarks ──────────────────────────────────────────────

export interface Bookmark {
  memberName: string;
  albumTitle: string;
  artistName: string;
  savedAt: string;
}

async function initBookmarksSheet(sheets: ReturnType<typeof getSheetsClient>, spreadsheetId: string): Promise<void> {
  const newHeader = [["memberName", "albumTitle", "artistName", "savedAt"]];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "bookmarks!A1:D1" });
    const colB = res.data.values?.[0]?.[1] || "";
    if (colB !== "albumTitle") {
      // ヘッダーが旧フォーマット（albumNo）または空 → 新フォーマットに更新
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: "bookmarks!A1:D1", valueInputOption: "RAW",
        requestBody: { values: newHeader },
      });
    }
  } catch {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: "bookmarks" } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: "bookmarks!A1:D1", valueInputOption: "RAW",
      requestBody: { values: newHeader },
    });
  }
}

export async function getBookmarks(memberName: string): Promise<Bookmark[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await initBookmarksSheet(sheets, spreadsheetId);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "bookmarks!A2:D" });
  const rows = res.data.values;
  if (!rows || rows.length === 0) return [];
  return rows.filter((row) => row[0]?.trim().toLowerCase() === memberName.trim().toLowerCase()).map((row) => ({
    memberName: row[0] || "",
    albumTitle: row[1] || "",
    artistName: row[2] || "",
    savedAt: row[3] || "",
  }));
}

export async function addBookmark(memberName: string, albumTitle: string, artistName: string): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await initBookmarksSheet(sheets, spreadsheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: "bookmarks!A:D", valueInputOption: "RAW",
    requestBody: { values: [[memberName, albumTitle, artistName, new Date().toISOString()]] },
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

export async function removeBookmark(memberName: string, albumTitle: string, artistName: string): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await initBookmarksSheet(sheets, spreadsheetId);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "bookmarks!A2:D" });
  const rows = res.data.values;
  if (!rows) return;
  const rowIndex = rows.findIndex(
    (row) =>
      row[0]?.trim().toLowerCase() === memberName.trim().toLowerCase() &&
      row[1] === albumTitle &&
      row[2] === artistName
  );
  if (rowIndex === -1) return;
  const sheetRow = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `bookmarks!A${sheetRow}:D${sheetRow}`, valueInputOption: "RAW",
    requestBody: { values: [["", "", "", ""]] },
  });
}
