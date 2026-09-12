"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { GeneratorDocument } from "@/lib/generator/model";
import type { ReimportDiff, ReimportGroup } from "@/lib/generator/reimport";
import { Checkbox, Chip } from "../ui";

const labels: Record<ReimportGroup, string> = { adopted: "採用", listed: "掲載", feature: "メイン", others: "Others" };

export type ReimportSelection = { addKeys: Set<string>; removeItemIds: Set<string>; resort: boolean };

export function initialReimportSelection(diff: ReimportDiff): ReimportSelection {
  return {
    addKeys: new Set(diff.added.map(value => value.key)),
    // 手を入れた作品は内容を守るため既定で外す。
    removeItemIds: new Set(diff.removed.filter(value => !value.edited).map(value => value.itemId)),
    resort: false,
  };
}

export function reimportOutcome(document: GeneratorDocument, diff: ReimportDiff, selection: ReimportSelection) {
  const counts: Record<ReimportGroup, number> = { adopted: 0, listed: 0, feature: 0, others: 0 };
  for (const page of document.pages) if (page.kind !== "cover") counts[page.kind] += page.itemIds.length;
  for (const value of diff.added) if (selection.addKeys.has(value.key)) counts[value.group] += 1;
  for (const value of diff.removed) if (selection.removeItemIds.has(value.itemId)) counts[value.group] -= 1;
  for (const value of diff.moved) { counts[value.from] -= 1; counts[value.to] += 1; }
  const images = document.series === "weekly" ? 2 + counts.feature : counts.adopted + Math.ceil(counts.listed / 2);
  const invalid = document.series === "weekly" && (counts.feature > (diff.limits.featureMax || 5) || counts.others > (diff.limits.othersMax || 60));
  const changes = selection.addKeys.size + selection.removeItemIds.size + diff.moved.length;
  return { counts, images, invalid, changes };
}

/**
 * 作品の増減と区分移動。ここで選んだ分は、実行時に**1つの新しいversionとして確定**する。
 * 文字情報（下書きへ入るだけ）とは確定のされ方が違うので、節を分けて見せる。
 */
export function ReimportSection({ document, diff, disabled, selection, onSelection }: {
  document: GeneratorDocument;
  diff: ReimportDiff;
  disabled: boolean;
  selection: ReimportSelection;
  onSelection: Dispatch<SetStateAction<ReimportSelection>>;
}) {
  const outcome = useMemo(() => reimportOutcome(document, diff, selection), [document, diff, selection]);

  function toggle(field: "addKeys" | "removeItemIds", key: string) {
    onSelection(current => {
      const next = new Set(current[field]);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...current, [field]: next };
    });
  }

  return (
    <section className="space-y-3 rounded-xl border p-3" style={{ borderColor: "var(--border-subtle)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">作品の増減・区分</h3>
        <Chip tone="warn">実行するとversionに確定</Chip>
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip tone={outcome.changes ? "warn" : "success"}>変更 {outcome.changes}件</Chip>
        <Chip tone="info">実行後 {outcome.images}枚・作品 {Object.values(outcome.counts).reduce((sum, count) => sum + count, 0)}件</Chip>
        {document.series === "weekly" && <Chip tone={outcome.invalid ? "error" : "info"}>メイン {outcome.counts.feature}/5 · Others {outcome.counts.others}/60</Chip>}
      </div>

      {diff.added.length > 0 && <div className="space-y-2">
        <h4 className="text-xs font-semibold">追加</h4>
        {diff.added.map(value => <label key={value.key} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2" style={{ borderColor: "var(--border-subtle)" }}>
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-500" checked={selection.addKeys.has(value.key)} disabled={disabled} onChange={() => toggle("addKeys", value.key)} />
          <span className="min-w-0 flex-1 text-sm"><Chip tone="success">{labels[value.group]}</Chip> <span className="ml-1">{value.title} / {value.artist}</span></span>
        </label>)}
      </div>}

      {diff.removed.length > 0 && <div className="space-y-2">
        <h4 className="text-xs font-semibold">削除</h4>
        <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>手で修正済みの作品は、内容を守るため既定で選択していません。</p>
        {diff.removed.map(value => <label key={value.itemId} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2" style={{ borderColor: "var(--border-subtle)" }}>
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-500" checked={selection.removeItemIds.has(value.itemId)} disabled={disabled} onChange={() => toggle("removeItemIds", value.itemId)} />
          <span className="min-w-0 flex-1 text-sm"><Chip tone="error">{labels[value.group]}</Chip> {value.edited && <Chip tone="warn">手で修正済み</Chip>} <span className="ml-1">{value.title} / {value.artist}</span></span>
        </label>)}
      </div>}

      {diff.moved.length > 0 && <div className="space-y-2">
        <h4 className="text-xs font-semibold">区分の移動</h4>
        {diff.moved.map(value => <div key={value.itemId} className="rounded-lg border p-2 text-sm" style={{ borderColor: "var(--border-subtle)" }}>
          <Chip tone="info">{labels[value.from]} → {labels[value.to]}</Chip> <span className="ml-1">{value.title} / {value.artist}</span>
        </div>)}
      </div>}

      {!diff.added.length && !diff.removed.length && !diff.moved.length && <p className="text-sm">作品の増減・区分移動はありません。</p>}

      <Checkbox
        checked={selection.resort}
        disabled={disabled}
        onChange={event => onSelection(current => ({ ...current, resort: event.target.checked }))}
        label="取り込み時の規則で区分内を並べ直す"
      />
      <p className="text-[11px] leading-4" style={{ color: outcome.invalid ? "#fca5a5" : "var(--text-secondary)" }}>
        {outcome.invalid
          ? "Weeklyの上限を超えています。追加または削除の選択を見直してください。"
          : "OFFの場合は既存の並びを保ち、新しい作品だけ区分末尾へ追加します。"}
      </p>
    </section>
  );
}
