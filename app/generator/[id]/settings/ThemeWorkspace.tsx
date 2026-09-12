"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { canvasPreviewPage, type CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import type { GeneratorSnapshot } from "@/lib/generator/client-types";
import type { GeneratorDocument } from "@/lib/generator/model";
import PageNavigator from "../../PageNavigator";
import { GeneratorRuntimeProvider } from "../../runtime";
import { Chip, Panel, StatusBanner } from "../../ui";
import { RestoreControl, TargetStatus, ThemeInspector, type TargetState } from "../Inspectors";
import { writeRecovery } from "../recovery";
import { useGeneratorSession } from "../session";
import { keyOf, same } from "../workspace-types";

const seriesLabels: Record<GeneratorDocument["series"], string> = {
  monthly: "Monthly Review",
  japan: "Monthly Japan Review",
  weekly: "Weekly Review",
};

/**
 * 共通設定（波・合成背景画像・PNGサイズ）だけの画面。
 * 画像に属さない設定なので、画像を選んで直す編集画面から切り離してある。
 */
export default function ThemeWorkspace({ initialSnapshot, actor }: { initialSnapshot: GeneratorSnapshot; actor: string }) {
  const session = useGeneratorSession({
    initialSnapshot,
    actor,
    initialStatus: "波・合成背景・PNGサイズは企画に1つです。「共通設定を編集」から直し、保存すると全画像に効きます。",
  });
  const { snapshot, documentId, busy, status, setStatus, activeLocks, history } = session;
  const [themeDraft, setThemeDraft] = useState(snapshot.document.theme);
  const [pageIndex, setPageIndex] = useState(0);

  const dirty = !same(themeDraft, snapshot.document.theme);
  const locked = Boolean(activeLocks[keyOf("theme", documentId)]);
  const previewDocument = useMemo<GeneratorDocument>(() => ({ ...snapshot.document, theme: themeDraft }), [snapshot.document, themeDraft]);
  const previewPages = useMemo(
    () => previewDocument.pages.map((_, index) => canvasPreviewPage(previewDocument, index)).filter((page): page is CanvasPreviewPage => page !== null),
    [previewDocument],
  );

  // 共通設定の下書きも、編集画面と同じ入れ物へ退避する（共有保存とは別）。
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      writeRecovery({ actor, documentId, baseVersion: snapshot.version, document: previewDocument });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [actor, dirty, documentId, previewDocument, snapshot.version]);

  const foreign = locked ? undefined : snapshot.locks.find(value => value.kind === "theme" && value.targetId === documentId);
  const state: TargetState = {
    kind: "theme",
    targetId: documentId,
    locked,
    lockedBy: foreign ? foreign.owner : null,
    transferable: Boolean(foreign && foreign.owner === actor),
    dirty,
    disabled: busy,
    versions: history.filter(entry => entry.version < snapshot.version),
    onBegin: () => void (async () => {
      const lock = await session.acquire("theme", documentId);
      if (lock) {
        setThemeDraft(snapshot.document.theme);
        setStatus({ tone: "success", text: "共通設定を編集できます。ロックは操作中、自動で延長されます。" });
      }
    })(),
    onSave: () => void saveTheme(),
    onRelease: () => void (async () => {
      await session.release("theme", documentId);
      setStatus({ tone: "info", text: "共通設定の編集を終了しました。他の人が編集できます。" });
    })(),
    onRestore: version => void saveTheme(version),
    onTransfer: () => void session.acquire("theme", documentId, "transfer"),
  };

  async function saveTheme(restoreVersion?: number) {
    session.setBusy(true);
    setStatus({ tone: "info", text: restoreVersion ? `version ${restoreVersion} の共通設定を復元しています…` : "共有DBへ保存しています…" });
    const result = await session.saveTarget({
      kind: "theme",
      targetId: documentId,
      ...(restoreVersion ? { restoreVersion } : { content: themeDraft }),
    });
    session.setBusy(false);
    if (!result.ok) {
      setStatus(result.error.code === "VERSION_CONFLICT" || result.error.code === "LOCK_LOST"
        ? { tone: "error", text: "他の変更が先に保存されました。編集画面で最新版を読み直してから、もう一度編集してください。" }
        : { tone: "error", text: result.error.message });
      return;
    }
    setThemeDraft(result.snapshot.document.theme);
    setStatus({
      tone: "success",
      text: restoreVersion
        ? `version ${restoreVersion} の共通設定を、新しいversion ${result.snapshot.version} として復元しました。`
        : `共通設定をversion ${result.snapshot.version} として保存しました。`,
    });
  }

  return (
    <GeneratorRuntimeProvider documentId={documentId} theme={themeDraft} period={snapshot.document.period}>
      <section className="mx-auto max-w-5xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <Link href={`/generator/${documentId}`} className="shrink-0 text-xs text-violet-300 hover:underline">← 編集画面へ戻る</Link>
            <h1 className="min-w-0 truncate text-base font-bold sm:text-lg">
              共通設定 · {seriesLabels[snapshot.document.series]}
            </h1>
            {dirty ? <Chip tone="warn">未保存</Chip> : <Chip tone="success">保存済み</Chip>}
          </div>
          <Link
            href={`/generator/${documentId}/history`}
            className="inline-flex min-h-9 items-center rounded-xl border px-3 text-xs hover:bg-white/5"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            変更履歴
          </Link>
        </header>

        <StatusBanner tone={status.tone} dense>{status.text}</StatusBanner>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <Panel padding="tight">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
              すべての画像への効き方
            </p>
            <PageNavigator
              documentId={documentId}
              pages={previewPages}
              pageIndex={pageIndex}
              onSelect={setPageIndex}
              orientation="horizontal"
            />
          </Panel>

          <Panel className="space-y-3">
            <TargetStatus state={state} label="共通設定" />
            {locked && <RestoreControl state={state} />}
            <ThemeInspector
              state={state}
              theme={themeDraft}
              onTheme={setThemeDraft}
              onImage={async (target, file) => {
                const id = await session.uploadImage("theme", documentId, file);
                if (id) setThemeDraft(current => ({ ...current, [target]: id }));
              }}
            />
          </Panel>
        </div>
      </section>
    </GeneratorRuntimeProvider>
  );
}
