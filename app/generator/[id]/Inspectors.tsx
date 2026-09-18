"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GeneratorHistoryEntry } from "@/lib/generator/client-types";
import type { GeneratorDocument } from "@/lib/generator/model";
import { getMemberShortName } from "@/lib/members";
import { Checkbox, Chip, Field, Modal, PrimaryButton, SecondaryButton, SelectInput } from "../ui";
import { useGeneratorRuntime } from "../runtime";
import { movePageItem, movePageItemTo, structureDrop, swapWeeklyFeatureItem, targetLabels, type LockKind, type OrderedPageKind } from "./workspace-types";

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
      <Chip tone="info">編集中</Chip>
      {/* 保存状態の言葉は画像の操作列と揃える（保存済み／未保存）。 */}
      <Chip tone={state.dirty ? "warn" : "success"}>{state.dirty ? "未保存" : "保存済み"}</Chip>
      <span className="flex-1" />
      <PrimaryButton disabled={state.disabled || !state.dirty} onClick={state.onSave} className="min-h-9 px-3 text-xs">保存</PrimaryButton>
      {!state.direct && <SecondaryButton disabled={state.disabled} onClick={state.onRelease} className="min-h-9 px-3 text-xs">編集終了</SecondaryButton>}
      {trailing}
    </div>
  );
}

const restoreAtFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" });

/**
 * 以前の保存から、その対象だけを書き戻す（新しい保存として残るので、履歴は消えない）。
 * 候補は「この対象を保存した時点」と「取り込んだ時点」だけにする。ほかの対象の保存まで並べると、何が戻るのか分からない。
 * 並び順は取り込み以降の版しか戻せない（作品数が違うため）ので、呼び出し側が絞った候補をそのまま使う。
 */
export function RestoreControl({ state, compact = false, bare = false }: { state: TargetState; compact?: boolean; bare?: boolean }) {
  const [version, setVersion] = useState("");
  const candidates = state.kind === "structure"
    ? state.versions
    : state.versions.filter(entry => (entry.targetKind === state.kind && entry.targetId === state.targetId) || !entry.targetKind);
  if (candidates.length === 0) return null;
  const subject = state.kind === "item" ? "この作品" : state.kind === "page" ? "この画像の背景色" : targetLabels[state.kind];
  const Wrapper = bare ? "div" : "details";
  return (
    <Wrapper className={bare ? "" : `rounded-lg border ${compact ? "px-2 py-1" : "px-3 py-2"}`} style={bare ? undefined : { borderColor: "var(--border-subtle)" }}>
      {bare
        ? <p className="text-xs font-semibold">{subject}</p>
        : (
          <summary className="cursor-pointer text-[11px]" style={{ color: "var(--text-secondary)" }}>
            以前の保存に戻す
          </summary>
        )}
      <p className="mt-2 text-[11px] leading-4" style={{ color: "var(--text-secondary)" }}>
        {subject}だけを、選んだ時点の内容に戻します。戻したことも保存として残るので、あとからまた戻せます。
        {state.kind === "structure" && " 作品を取り込み直す前の並び順には戻せません（作品の数が違うため）。"}
      </p>
      <div className="mt-2 flex gap-2">
        <SelectInput value={version} onChange={event => setVersion(event.target.value)} className="min-w-0 flex-1">
          <option value="">戻す時点を選ぶ</option>
          {candidates.map(entry => (
            <option key={entry.version} value={entry.version}>
              {restoreAtFormat.format(new Date(entry.createdAt))} · {getMemberShortName(entry.actor) ?? entry.actor}
              {!entry.targetKind ? "（取り込んだとき）" : ""}
            </option>
          ))}
        </SelectInput>
        <SecondaryButton disabled={state.disabled || !version} onClick={() => state.onRestore(Number(version))} className="min-h-11 px-3 text-xs">戻す</SecondaryButton>
      </div>
    </Wrapper>
  );
}

/**
 * 背景色。編集パネルの一番上に1行で置く（2026-09-18、タブをやめて1枚にしたため）。
 * 仮の色（自動で入れた初期値）のときだけ、保存するか選び直すよう一言添える。
 */
