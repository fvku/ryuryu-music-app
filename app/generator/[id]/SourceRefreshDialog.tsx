"use client";

import type { Dispatch, SetStateAction } from "react";
import { Chip, SecondaryButton } from "../ui";
import { FIELD_LABELS, type SourceRefreshChange, type SourceRefreshItem } from "./source-refresh";

const kindLabels: Record<SourceRefreshItem["kind"], string> = {
  adopted: "採用", listed: "掲載", feature: "メイン", others: "Others",
};

export function keyOfChange(itemId: string, change: Pick<SourceRefreshChange, "key">): string {
  return `${itemId}:${change.key}`;
}

/** 取り込み時の値のままの項目だけを既定でチェックする。手で直した項目は外しておく。 */
export function initialFieldSelection(results: SourceRefreshItem[]): Set<string> {
  return new Set(results.flatMap(item => item.changes.filter(change => !change.edited).map(change => keyOfChange(item.itemId, change))));
}

/** 評価文のように長い項目でも一覧が流れないよう、3行で切る。全文は反映後に入力欄で読める。 */
function Value({ label, value, tone }: { label: string; value: string; tone: "current" | "next" }) {
  return (
    <p className="line-clamp-3 min-w-0 text-[11px] leading-4">
      <span style={{ color: "var(--text-secondary)" }}>{label} </span>
      <span className={tone === "next" ? "text-emerald-300" : ""} style={tone === "current" ? { color: "var(--text-secondary)" } : undefined}>
        {value || "（未入力）"}
      </span>
    </p>
  );
}

/**
 * Release Masterの最新値との差分。ここで選んだ分は**下書きへ入るだけ**で、
 * 共有DBへは画像ごとの「保存」で確定する。作品の増減とは確定のされ方が違う。
 */
export function SourceRefreshSection({ results, disabled, selected, onSelected }: {
  results: SourceRefreshItem[];
  disabled: boolean;
  selected: Set<string>;
  onSelected: Dispatch<SetStateAction<Set<string>>>;
}) {
  const changes = results.flatMap(item => item.changes.map(change => ({ item, change })));
  const unmatched = results.filter(item => !item.matched);

  function toggle(itemId: string, change: SourceRefreshChange) {
    const key = keyOfChange(itemId, change);
    onSelected(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <section className="space-y-3 rounded-xl border p-3" style={{ borderColor: "var(--border-subtle)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">文字情報</h3>
        <Chip tone="info">下書きへ入り、画像の保存で確定</Chip>
      </div>
      <p className="text-[11px] leading-4" style={{ color: "var(--text-secondary)" }}>
        比べるのは、その画像に出ている項目だけです。表示を外した項目、掲載画像の評価文は対象外です。
        Release Masterの読み取りは最大60秒ぶん前の内容になることがあります。直したばかりの値が出ない場合は、少し待って再実行してください。
      </p>

      {changes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={selected.size ? "warn" : "info"}>{selected.size} / {changes.length} 項目</Chip>
          <SecondaryButton
            disabled={disabled}
            onClick={() => onSelected(new Set(changes.map(({ item, change }) => keyOfChange(item.itemId, change))))}
            className="min-h-9 px-3 text-xs"
          >
            すべて選ぶ
          </SecondaryButton>
          <SecondaryButton disabled={disabled} onClick={() => onSelected(new Set())} className="min-h-9 px-3 text-xs">
            すべて外す
          </SecondaryButton>
        </div>
      )}

      {changes.length === 0 && <p className="text-sm">Release Masterと同じ内容です。直す文字情報はありません。</p>}

      <ul className="space-y-2">
        {results.filter(item => item.changes.length > 0).map(item => (
          <li key={item.itemId} className="rounded-lg border p-2" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="info">画像 {item.pageNo}</Chip>
              <Chip tone="info">{kindLabels[item.kind]}</Chip>
              <span className="min-w-0 flex-1 truncate text-sm">{item.title || "（作品名未入力）"} / {item.artist}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {item.changes.map(change => (
                <li key={change.key}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={selected.has(keyOfChange(item.itemId, change))}
                      disabled={disabled}
                      onChange={() => toggle(item.itemId, change)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-violet-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">{FIELD_LABELS[change.key]}</span>
                        {change.edited && <Chip tone="warn">手で修正済み</Chip>}
                      </span>
                      <Value label="現在" value={change.current} tone="current" />
                      <Value label="Release Master" value={change.next} tone="next" />
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {unmatched.length > 0 && (
        <div className="rounded-lg border p-2" style={{ borderColor: "var(--border-subtle)" }}>
          <Chip tone="error">Release Masterに見つかりません</Chip>
          <p className="mt-1 text-[11px] leading-4" style={{ color: "var(--text-secondary)" }}>
            UID・No.・作品名＋アーティストのどれでも照合できませんでした。Release Master側で行が消えたか、名前が大きく変わっています。
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {unmatched.map(item => (
              <li key={item.itemId} className="truncate">画像 {item.pageNo} · {item.title || "（作品名未入力）"} / {item.artist}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
