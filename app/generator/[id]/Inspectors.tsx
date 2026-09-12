"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GeneratorHistoryEntry } from "@/lib/generator/client-types";
import type { GeneratorDocument } from "@/lib/generator/model";
import { Checkbox, Chip, Field, Modal, PrimaryButton, SecondaryButton, SelectInput } from "../ui";
import { useGeneratorRuntime } from "../runtime";
import { movePageItem, swapWeeklyFeatureItem, targetLabels, type LockKind, type OrderedPageKind } from "./workspace-types";

export type TargetState = {
  kind: LockKind;
  targetId: string;
  /** この端末がロックを持っているか。 */
  locked: boolean;
  /** 他の人（または自分の別端末）が持っているロックの所有者。 */
  lockedBy: string | null;
  /** そのロックが自分自身のもので、この端末へ引き継げるか。 */
  transferable: boolean;
  dirty: boolean;
  disabled: boolean;
  /** 画面を開いた時点で編集権を取得し、開始ボタンを挟まず操作できる対象。 */
  direct?: boolean;
  versions: GeneratorHistoryEntry[];
  onBegin(): void;
  onSave(): void;
  onRelease(): void;
  onRestore(version: number): void;
  onTransfer(): void;
};

/**
 * 4つの編集対象すべてで同じ形の操作列。開始 → 保存／編集終了 → 復元の順序を固定する。
 * 編集画面では TargetStatus をタブと同じ行へ出し、RestoreControl だけを下に置く。
 * まとめて置きたい場所（並び順モーダル）ではこの TargetActions を使う。
 */
export function TargetActions({ state, label }: { state: TargetState; label?: string }) {
  return (
    <div className="space-y-2">
      <TargetStatus state={state} label={label} />
      {state.locked && <RestoreControl state={state} />}
    </div>
  );
}

/**
 * 対象の状態と保存だけ。`direct` の対象は表示された時点で編集ロックを自動取得する。
 * trailing には復元のような従属操作を渡し、同じ行に収める。
 */
