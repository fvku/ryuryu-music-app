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
    score: parseFloat(row[2] || "0"),
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
      score: parseFloat(row[2] || "0"),
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
      values: [[score.reviewId, score.memberName, score.score, score.comment, score.submittedAt, score.albumTitle || "", score.artistName || ""]],
    },
  });

  return score;
}

export async function hasScore(albumNo: string, memberName: string): Promise<boolean> {
  const scores = await getScoresForAlbum(albumNo);
  return scores.some((s) => s.memberName.trim().toLowerCase() === memberName.trim().toLowerCase());
}

export async function updateScore(albumNo: string, memberName: string, score: number, comment: string): Promise<Score | null> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "scores!A2:E" });
  const rows = response.data.values;
  if (!rows) return null;

  const rowIndex = rows.findIndex(
    (row) => row[0] === albumNo && row[1]?.trim().toLowerCase() === memberName.trim().toLowerCase()
  );
  if (rowIndex === -1) return null;

  const sheetRowNumber = rowIndex + 2; // +2 for header and 1-indexed
  const submittedAt = new Date().toISOString();
  const existingAlbumTitle = rows[rowIndex][5] || "";
  const existingArtistName = rows[rowIndex][6] || "";

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `scores!A${sheetRowNumber}:G${sheetRowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[albumNo, memberName, score, comment, submittedAt, existingAlbumTitle, existingArtistName]],
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
}

export async function initRecommendationsSheet(): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "recommendations!A1:H1" });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "recommendations!A1:H1",
        valueInputOption: "RAW",
        requestBody: { values: [["id", "recommenderId", "albumNo", "albumTitle", "artistName", "coverUrl", "message", "createdAt"]] },
      });
    }
  } catch {
    // Sheet may not exist yet — create it via batchUpdate
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: "recommendations" } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "recommendations!A1:H1",
      valueInputOption: "RAW",
      requestBody: { values: [["id", "recommenderId", "albumNo", "albumTitle", "artistName", "coverUrl", "message", "createdAt"]] },
    });
  }
}

export async function getAllRecommendations(): Promise<Recommendation[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "recommendations!A2:H" });
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
  }));
}

export async function addRecommendation(data: Omit<Recommendation, "id" | "createdAt">): Promise<Recommendation> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const id = `rec_${Date.now()}`;
  const createdAt = new Date().toISOString();
  const rec: Recommendation = { id, createdAt, ...data };
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "recommendations!A:H",
    valueInputOption: "RAW",
    requestBody: { values: [[rec.id, rec.recommenderId, rec.albumNo, rec.albumTitle, rec.artistName, rec.coverUrl, rec.message, rec.createdAt]] },
  });
  return rec;
}

// ── Bookmarks ──────────────────────────────────────────────

export interface Bookmark {
  memberName: string;
  albumNo: string;
  savedAt: string;
}

async function initBookmarksSheet(sheets: ReturnType<typeof getSheetsClient>, spreadsheetId: string): Promise<void> {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "bookmarks!A1:C1" });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: "bookmarks!A1:C1", valueInputOption: "RAW",
        requestBody: { values: [["memberName", "albumNo", "savedAt"]] },
      });
    }
  } catch {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: "bookmarks" } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: "bookmarks!A1:C1", valueInputOption: "RAW",
      requestBody: { values: [["memberName", "albumNo", "savedAt"]] },
    });
  }
}

export async function getBookmarks(memberName: string): Promise<Bookmark[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await initBookmarksSheet(sheets, spreadsheetId);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "bookmarks!A2:C" });
  const rows = res.data.values;
  if (!rows || rows.length === 0) return [];
  return rows.filter((row) => row[0]?.trim().toLowerCase() === memberName.trim().toLowerCase()).map((row) => ({
    memberName: row[0] || "",
    albumNo: row[1] || "",
    savedAt: row[2] || "",
  }));
}

export async function addBookmark(memberName: string, albumNo: string): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await initBookmarksSheet(sheets, spreadsheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: "bookmarks!A:C", valueInputOption: "RAW",
    requestBody: { values: [[memberName, albumNo, new Date().toISOString()]] },
  });
}

export async function removeBookmark(memberName: string, albumNo: string): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await initBookmarksSheet(sheets, spreadsheetId);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "bookmarks!A2:C" });
  const rows = res.data.values;
  if (!rows) return;
  const rowIndex = rows.findIndex(
    (row) => row[0]?.trim().toLowerCase() === memberName.trim().toLowerCase() && row[1] === albumNo
  );
  if (rowIndex === -1) return;
  const sheetRow = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `bookmarks!A${sheetRow}:C${sheetRow}`, valueInputOption: "RAW",
    requestBody: { values: [["", "", ""]] },
  });
}
