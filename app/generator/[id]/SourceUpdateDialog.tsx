"use client";

import { useState } from "react";
import type { GeneratorDocument } from "@/lib/generator/model";
import type { ReimportDiff } from "@/lib/generator/reimport";
import { Modal, PrimaryButton, SecondaryButton } from "../ui";
import { ReimportSection, initialReimportSelection, reimportOutcome, type ReimportSelection } from "./ReimportDialog";
import { SourceRefreshSection, initialFieldSelection, keyOfChange } from "./SourceRefreshDialog";
import type { SourceRefreshChange, SourceRefreshItem } from "./source-refresh";

export type SourceUpdate = {
  addKeys: string[];
  removeItemIds: string[];
  resort: boolean;
  fields: { itemId: string; key: SourceRefreshChange["key"]; next: string }[];
};

/**
 * Release Master側の変更を1つの画面で確認する。
 * 作品の増減はその場で新しいversionに確定し、文字情報は下書きへ入る。
 * 確定のされ方が違うので節を分け、実行順序も見出しに書いてある。
 */
export default function SourceUpdateDialog({ document, diff, refresh, refreshError, disabled, onApply, onClose }: {
  document: GeneratorDocument;
  diff: ReimportDiff;
  refresh: SourceRefreshItem[];
  /** 文字情報だけ読めなかったときの理由。作品の増減は読めているので、そちらは操作できる。 */
  refreshError: string | null;
  disabled: boolean;
  onApply(value: SourceUpdate): void;
  onClose(): void;
}) {
  const [structure, setStructure] = useState<ReimportSelection>(() => initialReimportSelection(diff));
  const [fields, setFields] = useState<Set<string>>(() => initialFieldSelection(refresh));

  const outcome = reimportOutcome(document, diff, structure);
  const selectedFields = refresh.flatMap(item => item.changes
    .filter(change => fields.has(keyOfChange(item.itemId, change)))
    .map(change => ({ itemId: item.itemId, key: change.key, next: change.next })));
  const nothingToDo = outcome.changes === 0 && !structure.resort && selectedFields.length === 0;

  return (
    <Modal
      title="Release Masterから更新"
      description="Release Masterを読み直した結果です。作品の増減は実行時に新しいversionとして確定し、そのあと文字情報が下書きへ入ります。背景色と共通設定は変えません。"
      onClose={() => { if (!disabled) onClose(); }}
    >
      <div className="space-y-4">
        <ReimportSection document={document} diff={diff} disabled={disabled} selection={structure} onSelection={setStructure} />
        <SourceRefreshSection results={refresh} error={refreshError} disabled={disabled} selected={fields} onSelected={setFields} />
        <div className="flex flex-wrap justify-end gap-2">
          <SecondaryButton disabled={disabled} onClick={onClose}>キャンセル</SecondaryButton>
          <PrimaryButton
            disabled={disabled || outcome.invalid || nothingToDo}
            onClick={() => onApply({
              addKeys: [...structure.addKeys],
              removeItemIds: [...structure.removeItemIds],
              resort: structure.resort,
              fields: selectedFields,
            })}
          >
            更新を実行
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
