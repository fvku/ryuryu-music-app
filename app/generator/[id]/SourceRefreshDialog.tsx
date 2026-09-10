"use client";

import { useState } from "react";
import { Chip, Modal, PrimaryButton, SecondaryButton } from "../ui";
import { FIELD_LABELS, type SourceRefreshChange, type SourceRefreshItem } from "./source-refresh";

const kindLabels: Record<SourceRefreshItem["kind"], string> = {
  adopted: "採用", listed: "掲載", feature: "メイン", others: "Others",
};

function keyOfChange(itemId: string, change: SourceRefreshChange): string {
  return `${itemId}:${change.key}`;
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
 * Release Masterの最新値との差分を、画像ごとに選んで下書きへ入れる。
 * 取り込み時の値のままの項目は既定でチェック、手で直した項目は外しておく。
 */
export default function SourceRefreshDialog({
  results,
  disabled,
  onApply,
  onClose,
}: {
  results: SourceRefreshItem[];
  disabled: boolean;
  onApply(selected: { itemId: string; key: SourceRefreshChange["key"]; next: string }[]): void;
  onClose(): void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(
    results.flatMap(item => item.changes.filter(change => !change.edited).map(change => keyOfChange(item.itemId, change))),
  ));

  const changes = results.flatMap(item => item.changes.map(change => ({ item, change })));
  const unmatched = results.filter(item => !item.matched);

  function toggle(itemId: string, change: SourceRefreshChange) {
    const key = keyOfChange(itemId, change);
    setSelected(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function apply() {
    onApply(changes
      .filter(({ item, change }) => selected.has(keyOfChange(item.itemId, change)))
      .map(({ item, change }) => ({ itemId: item.itemId, key: change.key, next: change.next })));
  }

  return (
    <Modal
      title="Release Masterから再取得"
      description="変わった項目だけをこの端末の下書きへ入れます。共有DBへは、これまでどおり作品ごとの「保存」で確定します。"
      onClose={onClose}
    >
      <div className="space-y-3">
        <p className="text-[11px] leading-4" style={{ color: "var(--text-secondary)" }}>
          比べるのは、その画像に出ている項目だけです。表示を外した項目、掲載画像の評価文、ジャケット画像は対象外です。
          Release Masterの読み取りは最大60秒ぶん前の内容になることがあります。直したばかりの値が出ない場合は、少し待って再実行してください。
        </p>

        {changes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={selected.size ? "warn" : "info"}>{selected.size} / {changes.length} 項目</Chip>
            <SecondaryButton
              disabled={disabled}
              onClick={() => setSelected(new Set(changes.map(({ item, change }) => keyOfChange(item.itemId, change))))}
              className="min-h-9 px-3 text-xs"
            >
              すべて選ぶ
            </SecondaryButton>
            <SecondaryButton disabled={disabled} onClick={() => setSelected(new Set())} className="min-h-9 px-3 text-xs">
              すべて外す
            </SecondaryButton>
            <span className="flex-1" />
            <PrimaryButton disabled={disabled || selected.size === 0} onClick={apply} className="min-h-9 px-3 text-xs">
              下書きへ反映
            </PrimaryButton>
          </div>
        )}

        {results.length === 0 && (
          <p className="text-sm">Release Masterと同じ内容です。取り込む差分はありません。</p>
        )}

        <ul className="space-y-2">
          {results.filter(item => item.changes.length > 0).map(item => (
            <li key={item.itemId} className="rounded-lg border p-2" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="info">画像 {item.pageNo}</Chip>
                <Chip tone="info">{kindLabels[item.kind]}</Chip>
                <span className="min-w-0 flex-1 truncate text-sm">{item.title || "（作品名未入力）"} / {item.artist}</span>
              </div>
              <ul className="mt-2 space-y-1">
                {item.changes.map(change => {
                  const checked = selected.has(keyOfChange(item.itemId, change));
                  return (
                    <li key={change.key}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                        <input
                          type="checkbox"
                          checked={checked}
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
                  );
                })}
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
      </div>
    </Modal>
  );
}
