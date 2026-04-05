import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ReleaseMasterAlbum } from "@/lib/types";

export const dynamic = "force-dynamic";

const LEGACY_MEMBERS = ["Kwisoo", "Meri", "Kohei", "Eddie", "Hanawa"];

function getAuth(write = false) {
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
    scopes: write
      ? ["https://www.googleapis.com/auth/spreadsheets"]
      : ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { no: string } }
) {
  try {
    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
    }

    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!A2:AC",
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    }

    const row = rows.find((r) => r[0] === params.no && r[2] && r[3]);
    if (!row) {
      return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    }

    const album: ReleaseMasterAlbum = {
      no: row[0] || "",
      date: row[1] || "",
      title: row[2] || "",
      artist: row[3] || "",
      genre: (row[5] || "") as ReleaseMasterAlbum["genre"],
      mjAdoption: row[16] || "",
      mjTrackNo: row[17] || "",
      mjTrack: row[18] || "",
      mjText: row[19] || "",
      legacyScores: LEGACY_MEMBERS
        .map((name, i) => ({ name, value: row[21 + i] || "" }))
        .filter((s) => s.value !== ""),
      spotifyUrl: row[27] || "",
      coverUrl: row[28] || "",
    };

    return NextResponse.json(album);
  } catch (error) {
    console.error("Failed to get album from Release Master:", error);
    return NextResponse.json({ error: "アルバムの取得に失敗しました" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { no: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }

    const body = await request.json();
    const { mjAdoption, mjData } = body;
    if (mjAdoption === undefined && mjData === undefined) {
      return NextResponse.json({ error: "mjAdoption または mjData が必要です" }, { status: 400 });
    }

    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
    }

    const sheets = google.sheets({ version: "v4", auth: getAuth(true) });

    // 対象行を探す（A2からなので行番号 = index + 2）
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!A2:A",
    });
    const rows = readRes.data.values ?? [];
    const rowIndex = rows.findIndex((r) => r[0] === params.no);
    if (rowIndex === -1) {
      return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    }
    const sheetRow = rowIndex + 2;

    if (mjAdoption !== undefined) {
      // 列Q（M/J採用）を更新
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'Release Master'!Q${sheetRow}`,
        valueInputOption: "RAW",
        requestBody: { values: [[mjAdoption]] },
      });
    }

    if (mjData !== undefined) {
      // R列(M Number), S列(Track), T列(M/J採用文章) を一括更新
      const { trackNo, trackName, mjText } = mjData as { trackNo: string; trackName: string; mjText: string };
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            { range: `'Release Master'!R${sheetRow}`, values: [[trackNo ?? ""]] },
            { range: `'Release Master'!S${sheetRow}`, values: [[trackName ?? ""]] },
            { range: `'Release Master'!T${sheetRow}`, values: [[mjText ?? ""]] },
          ],
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update mjAdoption:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}
