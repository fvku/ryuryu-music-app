/**
 * 共有Supabase（hyoryu-tools）の休止防止（Vercel Cron から叩かれる）。
 *
 * 無料プランは一定期間アクセスが無いとプロジェクトを自動で一時停止し、
 * 画像ジェネレーターの共有保存が使えなくなる。ジェネレーターを触らない週が
 * 続いても止まらないよう、読み取り専用の generator_read（一覧取得）を定期的に呼ぶ。
 * 書き込みは一切しない。
 *
 * 認証は CRON_SECRET。Vercel は Cron 実行時に
 * Authorization: Bearer $CRON_SECRET を付けて呼ぶ。
 */

import { NextRequest, NextResponse } from "next/server";
import { generatorRpc } from "@/lib/generator/repository";
import { GeneratorError } from "@/lib/generator/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const documents = await generatorRpc("generator_read", { p_id: null });
    const count = Array.isArray(documents) ? documents.length : null;
    console.log(`[cron/supabase-keepalive] ok documents=${count}`);
    return NextResponse.json({ ok: true, documents: count });
  } catch (e) {
    const code = e instanceof GeneratorError ? e.code : "UNKNOWN";
    console.error(`[cron/supabase-keepalive] failed: ${code}`, e);
    return NextResponse.json({ ok: false, error: code }, { status: 500 });
  }
}
