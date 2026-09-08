import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { generatorActor } from "@/lib/generator/access";
import type { GeneratorHistoryEntry, GeneratorSnapshot } from "@/lib/generator/client-types";
import { GeneratorError } from "@/lib/generator/errors";
import { uuid } from "@/lib/generator/model";
import { generatorRpc } from "@/lib/generator/repository";

export const metadata: Metadata = { title: "変更履歴 | 投稿画像ジェネレーター" };
export const dynamic = "force-dynamic";

const targetLabels = { item: "作品", page: "背景", theme: "共通設定", structure: "並び順" } as const;
const seriesLabels = { monthly: "Monthly Review", japan: "Monthly Japan Review", weekly: "Weekly Review" } as const;
const dateFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });

/** 履歴の対象IDを、編集画面で見えている名前に戻す。 */
function targetName(snapshot: GeneratorSnapshot, entry: GeneratorHistoryEntry): string | null {
  if (!entry.targetKind || !entry.targetId) return null;
  if (entry.targetKind === "item") {
    const item = snapshot.document.items.find(value => value.id === entry.targetId);
    return item ? item.content.fields.title || "（作品名未入力）" : "削除された作品";
  }
  if (entry.targetKind === "page") {
    const index = snapshot.document.pages.findIndex(value => value.id === entry.targetId);
    return index < 0 ? "削除された画像" : `画像 ${snapshot.document.series === "weekly" ? index : index + 2}`;
  }
  return null;
}

export default async function GeneratorHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const rawId = (await params).id;
  let snapshot: GeneratorSnapshot | null = null, history: GeneratorHistoryEntry[] = [], loadError: string | null = null;
  try {
    generatorActor(await auth());
    const id = uuid(rawId);
    [snapshot, history] = await Promise.all([
      generatorRpc("generator_read", { p_id: id }) as Promise<GeneratorSnapshot>,
      generatorRpc("generator_history", { p_id: id }) as Promise<GeneratorHistoryEntry[]>,
    ]);
  } catch (error) {
    loadError = (error as GeneratorError).message || "変更履歴を読み込めませんでした。";
  }

  if (!snapshot) {
    return (
      <section className="mx-auto max-w-2xl rounded-2xl border p-6" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
        <h1 className="text-xl font-bold">変更履歴を開けません</h1>
        <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>{loadError}</p>
        <Link href={`/generator/${rawId}`} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold">
          編集画面へ戻る
        </Link>
      </section>
    );
  }

  const workspace = `/generator/${snapshot.document.id}`;
  return (
    <section className="mx-auto max-w-3xl">
      <Link href={workspace} className="text-xs text-violet-300 hover:underline">← 編集画面へ戻る</Link>
      <h1 className="mt-2 text-xl font-bold sm:text-2xl">
        {seriesLabels[snapshot.document.series]} {snapshot.document.series === "weekly" ? snapshot.document.period.start : snapshot.document.period.start.slice(0, 7)} の変更履歴
      </h1>
      <p className="mt-2 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
        現在は version {snapshot.version} です。復元は編集画面で、その対象の編集を開始してから行います。
        復元しても過去の履歴は消えず、新しいversionとして積み上がります。
      </p>

      <ol className="mt-6 space-y-3">
        {history.map(entry => {
          const name = targetName(snapshot, entry);
          return (
            <li key={entry.version} className="rounded-xl border p-4" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm">version {entry.version}</strong>
                  {entry.version === snapshot.version && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">現在</span>
                  )}
                  {entry.targetKind && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-200">
                      {targetLabels[entry.targetKind]}
                    </span>
                  )}
                </div>
                <time className="text-xs" style={{ color: "var(--text-secondary)" }}>{dateFormat.format(new Date(entry.createdAt))}</time>
              </div>
              <p className="mt-2 text-sm">
                {entry.operation === "create"
                  ? "企画を作成"
                  : entry.operation === "restore"
                    ? `version ${entry.restoredFrom} から復元`
                    : `${entry.targetKind ? targetLabels[entry.targetKind] : "内容"}を保存`}
                {name && <span style={{ color: "var(--text-secondary)" }}>（{name}）</span>}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{entry.actor}</p>
            </li>
          );
        })}
      </ol>

      <Link
        href={workspace}
        className="mt-6 inline-flex min-h-11 items-center rounded-xl border px-4 text-sm hover:bg-white/5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        編集画面へ戻る
      </Link>
    </section>
  );
}
