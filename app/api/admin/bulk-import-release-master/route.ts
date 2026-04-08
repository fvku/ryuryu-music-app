import { NextRequest, NextResponse } from "next/server";
import { getAllScores, addScore, getAllSyncPending, removeSyncPending } from "@/lib/sheets";
import { getReleaseMasterScoreRows } from "@/lib/release-master";

export const dynamic = "force-dynamic";

function parseCellScore(value: string): { score: number | null; comment: string } {
  const trimmed = value.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) {
    const num = parseFloat(trimmed);
    return { score: isNaN(num) ? null : num, comment: "" };
  }
  const num = parseFloat(trimmed.substring(0, spaceIdx));
  return { score: isNaN(num) ? null : num, comment: trimmed.substring(spaceIdx + 1).trim() };
}

export async function POST(req: NextRequest) {
  const { adminPassword } = await req.json();
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [rmRows, allScores, pending] = await Promise.all([
      getReleaseMasterScoreRows(),
      getAllScores(),
      getAllSyncPending(),
    ]);

    // 既存スコアのキーセット (albumTitle::artistName::email)
    const existingKeys = new Set(
      allScores.map((s) => `${s.albumTitle}::${s.artistName}::${s.memberName.toLowerCase()}`)
    );

    const imported: string[] = [];
    const skipped: string[] = [];

    for (const row of rmRows) {
      for (const [email, cellValue] of Object.entries(row.memberScores)) {
        const { score, comment } = parseCellScore(cellValue);
        if (score !== null && (score < 0 || score > 10)) continue;
        if (score === null && !comment) continue;

        const key = `${row.albumTitle}::${row.artistName}::${email}`;
        if (existingKeys.has(key)) {
          skipped.push(key);
          continue;
        }

        await addScore({
          reviewId: row.albumNo,
          memberName: email,
          score,
          comment,
          albumTitle: row.albumTitle,
          artistName: row.artistName,
        });
        existingKeys.add(key);
        imported.push(key);
      }
    }

    // sync_pending をクリア（取り込み済みなので不要）
    for (const p of pending) {
      await removeSyncPending(p.albumNo, p.memberEmail);
    }

    return NextResponse.json({
      ok: true,
      imported: imported.length,
      skipped: skipped.length,
      pendingCleared: pending.length,
    });
  } catch (error) {
    console.error("Bulk import failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
