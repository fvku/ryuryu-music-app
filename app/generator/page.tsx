import type { Metadata } from "next";
import GeneratorHub, { type Summary } from "./GeneratorHub";
import { auth } from "@/lib/auth";
import { generatorActor } from "@/lib/generator/access";
import { generatorRpc } from "@/lib/generator/repository";

export const metadata: Metadata = { title: "投稿画像ジェネレーター" };
export const dynamic = "force-dynamic";

function previousMonthInTokyo(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric" })
    .formatToParts(new Date());
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

function latestFridayInTokyo(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(new Date());
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 2) % 7));
  return date.toISOString().slice(0, 10);
}

export default async function GeneratorPage() {
  let initialDocuments: Summary[] = [], initialError: string | null = null, initiallyNeedsLogin = false;
  try { generatorActor(await auth()); initialDocuments = await generatorRpc("generator_read", { p_id: null }) as Summary[]; }
  catch (error) { const known = error as { message?: string; status?: number }; initialError = known.message || "共有文書を読み込めません。"; initiallyNeedsLogin = known.status === 401; }
  return <GeneratorHub defaultMonth={previousMonthInTokyo()} defaultWeek={latestFridayInTokyo()} initialDocuments={initialDocuments} initialError={initialError} initiallyNeedsLogin={initiallyNeedsLogin} />;
}
