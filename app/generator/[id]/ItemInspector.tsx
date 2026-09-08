"use client";

import { useEffect, useRef, useState } from "react";
import type { GeneratorDocument, ItemContent } from "@/lib/generator/model";
import { applySelectedSpacing, rebaseKerns, selectedSpacing } from "@/lib/generator/text-edit";
import type { BodyDiagnostic } from "../GeneratorPreview";
import { Checkbox, Chip, Field, SecondaryButton, SelectInput, TextArea, TextInput } from "../ui";
import { type TargetState } from "./Inspectors";
import { cloneContent, same, type FieldSelection } from "./workspace-types";

type FieldKey = keyof ItemContent["fields"];
type ShowKey = keyof ItemContent["show"];

const fieldOrder: FieldKey[] = ["title", "artist", "duration", "genreMemo", "country", "trackNo", "track", "text"];
const fieldLabels: Record<FieldKey, string> = {
  title: "作品名",
  artist: "アーティスト",
  duration: "曲数・総尺",
  genreMemo: "ジャンル",
  country: "国",
  trackNo: "おすすめ曲番号",
  track: "おすすめ曲名",
  text: "評価文",
};
/** 表示チェックの持ち主。おすすめ曲は番号と曲名の両方を show.track が支配する。 */
const showOf: Record<FieldKey, ShowKey | null> = {
  title: "title", artist: "artist", duration: "duration", genreMemo: "genreMemo",
  country: "country", trackNo: "track", track: "track", text: null,
};

const defaultLeading = (key: FieldKey) => (key === "title" ? 72 / 54 : 1.2);

function toPercent(value: number | null): string {
  return value === null ? "" : String(Math.round(value * 1000) / 10);
}

function EditableNumberInput({
  value,
  min,
  max,
  disabled,
  placeholder,
  onValue,
  integer = false,
}: {
  value: string;
  min: number;
  max: number;
  disabled: boolean;
  placeholder?: string;
  onValue(value: number): void;
  integer?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  function parse(raw: string): number | null {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim())) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function commit(clamp: boolean) {
    const parsed = parse(draft);
    if (parsed === null) {
      setDraft(value);
      return;
    }
    const next = clamp ? Math.min(max, Math.max(min, parsed)) : parsed;
    if (next < min || next > max) return;
    const normalized = integer ? Math.round(next) : next;
    setDraft(String(normalized));
    onValue(normalized);
  }

  return (
    <TextInput
      type="text"
      inputMode="decimal"
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={() => { focused.current = true; }}
      onDoubleClick={event => event.currentTarget.select()}
      onChange={event => {
        const raw = event.target.value;
        setDraft(raw);
        const parsed = parse(raw);
        if (parsed !== null && parsed >= min && parsed <= max) onValue(integer ? Math.round(parsed) : parsed);
      }}
      onBlur={() => {
        commit(true);
        focused.current = false;
      }}
      onKeyDown={event => {
        if (event.key !== "Enter") return;
        commit(true);
        event.currentTarget.select();
      }}
    />
  );
}

