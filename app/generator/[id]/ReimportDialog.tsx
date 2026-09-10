"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { GeneratorDocument } from "@/lib/generator/model";
import type { ReimportDiff, ReimportGroup } from "@/lib/generator/reimport";
import { Checkbox, Chip, Modal, PrimaryButton, SecondaryButton } from "../ui";

const labels: Record<ReimportGroup, string> = { adopted: "採用", listed: "掲載", feature: "メイン", others: "Others" };

export default function ReimportDialog({
  document, diff, disabled, onApply, onClose,
}: {
  document: GeneratorDocument;
  diff: ReimportDiff;
  disabled: boolean;
  onApply(value: { addKeys: string[]; removeItemIds: string[]; resort: boolean }): void;
  onClose(): void;
}) {
  const [addKeys, setAddKeys] = useState(() => new Set(diff.added.map(value => value.key)));
  const [removeItemIds, setRemoveItemIds] = useState(() => new Set(diff.removed.filter(value => !value.edited).map(value => value.itemId)));
  const [resort, setResort] = useState(false);
  const outcome = useMemo(() => {
    const counts: Record<ReimportGroup, number> = { adopted: 0, listed: 0, feature: 0, others: 0 };
    for (const page of document.pages) if (page.kind !== "cover") counts[page.kind] += page.itemIds.length;
    for (const value of diff.added) if (addKeys.has(value.key)) counts[value.group] += 1;
    for (const value of diff.removed) if (removeItemIds.has(value.itemId)) counts[value.group] -= 1;
    for (const value of diff.moved) { counts[value.from] -= 1; counts[value.to] += 1; }
    const images = document.series === "weekly" ? 2 + counts.feature : counts.adopted + Math.ceil(counts.listed / 2);
    const invalid = document.series === "weekly" && (counts.feature > (diff.limits.featureMax || 5) || counts.others > (diff.limits.othersMax || 60));
    return { counts, images, invalid };
  }, [addKeys, diff, document, removeItemIds]);

  function toggle(setter: Dispatch<SetStateAction<Set<string>>>, key: string) {
    setter(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  const selectedCount = addKeys.size + removeItemIds.size + diff.moved.length;

  return (
    <Modal
      title="Release Masterから取り込み直す"
      description="作品の追加・削除・区分移動を確認し、共同編集の新しいversionとして確定します。文字修正・背景・共通設定は変えません。"
      onClose={() => { if (!disabled) onClose(); }}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Chip tone={selectedCount ? "warn" : "success"}>変更 {selectedCount}件</Chip>
          <Chip tone="info">実行後 {outcome.images}枚・作品 {Object.values(outcome.counts).reduce((sum, count) => sum + count, 0)}件</Chip>
          {document.series === "weekly" && <Chip tone={outcome.invalid ? "error" : "info"}>メイン {outcome.counts.feature}/5 · Others {outcome.counts.others}/60</Chip>}
        </div>

        {diff.added.length > 0 && <section className="space-y-2">
          <h3 className="text-sm font-semibold">追加</h3>
          {diff.added.map(value => <label key={value.key} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2" style={{ borderColor: "var(--border-subtle)" }}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-500" checked={addKeys.has(value.key)} disabled={disabled} onChange={() => toggle(setAddKeys, value.key)} />
            <span className="min-w-0 flex-1 text-sm"><Chip tone="success">{labels[value.group]}</Chip> <span className="ml-1">{value.title} / {value.artist}</span></span>
          </label>)}
        </section>}

        {diff.removed.length > 0 && <section className="space-y-2">
          <h3 className="text-sm font-semibold">削除</h3>
          <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>手で修正済みの作品は、内容を守るため既定で選択していません。</p>
          {diff.removed.map(value => <label key={value.itemId} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2" style={{ borderColor: "var(--border-subtle)" }}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-500" checked={removeItemIds.has(value.itemId)} disabled={disabled} onChange={() => toggle(setRemoveItemIds, value.itemId)} />
            <span className="min-w-0 flex-1 text-sm"><Chip tone="error">{labels[value.group]}</Chip> {value.edited && <Chip tone="warn">手で修正済み</Chip>} <span className="ml-1">{value.title} / {value.artist}</span></span>
          </label>)}
        </section>}

        {diff.moved.length > 0 && <section className="space-y-2">
          <h3 className="text-sm font-semibold">区分の移動</h3>
          {diff.moved.map(value => <div key={value.itemId} className="rounded-lg border p-2 text-sm" style={{ borderColor: "var(--border-subtle)" }}>
            <Chip tone="info">{labels[value.from]} → {labels[value.to]}</Chip> <span className="ml-1">{value.title} / {value.artist}</span>
          </div>)}
        </section>}

        {!diff.added.length && !diff.removed.length && !diff.moved.length && <p className="text-sm">作品の増減・区分移動はありません。</p>}

        <Checkbox checked={resort} disabled={disabled} onChange={event => setResort(event.target.checked)} label="取り込み時の規則で区分内を並べ直す" />
        <p className="text-[11px] leading-4" style={{ color: outcome.invalid ? "#fca5a5" : "var(--text-secondary)" }}>
          {outcome.invalid ? "Weeklyの上限を超えています。追加または削除の選択を見直してください。" : "OFFの場合は既存の並びを保ち、新しい作品だけ区分末尾へ追加します。"}
        </p>
        <div className="flex justify-end gap-2">
          <SecondaryButton disabled={disabled} onClick={onClose}>キャンセル</SecondaryButton>
          <PrimaryButton
            disabled={disabled || outcome.invalid || (!selectedCount && !resort)}
            onClick={() => onApply({ addKeys: [...addKeys], removeItemIds: [...removeItemIds], resort })}
          >
            新しいversionとして実行
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