export function PageInspector({
  state,
  color,
  defined,
  candidates,
  onColor,
}: {
  state: TargetState;
  color: string;
  defined: boolean;
  /** ジャケットから拾った候補。最初の1つは編集開始時の仮の色にも使う。 */
  candidates: string[];
  onColor(value: string): void;
}) {
  const readOnly = !state.locked || state.disabled;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          value={color}
          disabled={readOnly}
          onChange={event => onColor(event.target.value)}
          aria-label="背景色を自由に選ぶ"
          title="カラーピッカーで自由に選ぶ"
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border bg-transparent disabled:opacity-40"
          style={{ borderColor: "var(--border-subtle)" }}
        />
        <span className="font-mono text-xs">{color}</span>
        <span className="flex-1" />
        {candidates.map(value => (
          <button
            key={value}
            type="button"
            disabled={readOnly}
            onClick={() => onColor(value)}
            aria-label={`背景色を ${value} にする`}
            title={`${value}（ジャケットから拾った候補）`}
            className="h-8 w-8 rounded-lg border-2 disabled:opacity-40"
            style={{ backgroundColor: value, borderColor: value === color ? "#c4b5fd" : "transparent" }}
          />
        ))}
      </div>
      {!defined ? (
        <p className="text-[11px] text-amber-300">仮の色です。この色で「保存」するか、候補かカラーピッカーで選んでください。</p>
      ) : candidates.length > 0 ? (
        <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>右の色はジャケットから拾った候補です。左の四角で自由にも選べます。</p>
      ) : null}
    </div>
  );
}

type StructureDrag = { id: string; pointerId: number; startY: number; startScroll: number; offset: number };