export function TargetStatus({ state, label, trailing }: { state: TargetState; label?: string; trailing?: ReactNode }) {
  const name = label || targetLabels[state.kind];
  const attemptedTarget = useRef("");
  const targetKey = `${state.kind}:${state.targetId}`;

  useEffect(() => {
    if (!state.direct || state.locked || state.lockedBy || state.disabled || attemptedTarget.current === targetKey) return;
    attemptedTarget.current = targetKey;
    state.onBegin();
  }, [state, targetKey]);

  if (!state.locked) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {state.lockedBy && <Chip tone="warn">{state.transferable ? "自分の別端末が編集中" : `${state.lockedBy} が編集中`}</Chip>}
        {state.direct && !state.lockedBy ? (
          <>
            <Chip tone="info">編集を準備しています…</Chip>
            {!state.disabled && (
              <SecondaryButton
                onClick={() => {
                  attemptedTarget.current = "";
                  state.onBegin();
                }}
              >
                接続を再試行
              </SecondaryButton>
            )}
          </>
        ) : !state.direct ? (
          <PrimaryButton disabled={state.disabled || Boolean(state.lockedBy)} onClick={state.onBegin}>{name}を編集</PrimaryButton>
        ) : null}
        {state.transferable && (
          <SecondaryButton disabled={state.disabled} onClick={state.onTransfer}>この端末へ引き継ぐ</SecondaryButton>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip tone="success">編集中 · 自動延長</Chip>
      <Chip tone={state.dirty ? "warn" : "info"}>{state.dirty ? "未保存" : "共有DBと一致"}</Chip>
      <span className="flex-1" />
      <PrimaryButton disabled={state.disabled || !state.dirty} onClick={state.onSave} className="min-h-9 px-3 text-xs">保存</PrimaryButton>
      {!state.direct && <SecondaryButton disabled={state.disabled} onClick={state.onRelease} className="min-h-9 px-3 text-xs">編集終了</SecondaryButton>}
      {trailing}
    </div>
  );
}

/** 過去版からその対象だけを新しいversionとして書き戻す。compact は操作列と同じ行に置く形。 */
export function RestoreControl({ state, compact = false }: { state: TargetState; compact?: boolean }) {
  const [version, setVersion] = useState("");
  if (state.versions.length === 0) return null;
  return (
    <details className={`rounded-lg border ${compact ? "px-2 py-1" : "px-3 py-2"}`} style={{ borderColor: "var(--border-subtle)" }}>
      <summary className="cursor-pointer text-[11px]" style={{ color: "var(--text-secondary)" }}>
        {compact ? "過去版から復元" : `過去版から${targetLabels[state.kind]}を復元`}
      </summary>
      <p className="mt-2 text-[11px] leading-4" style={{ color: "var(--text-secondary)" }}>
        選んだ版のこの対象だけを、新しいversionとして書き戻します。●はその版でこの対象が変更されたことを示します。履歴は消えません。
        {state.kind === "structure" && " 並び順は、最後に作品を取り込んだ時点以降の版へ戻せます。作品の増減より前の版は、当時と作品数が異なるため選べません。過去の作品構成へ戻す場合は「Release Masterから更新」で内容を確認してください。"}
      </p>
      <div className="mt-2 flex gap-2">
        <SelectInput value={version} onChange={event => setVersion(event.target.value)} className="min-w-0 flex-1">
          <option value="">過去版を選択</option>
          {state.versions.map(entry => (
            <option key={entry.version} value={entry.version}>
              {entry.targetKind === state.kind && entry.targetId === state.targetId ? "● " : ""}
              version {entry.version} · {entry.actor}
            </option>
          ))}
        </SelectInput>
        <SecondaryButton disabled={state.disabled || !version} onClick={() => state.onRestore(Number(version))} className="min-h-11 px-3 text-xs">復元</SecondaryButton>
      </div>
    </details>
  );
}

export function PageInspector({
  state,
  pageNumber,
  color,
  defined,
  candidates,
  onColor,
}: {
  state: TargetState;
  pageNumber: number;
  color: string;
  defined: boolean;
  /** ジャケットから拾った候補。最初の1つは編集開始時の初期値にも使う。 */
  candidates: string[];
  onColor(value: string): void;
}) {
  const readOnly = !state.locked || state.disabled;
  return (
    <div className="space-y-4">
      <p className="text-xs leading-5" style={{ color: "var(--text-secondary)" }}>
        画像 {pageNumber} の1枚だけに効きます。掲載の上下でも共通です。
      </p>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={color}
          disabled={!state.locked || state.disabled}
          onChange={event => onColor(event.target.value)}
          aria-label="背景色"
          className="h-12 w-20 shrink-0 cursor-pointer rounded-lg border bg-transparent disabled:opacity-40"
          style={{ borderColor: "var(--border-subtle)" }}
        />
        <div className="min-w-0">
          <p className="font-mono text-sm">{color}</p>
          {!defined && (
            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>未設定のため、プレビューだけの仮の色です。</p>
          )}
        </div>
      </div>
      {candidates.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>ジャケットから拾った候補</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {candidates.map(value => (
              <button
                key={value}
                type="button"
                disabled={readOnly}
                onClick={() => onColor(value)}
                aria-label={`背景色を ${value} にする`}
                title={value}
                className="h-9 w-9 rounded-lg border disabled:opacity-40"
                style={{ backgroundColor: value, borderColor: value === color ? "var(--accent)" : "var(--border-subtle)" }}
              />
            ))}
          </div>
          <p className="mt-1 text-[11px] leading-4" style={{ color: "var(--text-secondary)" }}>
            白文字が読める範囲へ寄せた候補です。ここから選んでも、カラーピッカーで自由に決めても構いません。
          </p>
        </div>
      )}
    </div>
  );
}