export default function ItemInspector({
  item,
  draft,
  state,
  pageKind,
  diagnostic,
  onDraft,
  onImage,
  selection,
  onSelection,
  allowTracking,
}: {
  item: GeneratorDocument["items"][number];
  draft?: ItemContent;
  state: TargetState;
  pageKind: "adopted" | "listed" | "feature" | "others";
  diagnostic: BodyDiagnostic | null;
  onDraft(value: ItemContent): void;
  onImage(file: File): Promise<string | null>;
  selection: FieldSelection;
  onSelection(next: { key: FieldKey; start: number; end: number; source: FieldSelection["source"] }): void;
  /** iPhoneでは字間の調整を出さない。値そのものは保持したまま、操作だけを外す。 */
  allowTracking: boolean;
}) {
  const value = draft || item.content;
  const [editing, setEditing] = useState<FieldKey[]>([]);
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const appliedRef = useRef("");
  const [editHistory, setEditHistory] = useState<{ undo: ItemContent[]; redo: ItemContent[] }>({ undo: [], redo: [] });
  const readOnly = !state.locked || state.disabled;

  function applyDraft(next: ItemContent) {
    if (same(value, next)) return;
    setEditHistory(current => ({ undo: [...current.undo, cloneContent(value)].slice(-100), redo: [] }));
    onDraft(next);
  }

  function undo() {
    const previous = editHistory.undo.at(-1);
    if (!previous) return;
    setEditHistory(current => ({ undo: current.undo.slice(0, -1), redo: [...current.redo, cloneContent(value)].slice(-100) }));
    onDraft(cloneContent(previous));
  }

  function redo() {
    const next = editHistory.redo.at(-1);
    if (!next) return;
    setEditHistory(current => ({ undo: [...current.undo, cloneContent(value)].slice(-100), redo: current.redo.slice(0, -1) }));
    onDraft(cloneContent(next));
  }

  function setField(key: FieldKey, next: string) {
    const old = value.fields[key];
    if (key === "text") {
      applyDraft({ ...value, fields: { ...value.fields, text: next }, kerns: rebaseKerns(old, next, value.kerns) });
      return;
    }
    const style = value.typography[key];
    applyDraft({
      ...value,
      fields: { ...value.fields, [key]: next },
      typography: style ? { ...value.typography, [key]: { ...style, kerns: rebaseKerns(old, next, style.kerns) } } : value.typography,
    });
  }

  const visibleFields = pageKind === "feature"
    ? fieldOrder.filter(key => !["trackNo", "track", "text"].includes(key))
    : pageKind === "others"
      ? fieldOrder.filter(key => key === "title" || key === "artist")
      : fieldOrder;
  const adjustableFields = pageKind === "listed" ? visibleFields.filter(key => key !== "text") : visibleFields;
  const target = visibleFields.includes(selection.key) ? selection.key : "title";
  const range = target === selection.key
    ? { start: selection.start, end: selection.end }
    : { start: 0, end: 0 };
  const tracking = target === "text"
    ? selectedSpacing(value.fields.text, value.tracking, value.kerns, range.start, range.end)
    : selectedSpacing(value.fields[target], value.typography[target]?.tracking ?? 0, value.typography[target]?.kerns ?? {}, range.start, range.end);

  function setTracking(next: number) {
    if (target === "text") {
      applyDraft({ ...value, ...applySelectedSpacing(value.fields.text, value.tracking, value.kerns, range.start, range.end, next) });
      return;
    }
    const current = value.typography[target] || { tracking: 0, kerns: {}, leading: defaultLeading(target) };
    const adjusted = applySelectedSpacing(value.fields[target], current.tracking, current.kerns, range.start, range.end, next);
    applyDraft({ ...value, typography: { ...value.typography, [target]: { ...current, ...adjusted } } });
  }

  function setLeading(next: number) {
    if (target === "text") return;
    const current = value.typography[target] || { tracking: 0, kerns: {}, leading: defaultLeading(target) };
    applyDraft({ ...value, typography: { ...value.typography, [target]: { ...current, leading: next } } });
  }

  // プレビューから選ばれたときだけ、対応する入力欄へ同じ範囲を移す。
  useEffect(() => {
    if (selection.source !== "preview") return;
    const signature = `${selection.key}:${selection.start}:${selection.end}`;
    if (appliedRef.current === signature) return;
    const element = fieldRefs.current[selection.key];
    if (!element) return;
    appliedRef.current = signature;
    element.focus({ preventScroll: true });
    element.setSelectionRange(selection.start, selection.end);
  }, [selection]);

  function select(key: FieldKey) {
    onSelection({ key, start: 0, end: 0, source: "field" });
  }

  function isOpen(key: FieldKey): boolean {
    return editing.includes(key) || (selection.key === key && selection.source !== "field");
  }

  function selectRange(key: FieldKey, start: number, end: number) {
    // プレビューから開いた欄の中で選び直しても、その欄は開いたままにする。
    const keepOpen = selection.key === key && selection.source !== "field" && !editing.includes(key);
    onSelection({ key, start, end, source: keepOpen ? "previewOpen" : "field" });
  }

  function toggleEditing(key: FieldKey) {
    if (isOpen(key)) {
      setEditing(current => current.filter(value => value !== key));
      if (selection.key === key && selection.source !== "field") onSelection({ key, start: 0, end: 0, source: "field" });
      return;
    }
    setEditing(current => [...current, key]);
    select(key);
  }

  const bodyAuto = value.bodyLeadMode !== "custom";
  const leading = target === "text" ? null : value.typography[target]?.leading ?? defaultLeading(target);
  return (
    <div className="flex min-h-0 flex-col gap-3 xl:h-full">
      {/* 主操作。プレビューの近くから動かさず、対象の切り替えもここで完結させる。 */}
      <div className="shrink-0 rounded-xl border p-3" style={{ borderColor: "var(--border-accent)", backgroundColor: "rgba(139,92,246,.07)" }}>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>調整対象</span>
          <SelectInput
            aria-label="調整対象"
            value={target}
            onChange={event => select(event.target.value as FieldKey)}
            className="!mt-0 min-h-9 min-w-0 flex-1 text-sm"
          >
            {adjustableFields.map(key => <option key={key} value={key}>{fieldLabels[key]}</option>)}
          </SelectInput>
          <button
            type="button"
            aria-label="取り消す"
            disabled={readOnly || editHistory.undo.length === 0}
            onClick={undo}
            className="h-9 w-9 shrink-0 rounded border text-xs disabled:opacity-30"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            ↺
          </button>
          <button
            type="button"
            aria-label="やり直す"
            disabled={readOnly || editHistory.redo.length === 0}
            onClick={redo}
            className="h-9 w-9 shrink-0 rounded border text-xs disabled:opacity-30"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            ↻
          </button>
        </div>

        {allowTracking && (
          <p className="mt-2 text-[11px]" style={{ color: "var(--text-secondary)" }}>
            範囲：{range.end > range.start ? `${range.start + 1}〜${range.end}文字目` : "項目全体"}
          </p>
        )}

        {target === "text" && (
          <Checkbox
            checked={bodyAuto}
            disabled={readOnly}
            onChange={event => applyDraft({ ...value, bodyLeadMode: event.target.checked ? "auto" : "custom" })}
            label={<span className="text-xs">行送りは自動（天地25pxいっぱいまで広げる）</span>}
          />
        )}

        <div className={`mt-1 grid gap-3 ${allowTracking ? "grid-cols-2" : "grid-cols-1"}`}>
          {allowTracking && (
            <Field label="字間（%）">
              <EditableNumberInput
                disabled={readOnly}
                value={toPercent(tracking)}
                min={-20}
                max={20}
                placeholder={tracking === null ? "Mixed" : undefined}
                onValue={next => setTracking(Number((next / 100).toFixed(3)))}
              />
            </Field>
          )}
          {target === "text" ? (
            bodyAuto ? (
              <Field label="行送り（自動）">
                <p className="mt-1 flex min-h-11 items-center rounded-lg border px-3 text-base" style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
                  {diagnostic ? (diagnostic.lines <= 1 ? "天地中央" : `${Math.round(diagnostic.lead * 10) / 10}px`) : "—"}
                </p>
              </Field>
            ) : (
              <Field label="上限（px）">
                <EditableNumberInput
                  disabled={readOnly}
                  value={String(value.bodyMaxLead)}
                  min={28}
                  max={84}
                  integer
                  onValue={next => applyDraft({ ...value, bodyLeadMode: "custom", bodyMaxLead: next })}
                />
              </Field>
            )
          ) : (
            <Field label="行送り（%）">
              <EditableNumberInput
                disabled={readOnly}
                value={String(Math.round((leading ?? 1.2) * 100))}
                min={100}
                max={300}
                integer
                onValue={next => setLeading(Number((next / 100).toFixed(4)))}
              />
            </Field>
          )}
        </div>

        {!allowTracking && (
          <p className="mt-2 text-[10px]" style={{ color: "var(--text-secondary)" }}>
            字間の調整はPC・iPadで行えます。保存済みの字間はこの画面でもそのまま描画・保存されます。
          </p>
        )}

        {target === "text" && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {pageKind === "listed" ? (
              <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>掲載画像に評価文は描画されません。</span>
            ) : diagnostic ? (
              <>
                <Chip tone="info">{diagnostic.lines}行</Chip>
                <Chip tone={diagnostic.fits ? "info" : "error"}>下限 {diagnostic.minLead}px</Chip>
                {!diagnostic.fits && (
                  <span className="text-[11px] text-rose-300">下限を割るためPNGを書き出せません。行を減らすか、字間・改行・表示項目を調整してください。</span>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>

      <ul className="min-h-0 space-y-2 xl:flex-1 xl:overflow-y-auto xl:pr-1">
        {visibleFields.map(key => {
          const showKey = showOf[key];
          const listedBody = pageKind === "listed" && key === "text";
          const selected = !listedBody && target === key;
          const open = !listedBody && isOpen(key);
          const current = value.fields[key];
          return (
            <li
              key={key}
              className="rounded-lg border p-2"
              style={{
                borderColor: selected ? "var(--accent)" : "var(--border-subtle)",
                backgroundColor: selected ? "rgba(139,92,246,.08)" : "transparent",
              }}
            >
              <div className="flex items-start gap-2">
                {/* 見出しと現在値でひとつの選択面。クリックでこの項目が調整対象になる。 */}
                <button
                  type="button"
                  disabled={listedBody}
                  onClick={() => select(key)}
                  className="min-w-0 flex-1 text-left disabled:cursor-default"
                >
                  <span className="block text-[11px] font-medium" style={{ color: selected ? "#c4b5fd" : "var(--text-secondary)" }}>
                    {fieldLabels[key]}
                  </span>
                  {!open && (
                    <span className={`mt-0.5 block text-sm ${key === "text" ? "line-clamp-2" : "truncate"}`}>
                      {current || <span style={{ color: "var(--text-secondary)" }}>（未入力）</span>}
                    </span>
                  )}
                </button>
                {showKey && (
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 py-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    <input
                      type="checkbox"
                      checked={value.show[showKey]}
                      disabled={readOnly}
                      onChange={event => applyDraft({ ...value, show: { ...value.show, [showKey]: event.target.checked } })}
                      className="h-[13px] w-[13px] accent-violet-500"
                    />
                    出す
                  </label>
                )}
                {!readOnly && !listedBody && (
                  <button
                    type="button"
                    onClick={() => toggleEditing(key)}
                    aria-label={open ? `${fieldLabels[key]}の入力欄を閉じる` : `${fieldLabels[key]}の文字を修正`}
                    title={open ? "入力欄を閉じる" : "文字を修正"}
                    className="h-8 w-8 shrink-0 rounded border text-xs leading-none"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    {open ? "×" : "✎"}
                  </button>
                )}
              </div>

              {open && (
                key === "text" ? (
                  <TextArea
                    value={current}
                    rows={6}
                    disabled={readOnly}
                    onChange={event => setField(key, event.target.value)}
                    onSelect={event => selectRange(key, event.currentTarget.selectionStart || 0, event.currentTarget.selectionEnd || 0)}
                    ref={element => { fieldRefs.current[key] = element; }}
                  />
                ) : (
                  <TextInput
                    value={current}
                    disabled={readOnly}
                    onChange={event => setField(key, event.target.value)}
                    onSelect={event => selectRange(key, event.currentTarget.selectionStart || 0, event.currentTarget.selectionEnd || 0)}
                    ref={element => { fieldRefs.current[key] = element; }}
                  />
                )
              )}

              {key === "trackNo" && (
                <p className="mt-1 text-[10px]" style={{ color: "var(--text-secondary)" }}>番号と曲名は同じチェックで切り替わります。</p>
              )}
              {key === "text" && pageKind === "listed" && (
                <p className="mt-1 text-[10px]" style={{ color: "var(--text-secondary)" }}>掲載画像には描画されません。値は保存されます。</p>
              )}
            </li>
          );
        })}

        {pageKind !== "others" && <li className="rounded-lg border p-2" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>ジャケット</span>
            {value.jacketAssetId ? <Chip tone="success">差し替え済み</Chip> : <Chip tone="info">Release Master</Chip>}
          </div>
          {!readOnly && (
            <div className="mt-2 space-y-2">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={readOnly}
                onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) void onImage(file).then(id => { if (id) applyDraft({ ...value, jacketAssetId: id }); });
                  event.target.value = "";
                }}
                className="block w-full text-[11px]"
              />
              {value.jacketAssetId && (
                <SecondaryButton onClick={() => applyDraft({ ...value, jacketAssetId: null })} className="min-h-9 px-3 text-[11px]">
                  Release Masterの画像へ戻す
                </SecondaryButton>
              )}
              <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>PNG・JPEG・WebP、10MB以下。</p>
            </div>
          )}
        </li>}
      </ul>
    </div>
  );
}
