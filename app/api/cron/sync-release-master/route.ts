import { NextResponse } from "next/server";
import { getAllScores, addScore, updateScore, initScoresSheet, getAllSyncPending, upsertSyncPending, removeSyncPending } from "@/lib/sheets";
import { getReleaseMasterScoreRows } from "@/lib/release-master";
import { LEGACY_NAME_TO_EMAIL } from "@/lib/members";

export const dynamic = "force-dynamic";

const SYNC_DELAY_MS = 2 * 60 * 1000; // 2 minutes

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

export async function GET() {
  try {
    const [rmRows, allScores, pending] = await Promise.all([
      getReleaseMasterScoreRows(),
      getAllScores(),
      getAllSyncPending(),
    ]);

    const pendingMap = new Map(pending.map((p) => [`${p.albumNo}::${p.memberEmail}`, p]));
    const appScoreMap = new Map(allScores.map((s) => [`${s.albumTitle}::${s.artistName}::${s.memberName.toLowerCase()}`, s]));

    const now = Date.now();
    const synced: string[] = [];
    const added: string[] = [];

    await initScoresSheet();

    for (const row of rmRows) {
      for (const [email, cellValue] of Object.entries(row.memberScores)) {
        const { score, comment } = parseCellScore(cellValue);
        // スコアが範囲外（無効値）はスキップ。スコアなし+コメントのみはOK
        if (score !== null && (score < 0 || score > 10)) continue;
        if (score === null && !comment) continue;

        const key = `${row.albumNo}::${email}`;
        const existingAppScore = appScoreMap.get(`${row.albumTitle}::${row.artistName}::${email}`);

        // Already synced with same value → clean up pending if any
        if (existingAppScore && existingAppScore.score === score && existingAppScore.comment === comment) {
          if (pendingMap.has(key)) {
            await removeSyncPending(row.albumNo, email);
          }
          continue;
        }

        // Value differs from app score (or no app score) → check/update pending
        const pendingEntry = pendingMap.get(key);

        if (!pendingEntry) {
          // First detection: record pending
          await upsertSyncPending(row.albumNo, email, cellValue);
          added.push(key);
          continue;
        }

        if (pendingEntry.cellValue !== cellValue) {
          // Value changed since last detection → reset timer
          await upsertSyncPending(row.albumNo, email, cellValue);
          added.push(`${key}(reset)`);
          continue;
        }

        // Same value, check if 2 minutes have passed
        const detectedAt = new Date(pendingEntry.detectedAt).getTime();
        if (now - detectedAt < SYNC_DELAY_MS) continue;

        // 2 minutes passed → sync to scores sheet
        const altNames = Object.entries(LEGACY_NAME_TO_EMAIL)
          .filter(([, e]) => e === email)
          .map(([name]) => name);

        if (existingAppScore) {
          await updateScore(row.albumTitle, row.artistName, email, score, comment, altNames);
        } else {
          await addScore({
            reviewId: row.albumNo,
            memberName: email,
            score,
            comment,
            albumTitle: row.albumTitle,
            artistName: row.artistName,
          });
        }

        await removeSyncPending(row.albumNo, email);
        synced.push(key);
      }
    }

    return NextResponse.json({ ok: true, synced, added });
  } catch (error) {
    console.error("Sync cron failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
