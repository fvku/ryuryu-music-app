"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { GeneratorDocument } from "@/lib/generator/model";
import type { GeneratorSnapshot, GeneratorSummary } from "@/lib/generator/client-types";
import { generatorJson } from "./generator-client";
import { Chip, Field, Panel, PanelHeading, PrimaryButton, SecondaryButton, SelectInput, StatusBanner, TextInput, type Tone } from "./ui";

export type Summary = GeneratorSummary;
type Status = { tone: Tone; text: string };

const seriesLabels = { monthly: "Monthly Review", japan: "Monthly Japan Review", weekly: "Weekly Review" } as const;

const dateFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });

function summaryPeriod(document: Summary): string {
  if (document.series !== "weekly") return document.periodStart.slice(0, 7);
  const source = new Date(`${document.periodStart}T00:00:00.000Z`), thursday = new Date(source);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear(), yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${year} WEEK ${week}`;
}

function emptyStatus(count: number): Status {
  return count > 0
    ? { tone: "info", text: "保存済みの企画を開くか、新しい月・週を取り込んでください。" }
    : { tone: "info", text: "保存済み企画はありません。Release Masterから作成できます。" };
}

export default function GeneratorHub({
  defaultMonth,
  defaultWeek,
  initialDocuments,
  initialError,
  initiallyNeedsLogin,
}: {
  defaultMonth: string;
  defaultWeek: string;
  initialDocuments: Summary[];
  initialError: string | null;
  initiallyNeedsLogin: boolean;
}) {
  const router = useRouter();
  const [documents, setDocuments] = useState<Summary[]>(initialDocuments);
  const [series, setSeries] = useState<"monthly" | "japan" | "weekly">("monthly"), [month, setMonth] = useState(defaultMonth), [week, setWeek] = useState(defaultWeek);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(initialError ? { tone: "error", text: initialError } : emptyStatus(initialDocuments.length));
  const [needsLogin, setNeedsLogin] = useState(initiallyNeedsLogin);

  async function loadDocuments() {
    try {
      const data = await generatorJson<Summary[]>(await fetch("/api/generator/documents", { cache: "no-store" }));
      setDocuments(data);
      setNeedsLogin(false);
      setStatus(emptyStatus(data.length));
    } catch (error) {
      const value = error as Error & { status?: number };
      setStatus({ tone: "error", text: value.message });
      setNeedsLogin(value.status === 401);
    }
  }

  async function createDocument() {
    setBusy(true);
    setStatus({ tone: "info", text: "Release Masterを読み込んでいます…" });
    try {
      const document = await generatorJson<GeneratorDocument>(
        await fetch(series === "weekly"
          ? `/api/generator/source?series=weekly&week=${encodeURIComponent(week)}`
          : `/api/generator/source?series=${series}&month=${encodeURIComponent(month)}`, { cache: "no-store" }),
      );
      const snapshot = await generatorJson<GeneratorSnapshot>(await fetch("/api/generator/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), document }),
      }));
      router.push(`/generator/${snapshot.document.id}`);
    } catch (error) {
      const value = error as Error & { code?: string; status?: number };
      await loadDocuments().catch(() => {});
      setNeedsLogin(value.status === 401);
      setStatus(value.code === "DOCUMENT_EXISTS"
        ? { tone: "warn", text: "同じ企画・期間は作成済みです。下の一覧から開いてください。" }
        : { tone: "error", text: value.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section
        className="rounded-2xl border p-5 sm:p-7"
        style={{ background: "linear-gradient(135deg,rgba(139,92,246,.18),rgba(30,64,175,.12))", borderColor: "var(--border-accent)" }}
      >
        <p className="text-xs font-semibold uppercase tracking-[.2em] text-violet-300">Shared generator</p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">投稿画像ジェネレーター</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
          Release MasterからMonthly／Japanの月次企画とWeeklyの週次企画を取り込み、作品・背景・並び順・共通画像を共同編集できます。
          保存は対象ごとで、同じ対象は1人だけが編集します。保存済みの版から1200／2400pxのPNGを書き出せます。
        </p>
      </section>

      <Panel>
        <PanelHeading title="新しい共有文書" note="Release Masterの対象月または対象週を取り込んで、共同編集用の文書を作ります。" />
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
          <Field label="企画">
            <SelectInput value={series} onChange={event => setSeries(event.target.value as typeof series)}>
              <option value="monthly">Monthly Review</option>
              <option value="japan">Monthly Japan Review</option>
              <option value="weekly">Weekly Review</option>
            </SelectInput>
          </Field>
          {series === "weekly" ? (
            <Field label="対象週の金曜日" hint="WEEK列が「採用」「掲載」の作品を取り込みます。">
              <TextInput type="date" value={week} onChange={event => setWeek(event.target.value)} />
            </Field>
          ) : (
            <Field label="対象月">
              <TextInput type="month" value={month} onChange={event => setMonth(event.target.value)} />
            </Field>
          )}
          <PrimaryButton disabled={busy || !(series === "weekly" ? week : month)} onClick={() => void createDocument()}>取り込んで作成</PrimaryButton>
        </div>
        <div className="mt-4">
          <StatusBanner
            tone={status.tone}
            actions={needsLogin
              ? <SecondaryButton onClick={() => signIn("google", { callbackUrl: "/generator" })}>Googleでログインし直す</SecondaryButton>
              : undefined}
          >
            {status.text}
          </StatusBanner>
        </div>
      </Panel>

      <Panel>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">共有文書</h2>
          <SecondaryButton disabled={busy} onClick={() => void loadDocuments()} className="min-h-9 px-3 text-xs">再読込</SecondaryButton>
        </div>
        {documents.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>まだ保存済みの企画がありません。</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {documents.map(document => (
              <li key={document.id}>
                <Link
                  href={`/generator/${document.id}`}
                  className="block h-full rounded-xl border p-4 transition hover:bg-white/5"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{summaryPeriod(document)}</span>
                    <Chip tone="info">{seriesLabels[document.series]}</Chip>
                  </div>
                  <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                    version {document.version} · {dateFormat.format(new Date(document.updatedAt))}
                  </p>
                  <p className="mt-1 truncate text-xs" style={{ color: "var(--text-secondary)" }}>
                    最終更新 {document.updatedBy}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
