"use client";

import { useEffect, useRef, useState } from "react";
import type { GeneratorDocument, ItemContent } from "@/lib/generator/model";
import { applySelectedSpacing, rebaseKerns, selectedSpacing } from "@/lib/generator/text-edit";
import type { BodyDiagnostic } from "../GeneratorPreview";
import { Checkbox, Chip, Field, SecondaryButton, TextArea, TextInput } from "../ui";
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
  jacketMissing = false,
  onDraft,
  onImage,
  onImageUrl,
  selection,
  onSelection,
  allowTracking,
  pendingSource = false,
  onCancelSource,
}: {
  item: GeneratorDocument["items"][number];
  draft?: ItemContent;
  state: TargetState;
  pageKind: "adopted" | "listed" | "feature" | "others";
  diagnostic: BodyDiagnostic | null;
  /** 描画時にジャケットを用意できなかった作品。差し替えの導線をその場に出す。 */
  jacketMissing?: boolean;
  onDraft(value: ItemContent): void;
  onImage(file: File): Promise<string | null>;
  onImageUrl(url: string): Promise<string | null>;
  selection: FieldSelection;
  onSelection(next: { key: FieldKey; start: number; end: number; source: FieldSelection["source"] }): void;
  /** iPhoneでは字間の調整を出さない。値そのものは保持したまま、操作だけを外す。 */
  allowTracking: boolean;
  /** Release Masterから取り込んだ内容（カバー画像を含む）が保存待ちか。 */
  pendingSource?: boolean;
  onCancelSource?(): void;
}) {
  const value = draft || item.content;
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const appliedRef = useRef("");
  const [editHistory, setEditHistory] = useState<{ undo: ItemContent[]; redo: ItemContent[] }>({ undo: [], redo: [] });
  const readOnly = !state.locked || state.disabled;
  const [jacketUrl, setJacketUrl] = useState("");
  const [jacketNote, setJacketNote] = useState<{ tone: "warn" | "info"; text: string } | null>(null);
  const [fetchingJacket, setFetchingJacket] = useState(false);

  /** 貼ったURLはサーバーで安全に取得し、既存のジャケット差し替えとして保存する。 */
  async function applyJacketUrl(draft: ItemContent) {
    setFetchingJacket(true);
    setJacketNote({ tone: "info", text: "画像URLから取り込んでいます…" });
    try {
      const id = await onImageUrl(jacketUrl.trim());
      if (!id) {
        setJacketNote({ tone: "warn", text: "画像を取り込めませんでした。画面上部の理由を確認してください。" });
        return;
      }
      applyDraft({ ...draft, jacketAssetId: id });
      setJacketUrl("");
      setJacketNote({ tone: "info", text: "URLの画像に差し替えました。この画像の「保存」で版に確定します。" });
    } catch {
      setJacketNote({
        tone: "warn",
        text: "画像を取り込めませんでした。画面上部の理由を確認してください。",
      });
    } finally {
      setFetchingJacket(false);
    }
  }

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
  const target = adjustableFields.includes(selection.key) ? selection.key : adjustableFields[0];
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

  function selectRange(key: FieldKey, start: number, end: number) {
    // プレビューから開いた欄の中で選び直しても、フォーカスを奪い直さない。
    const fromPreview = selection.key === key && selection.source !== "field";
    onSelection({ key, start, end, source: fromPreview ? "previewOpen" : "field" });
  }

  const bodyAuto = value.bodyLeadMode !== "custom";
  const leading = target === "text" ? null : value.typography[target]?.leading ?? defaultLeading(target);
  const jacketChanged = value.jacketAssetId !== item.content.jacketAssetId;

  /**
   * 字間・行送り。選んだ欄の直下に開く（2026-09-18、利用者の決定）。
   * 仕上げで繰り返す操作なので、直している文字のすぐ近くに置く。
   */
  function renderTuning() {
    return (
      <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--border-subtle)", backgroundColor: "rgba(0,0,0,.18)" }}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>文字の詰め・行間</span>
          <span className="flex-1" />
          <button
            type="button"
            disabled={readOnly || editHistory.undo.length === 0}
            onClick={undo}
            className="inline-flex min-h-8 items-center rounded border px-2 text-[11px] disabled:opacity-30"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            ↺ 元に戻す
          </button>
          <button
            type="button"
            disabled={readOnly || editHistory.redo.length === 0}
            onClick={redo}
            className="inline-flex min-h-8 items-center rounded border px-2 text-[11px] disabled:opacity-30"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            ↻ やり直す
          </button>
        </div>

        {allowTracking && (
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
            範囲：{range.end > range.start ? `${range.start + 1}〜${range.end}文字目` : "この欄の全体（入力欄で文字を選ぶと、その範囲だけ変えられます）"}
          </p>
        )}

        {target === "text" && (
          <Checkbox
            checked={bodyAuto}
            disabled={readOnly}
            onChange={event => applyDraft({ ...value, bodyLeadMode: event.target.checked ? "auto" : "custom" })}
            label={<span className="text-xs">行間は自動（上下25pxいっぱいまで広げる）</span>}
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
              <Field label="行間（自動）">
                <p className="mt-1 flex min-h-11 items-center rounded-lg border px-3 text-base" style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
                  {diagnostic ? (diagnostic.lines <= 1 ? "上下の中央" : `${Math.round(diagnostic.lead * 10) / 10}px`) : "—"}
                </p>
              </Field>
            ) : (
              <Field label="行間の上限（px）">
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
            <Field label="行間（%）">
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

        {target === "text" && diagnostic && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip tone="info">{diagnostic.lines}行</Chip>
            <Chip tone={diagnostic.fits ? "info" : "error"}>最小の行間 {diagnostic.minLead}px</Chip>
            {!diagnostic.fits && (
              <span className="text-[11px] text-rose-300">行間が狭くなりすぎるため書き出せません。行を減らすか、字間・改行・表示する項目を調整してください。</span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
        直したい欄を押すか、プレビューの文字を押してください。
      </p>
      {/* スクロールは編集パネル全体で持つ（背景色と文字を1枚にしたため）。 */}
      <ul className="space-y-2">
        {visibleFields.map(key => {
          const showKey = showOf[key];
          const listedBody = pageKind === "listed" && key === "text";
          const selected = !listedBody && target === key;
          const current = value.fields[key];
          // 保存済みから変えた欄は「変更あり」の文字と細い黄の枠で示す。色だけに頼らない。
          const changed = current !== item.content.fields[key]
            || (showKey !== null && value.show[showKey] !== item.content.show[showKey]);
          return (
            <li
              key={key}
              className="rounded-lg border"
              style={{
                borderColor: changed ? "rgba(245,158,11,.6)" : "var(--border-subtle)",
                // 選んでいる欄は左の紫の線と薄い紫の背景。パネル全体の「編集中」の枠とは別の見え方にする。
                boxShadow: selected ? "inset 3px 0 0 var(--accent)" : undefined,
                backgroundColor: selected ? "rgba(139,92,246,.08)" : "transparent",
              }}
            >
              <div className="flex items-start gap-2 p-2 pl-3">
                {/* 行のどこを押しても、その欄が開く（小さな✎を探させない）。 */}
                <button
                  type="button"
                  disabled={listedBody}
                  onClick={() => select(key)}
                  className="min-w-0 flex-1 text-left disabled:cursor-default"
                >
                  <span className="block text-[11px] font-medium" style={{ color: selected ? "#c4b5fd" : "var(--text-secondary)" }}>
                    {fieldLabels[key]}
                    {changed && <span className="ml-1.5 text-amber-300">・変更あり</span>}
                  </span>
                  {!selected && (
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
                    画像に表示
                  </label>
                )}
              </div>

              {selected && (
                <div className="space-y-2 px-3 pb-3">
                  {key === "text" ? (
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
                  )}
                  {!current.trim() && (
                    <p className="text-[10px] leading-4" style={{ color: "var(--text-secondary)" }}>
                      空欄です。ここで入力するか、Release Masterを直してから「読み込み」→「Release Masterから取り込み直す」を使ってください。
                    </p>
                  )}
                  {key === "trackNo" && (
                    <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>番号と曲名は同じ「画像に表示」で切り替わります。</p>
                  )}
                  {renderTuning()}
                </div>
              )}

              {listedBody && (
                <p className="px-3 pb-2 text-[10px]" style={{ color: "var(--text-secondary)" }}>掲載画像には描画されません。値は保存されます。</p>
              )}
            </li>
          );
        })}

        {pageKind !== "others" && <li className="rounded-lg border p-2 pl-3" style={{ borderColor: jacketChanged ? "rgba(245,158,11,.6)" : "var(--border-subtle)" }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
              ジャケット
              {jacketChanged && <span className="ml-1.5 text-amber-300">・変更あり</span>}
            </span>
            {value.jacketAssetId
              ? <Chip tone="success">差し替えた画像</Chip>
              : jacketMissing ? <Chip tone="warn">画像がありません</Chip> : <Chip tone="info">取り込んだ画像</Chip>}
          </div>
          {jacketMissing && !value.jacketAssetId && (
            <p className="mt-1 text-[10px] leading-4" style={{ color: "#fcd34d" }}>
              Release Masterに画像のURLが無いか、画像を読み込めませんでした。下からファイルを選ぶか、画像のURLを貼ってください。
            </p>
          )}
          {!readOnly && (
            <div className="mt-2 space-y-2">
              {/* ブラウザ標準の「Choose File」は英語のまま出るので、日本語のボタンで包む。 */}
              <label className="inline-flex min-h-9 cursor-pointer items-center rounded-xl border px-3 text-[11px] hover:bg-white/5" style={{ borderColor: "var(--border-subtle)" }}>
                画像ファイルを選ぶ
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={readOnly}
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) void onImage(file).then(id => { if (id) applyDraft({ ...value, jacketAssetId: id }); });
                    event.target.value = "";
                  }}
                  className="sr-only"
                />
              </label>
              <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>PNG・JPEG・WebP、10MB以下。</p>
              <div className="flex gap-2">
                <TextInput
                  value={jacketUrl}
                  onChange={event => setJacketUrl(event.target.value)}
                  placeholder="画像のURLを貼る（https）"
                  disabled={readOnly || fetchingJacket}
                  className="min-w-0 flex-1 !mt-0 text-[11px]"
                />
                <SecondaryButton
                  disabled={readOnly || fetchingJacket || !jacketUrl.trim()}
                  onClick={() => void applyJacketUrl(value)}
                  className="min-h-9 shrink-0 px-3 text-[11px]"
                >
                  URLから取り込む
                </SecondaryButton>
              </div>
              {jacketNote && (
                <p className="text-[10px] leading-4" style={{ color: jacketNote.tone === "warn" ? "#fcd34d" : "var(--text-secondary)" }}>
                  {jacketNote.text}
                </p>
              )}
              {value.jacketAssetId && (
                <SecondaryButton onClick={() => applyDraft({ ...value, jacketAssetId: null })} className="min-h-9 px-3 text-[11px]">
                  取り込んだ画像へ戻す
                </SecondaryButton>
              )}
            </div>
          )}
        </li>}

        {pendingSource && (
          <li className="rounded-lg border p-2 pl-3 text-[11px]" style={{ borderColor: "rgba(245,158,11,.6)" }}>
            <p className="leading-5">
              Release Masterから取り込んだ情報（カバー画像など）が、保存待ちです。「保存」すると確定します。
            </p>
            {onCancelSource && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <SecondaryButton onClick={onCancelSource} className="min-h-9 px-3 text-[11px]">取り込みを取り消す</SecondaryButton>
                <span style={{ color: "var(--text-secondary)" }}>直した文字はそのまま残ります。</span>
              </div>
            )}
          </li>
        )}
      </ul>
    </div>
  );
}