export function StructureDialog({
  state,
  notice = null,
  pages,
  items,
  onPages,
  onClose,
}: {
  state: TargetState;
  /** 編集を始められない理由。ダイアログが画面上部の帯を覆うので、ここに出す。 */
  notice?: string | null;
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
  const canEdit = state.locked && !state.disabled;

  // ドラッグで並べ替える（2026-09-18）。指でも動くよう Pointer Events で自作する（HTML標準のドラッグはiPhoneの指で動かない）。
  // 掴めるのは左端のつまみだけ。ほかの場所では、今までどおりスクロールできる。
  const [drag, setDrag] = useState<StructureDrag | null>(null);
  const [hover, setHover] = useState<{ overId: string; after: boolean } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const listRef = useRef<HTMLOListElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const pointerY = useRef(0);
  const dragRef = useRef<StructureDrag | null>(null);
  // 落とした瞬間は最後の移動がまだ描画に反映されていないことがあるので、判定は参照から読む。
  const hoverRef = useRef<{ overId: string; after: boolean } | null>(null);

  /** 指の高さから、どの行の上半分／下半分にいるかを決める。行の外なら一番近い端の行。 */
  function hoverAt(y: number): { overId: string; after: boolean } | null {
    const measured = rows
      .map(row => ({ id: row.id, rect: rowRefs.current.get(row.id)?.getBoundingClientRect() }))
      .filter((row): row is { id: string; rect: DOMRect } => Boolean(row.rect));
    if (!measured.length) return null;
    const inside = measured.find(row => y >= row.rect.top && y <= row.rect.bottom);
    if (inside) return { overId: inside.id, after: y > inside.rect.top + inside.rect.height / 2 };
    return y < measured[0].rect.top
      ? { overId: measured[0].id, after: false }
      : { overId: measured[measured.length - 1].id, after: true };
  }

  function updateDrag(y: number) {
    const current = dragRef.current;
    if (!current) return;
    pointerY.current = y;
    const scroll = scrollerRef.current?.scrollTop ?? 0;
    const next = { ...current, offset: y - current.startY + (scroll - current.startScroll) };
    dragRef.current = next;
    hoverRef.current = hoverAt(y);
    setDrag(next);
    setHover(hoverRef.current);
  }

  function endDrag(apply: boolean) {
    const current = dragRef.current, target = hoverRef.current;
    if (apply && current && target) {
      const action = structureDrop({ rows, draggedId: current.id, overId: target.overId, after: target.after, weekly: isWeekly });
      if (action?.type === "move") onPages(movePageItemTo(pages, action.kind, action.itemId, action.toIndex));
      if (action?.type === "swap") onPages(swapWeeklyFeatureItem(pages, action.featureId, action.otherId));
    }
    dragRef.current = null;
    hoverRef.current = null;
    setDrag(null);
    setHover(null);
  }

  // ダイアログの上端・下端に近づいたら、指を止めていても自動でスクロールする。
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const timer = window.setInterval(() => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const rect = scroller.getBoundingClientRect(), y = pointerY.current;
      const step = y < rect.top + 48 ? -10 : y > rect.bottom - 48 ? 10 : 0;
      if (!step) return;
      scroller.scrollTop += step;
      updateDrag(y);
    }, 16);
    return () => window.clearInterval(timer);
    // updateDrag は参照だけを読むので、ドラッグの開始・終了でだけ張り直せばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const pending = drag && hover
    ? structureDrop({ rows, draggedId: drag.id, overId: hover.overId, after: hover.after, weekly: isWeekly })
    : null;

  return (
    <Modal
      title="並び順を変更"
      description={isWeekly
        ? "メイン5枚の順番、Other Releasesの順番、および両者の入れ替えができます。表紙のジャケットの順もメインに合わせて変わります。"
        : "採用・掲載それぞれの中で前後に動かせます。並びが変わると、画像への割り当ても入れ替わります。"}
      onClose={onClose}
    >
      <div className="space-y-3">
        <TargetActions state={state} label="並び順" />
        {notice && <p className="text-xs leading-5 text-amber-300">{notice}</p>}
        {canEdit && (
          <p className="text-[11px] leading-4" style={{ color: "var(--text-secondary)" }}>
            左の ⋮⋮ を掴んで、動かしたい位置へドラッグします。
            {isWeekly && "メインとOthersの間で落とすと、その2つが入れ替わります。"}
          </p>
        )}
        <ol ref={listRef} className={`space-y-2 ${drag ? "select-none" : ""}`}>
          {rows.map(({ id, kind }, index) => {
            const dragged = drag?.id === id;
            const over = hover?.overId === id && !dragged;
            const insertLine = over && pending?.type === "move";
            const swapTarget = over && pending?.type === "swap";
            return (
              <li
                key={id}
                ref={element => {
                  if (element) rowRefs.current.set(id, element);
                  else rowRefs.current.delete(id);
                }}
                className="relative flex items-center gap-2 rounded-lg border p-2 text-sm"
                style={{
                  borderColor: swapTarget ? "#f59e0b" : "var(--border-subtle)",
                  backgroundColor: dragged ? "var(--bg-card)" : swapTarget ? "rgba(245,158,11,.1)" : undefined,
                  // 差し込む位置は、行の上端か下端に紫の線で見せる。
                  boxShadow: dragged
                    ? "0 8px 24px rgba(0,0,0,.45)"
                    : insertLine ? (hover.after ? "inset 0 -3px 0 var(--accent)" : "inset 0 3px 0 var(--accent)") : undefined,
                  transform: dragged ? `translateY(${drag.offset}px)` : undefined,
                  zIndex: dragged ? 10 : undefined,
                  opacity: dragged ? 0.9 : undefined,
                }}
              >
                <button
                  type="button"
                  aria-label={`${items.get(id)?.content.fields.title || "作品"}をドラッグして並べ替え`}
                  title="掴んでドラッグ"
                  disabled={!canEdit}
                  onPointerDown={event => {
                    if (!canEdit || event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    scrollerRef.current = listRef.current?.closest(".overflow-y-auto") as HTMLElement | null;
                    pointerY.current = event.clientY;
                    const start = { id, pointerId: event.pointerId, startY: event.clientY, startScroll: scrollerRef.current?.scrollTop ?? 0, offset: 0 };
                    dragRef.current = start;
                    hoverRef.current = null;
                    setDrag(start);
                    setHover(null);
                  }}
                  onPointerMove={event => {
                    if (dragRef.current?.pointerId === event.pointerId) updateDrag(event.clientY);
                  }}
                  onPointerUp={event => {
                    if (dragRef.current?.pointerId === event.pointerId) endDrag(true);
                  }}
                  onPointerCancel={() => endDrag(false)}
                  className="flex h-10 w-7 shrink-0 cursor-grab items-center justify-center rounded text-base leading-none active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
                  style={{ touchAction: "none", color: "var(--text-secondary)" }}
                >
                  ⋮⋮
                </button>
                <Chip tone="info">{kindLabel[kind]}</Chip>
                <span className="min-w-0 flex-1 truncate">{items.get(id)?.content.fields.title || "（作品名未入力）"}</span>
                {swapTarget && <span className="shrink-0 text-[11px] font-semibold text-amber-300">ここと入れ替え</span>}
                {kind === "feature" && !swapTarget && (
                  <SelectInput
                    aria-label={`${items.get(id)?.content.fields.title || "メイン作品"}を入れ替え`}
                    value={id}
                    disabled={!canEdit || otherIds.length === 0}
                    onChange={event => swapFeature(id, event.target.value)}
                    className="!mt-0 max-w-52 text-xs"
                  >
                    <option value={id}>この作品のまま</option>
                    {otherIds.map(otherId => (
                      <option key={otherId} value={otherId}>⇄ {items.get(otherId)?.content.fields.title || "（作品名未入力）"}</option>
                    ))}
                  </SelectInput>
                )}
                {/* キーボードでも並べ替えられるように、↑↓は残す。 */}
                <button
                  type="button"
                  aria-label="上へ"
                  disabled={!canEdit || !rows.slice(0, index).some(value => value.kind === kind)}
                  onClick={() => move(kind, id, -1)}
                  className="h-10 w-10 shrink-0 rounded border disabled:opacity-30"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="下へ"
                  disabled={!canEdit || !rows.slice(index + 1).some(value => value.kind === kind)}
                  onClick={() => move(kind, id, 1)}
                  className="h-10 w-10 shrink-0 rounded border disabled:opacity-30"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  ↓
                </button>
              </li>
            );
          })}
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