export function StructureDialog({
  state,
  pages,
  items,
  onPages,
  onClose,
}: {
  state: TargetState;
  pages: GeneratorDocument["pages"];
  items: Map<string, GeneratorDocument["items"][number]>;
  onPages(value: GeneratorDocument["pages"]): void;
  onClose(): void;
}) {
  function move(kind: OrderedPageKind, itemId: string, delta: number) {
    onPages(movePageItem(pages, kind, itemId, delta));
  }

  function swapFeature(featureId: string, otherId: string) {
    onPages(swapWeeklyFeatureItem(pages, featureId, otherId));
  }

  const isWeekly = pages.some(page => page.kind === "cover");
  const rows = pages.flatMap<{ id: string; kind: OrderedPageKind }>(page => {
    if (page.kind === "adopted" || page.kind === "listed" || page.kind === "feature" || page.kind === "others") {
      const kind: OrderedPageKind = page.kind;
      return page.itemIds.map(id => ({ id, kind }));
    }
    return [];
  });
  const otherIds = rows.filter(row => row.kind === "others").map(row => row.id);
  const kindLabel: Record<OrderedPageKind, string> = { adopted: "採用", listed: "掲載", feature: "メイン", others: "Others" };
  return (
    <Modal
      title="並び順を変更"
      description={isWeekly
        ? "メイン5枚の順番、Other Releasesの順番、および両者の入れ替えを行えます。表紙のジャケット順もメインに連動します。作品構成が変わる前のversionは復元候補に出ません。"
        : "採用・掲載それぞれの区分の中だけで前後に動かせます。並びが変わると、画像への割り当ても入れ替わります。作品構成が変わる前のversionは復元候補に出ません。"}
      onClose={onClose}
    >
      <div className="space-y-3">
        <TargetActions state={state} label="並び順" />
        <ol className="space-y-2">
          {rows.map(({ id, kind }, index) => (
            <li key={id} className="flex items-center gap-2 rounded-lg border p-2 text-sm" style={{ borderColor: "var(--border-subtle)" }}>
              <Chip tone="info">{kindLabel[kind]}</Chip>
              <span className="min-w-0 flex-1 truncate">{items.get(id)?.content.fields.title || "（作品名未入力）"}</span>
              {kind === "feature" && (
                <SelectInput
                  aria-label={`${items.get(id)?.content.fields.title || "メイン作品"}を入れ替え`}
                  value={id}
                  disabled={!state.locked || state.disabled || otherIds.length === 0}
                  onChange={event => swapFeature(id, event.target.value)}
                  className="!mt-0 max-w-52 text-xs"
                >
                  <option value={id}>この作品のまま</option>
                  {otherIds.map(otherId => (
                    <option key={otherId} value={otherId}>⇄ {items.get(otherId)?.content.fields.title || "（作品名未入力）"}</option>
                  ))}
                </SelectInput>
              )}
              <button
                type="button"
                aria-label="上へ"
                disabled={!state.locked || state.disabled || !rows.slice(0, index).some(value => value.kind === kind)}
                onClick={() => move(kind, id, -1)}
                className="h-10 w-10 shrink-0 rounded border disabled:opacity-30"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="下へ"
                disabled={!state.locked || state.disabled || !rows.slice(index + 1).some(value => value.kind === kind)}
                onClick={() => move(kind, id, 1)}
                className="h-10 w-10 shrink-0 rounded border disabled:opacity-30"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}

export function ThemeInspector({
  state,
  theme,
  onTheme,
  onImage,
}: {
  state: TargetState;
  theme: GeneratorDocument["theme"];
  onTheme(value: GeneratorDocument["theme"]): void;
  onImage(target: "waveAssetId" | "backgroundAssetId", file: File): Promise<void>;
}) {
  const readOnly = !state.locked || state.disabled;
  // 波は対象月のものが自動で選ばれる（runtime.tsxのBUNDLED_WAVES）。どの月のものが出ているかを見せる。
  const { runtime } = useGeneratorRuntime();
  const picker = (label: string, target: "waveAssetId" | "backgroundAssetId") => (
    <Field label={label} hint="PNG・JPEG・WebP、10MB以下。共有Storageへ保存してから、保存で版に確定します。">
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={readOnly}
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) void onImage(target, file);
          event.target.value = "";
        }}
        className="mt-1 block w-full text-xs"
      />
    </Field>
  );
  return (
    <div className="space-y-4">
      <p className="text-xs leading-5" style={{ color: "var(--text-secondary)" }}>
        企画のすべての画像に効きます。保存すると全ページの見た目が変わります。
      </p>
      <Checkbox checked={theme.useWave} disabled={readOnly} onChange={event => onTheme({ ...theme, useWave: event.target.checked })} label="波を表示" />
      {theme.useWave && !theme.waveAssetId && runtime?.wave && (
        <p className="text-[11px] leading-5" style={{ color: runtime.wave.exact ? "var(--text-secondary)" : "#fca5a5" }}>
          {runtime.wave.exact
            ? `${runtime.wave.month.replace("-", "年")}月の波を使っています。`
            : `⚠️ 対象月の波がまだ登録されていません。${runtime.wave.month.replace("-", "年")}月の波で表示しています。`}
        </p>
      )}
      {picker("波画像を差し替え", "waveAssetId")}
      {theme.waveAssetId && (
        <button type="button" disabled={readOnly} onClick={() => onTheme({ ...theme, waveAssetId: null })} className="text-xs text-violet-300 disabled:opacity-40">
          既定の波へ戻す
        </button>
      )}
      {picker("合成済み背景画像を使う", "backgroundAssetId")}
      {theme.backgroundAssetId && (
        <button type="button" disabled={readOnly} onClick={() => onTheme({ ...theme, backgroundAssetId: null })} className="text-xs text-violet-300 disabled:opacity-40">
          背景画像を外す
        </button>
      )}
      <Field label="PNGサイズ">
        <SelectInput value={theme.outputSize} disabled={readOnly} onChange={event => onTheme({ ...theme, outputSize: Number(event.target.value) as 1200 | 2400 })}>
          <option value="1200">1200 × 1200</option>
          <option value="2400">2400 × 2400</option>
        </SelectInput>
      </Field>
    </div>
  );
}
