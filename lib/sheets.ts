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
    range: "scores!A1:E1",
  });
  if (!scoresRes.data.values || scoresRes.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "scores!A1:E1",
      valueInputOption: "RAW",
      requestBody: {
        values: [["reviewId", "memberName", "score", "comment", "submittedAt"]],
      },
    });
  }
}

export async function getAllScores(): Promise<Score[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: "scores!A2:E" });
  const rows = response.data.values;
  if (!rows || rows.length === 0) return [];
  return rows.filter((row) => row[0]).map((row) => ({
    reviewId: row[0] || "",
    memberName: row[1] || "",
    score: parseFloat(row[2] || "0"),
    comment: row[3] || "",
    submittedAt: row[4] || "",
  }));
}

export async function getScoresForAlbum(albumNo: string): Promise<Score[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "scores!A2:E",
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
    }));
}

export async function addScore(scoreData: Omit<Score, "submittedAt">): Promise<Score> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const submittedAt = new Date().toISOString();
  const score: Score = { ...scoreData, submittedAt };

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "scores!A:E",
    valueInputOption: "RAW",
    requestBody: {
      values: [[score.reviewId, score.memberName, score.score, score.comment, score.submittedAt]],
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

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `scores!A${sheetRowNumber}:E${sheetRowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[albumNo, memberName, score, comment, submittedAt]],
    },
  });

  return { reviewId: albumNo, memberName, score, comment, submittedAt };
}
