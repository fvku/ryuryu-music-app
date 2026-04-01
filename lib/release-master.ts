import { google } from "googleapis";

function getWriteAuth() {
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

export async function writeSpotifyDataToSheet(
  updates: { no: string; spotifyUrl: string; coverUrl: string }[]
): Promise<void> {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId || updates.length === 0) return;

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

  // Fetch No. column to find row numbers
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A2:A",
  });

  const noColumn = resp.data.values || [];
  const noToRow: Record<string, number> = {};
  noColumn.forEach((row, i) => {
    if (row[0]) noToRow[row[0]] = i + 2; // row 2 = index 0
  });

  const data = updates.flatMap(({ no, spotifyUrl, coverUrl }) => {
    const rowNum = noToRow[no];
    if (!rowNum) return [];
    return [
      { range: `'Release Master'!AB${rowNum}`, values: [[spotifyUrl]] },
      { range: `'Release Master'!AC${rowNum}`, values: [[coverUrl]] },
    ];
  });

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data,
    },
  });
}
