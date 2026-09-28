"use client";

import { useState } from "react";
import { Badge, Button, Note, OK, WARN } from "./parts";

export interface Candidate {
  id: string;
  source: "aoty" | "spotify";
  date: string;
  title: string;
  artist: string;
  waboku: "洋楽" | "邦楽";
  type: string;
  excludeReason: string | null;
  existingRow: number | null;
  inWeek: boolean;
  spotifyUrl?: string;
  coverUrl?: string;
  trackCount?: number;
  totalDurationMs?: number;
}

/** 最初から見せる候補（新規・今週・シングル以外）。除外候補も理由つきで見せる */
export function isPrimary(c: Candidate): boolean {
  return !c.existingRow && c.inWeek && c.excludeReason !== "シングル";
}

/** 最初からチェックを入れる候補 */
export function isDefaultSelected(c: Candidate): boolean {
  return isPrimary(c) && !c.excludeReason;
}

function shortDate(iso: string) {
  const [, m, d] = iso.split("-");
  const day = ["日", "月", "火", "水", "木", "金", "土"][new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return `${Number(m)}/${Number(d)}（${day}）`;
}

function Row({ c, checked, onToggle }: { c: Candidate; checked: boolean; onToggle?: () => void }) {
  return (
    <label
      className="flex items-center gap-3 py-2 px-2 rounded-lg"
      style={{ cursor: onToggle ? "pointer" : "default", backgroundColor: checked ? "rgba(96,165,250,0.08)" : "transparent" }}
    >
      {onToggle && <input type="checkbox" checked={checked} onChange={onToggle} className="flex-shrink-0 w-4 h-4" />}
      {c.coverUrl !== undefined && (
        c.coverUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={c.coverUrl} alt="" width={40} height={40} className="w-10 h-10 rounded flex-shrink-0 object-cover" />
          : <span className="w-10 h-10 rounded flex-shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium" style={{ color: "var(--text-primary)" }}>{c.title}</span>
        <span className="block truncate text-xs" style={{ color: "var(--text-secondary)" }}>{c.artist}</span>
      </span>
      <span className="flex flex-col items-end gap-1 flex-shrink-0 text-xs" style={{ color: "var(--text-secondary)" }}>
        <span>{shortDate(c.date)}</span>
        <span className="flex gap-1">
          {c.type && <Badge>{c.type}{c.trackCount ? `・${c.trackCount}曲` : ""}</Badge>}
          {c.existingRow && <Badge color={OK}>登録済み（行{c.existingRow}）</Badge>}
          {!c.existingRow && c.excludeReason && <Badge color={WARN}>{c.excludeReason}</Badge>}
          {!c.existingRow && !c.inWeek && <Badge>今週以外</Badge>}
        </span>
      </span>
    </label>
  );
}

function Folded({ label, items, selected, onToggle }: {
  label: string; items: Candidate[]; selected: Set<string>; onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className="text-xs underline underline-offset-2" style={{ color: "var(--text-secondary)" }}>
        {open ? "▾" : "▸"} {label}（{items.length}件）
      </button>
      {open && (
        <div className="mt-1 flex flex-col">
          {items.map((c) => (
            <Row key={c.id} c={c} checked={selected.has(c.id)} onToggle={c.existingRow ? undefined : () => onToggle(c.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CandidateList({
  candidates, selected, onToggle, onAdd, adding, singlesLabel = "シングル",
}: {
  candidates: Candidate[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAdd: () => void;
  adding: boolean;
  singlesLabel?: string;
}) {
  const primary = candidates.filter(isPrimary);
  const existing = candidates.filter((c) => c.existingRow);
  const otherWeeks = candidates.filter((c) => !c.existingRow && !c.inWeek);
  const singles = candidates.filter((c) => !c.existingRow && c.inWeek && c.excludeReason === "シングル");
  const count = candidates.filter((c) => selected.has(c.id)).length;

  return (
    <div className="flex flex-col gap-3">
      {primary.length === 0 ? (
        <Note tone="ok">新しく追加する作品はありません。{existing.length > 0 && `今週分の${existing.length}件は登録済みです。`}</Note>
      ) : (
        <>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            チェックが入っている作品が追加されます。黄色の印は「オリジナルアルバムではなさそう」と判定したもので、最初はチェックを外してあります。判定が違っていたらチェックを入れ直してください。
          </p>
          <div className="flex flex-col rounded-xl border p-1 max-h-[28rem] overflow-y-auto" style={{ borderColor: "var(--border-subtle)" }}>
            {primary.map((c) => <Row key={c.id} c={c} checked={selected.has(c.id)} onToggle={() => onToggle(c.id)} />)}
          </div>
        </>
      )}
      <div className="flex flex-col gap-1">
        <Folded label="登録済み" items={existing} selected={selected} onToggle={onToggle} />
        <Folded label="今週以外のリリース" items={otherWeeks} selected={selected} onToggle={onToggle} />
        <Folded label={singlesLabel} items={singles} selected={selected} onToggle={onToggle} />
      </div>
      <div>
        <Button onClick={onAdd} disabled={adding || count === 0}>
          {adding ? "追加中..." : `チェックした ${count}件を Release Master に追加`}
        </Button>
      </div>
    </div>
  );
}
