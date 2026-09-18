"use client";

interface MonthSelectProps {
  /** "YYYY/MM" の一覧（「すべて」は自動で先頭に付く） */
  months: string[];
  value: string;
  onChange: (m: string) => void;
}

/** マイページ共通の月プルダウン */
export default function MonthSelect({ months, value, onChange }: MonthSelectProps) {
  const active = value !== "すべて";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1 rounded-xl border text-xs font-medium focus:outline-none flex-shrink-0"
      style={{ backgroundColor: "var(--bg-card)", borderColor: active ? "var(--accent)" : "var(--border-subtle)", color: active ? "white" : "var(--text-secondary)" }}
    >
      {["すべて", ...months].map((m) => (
        <option key={m} value={m}>{m === "すべて" ? "すべて" : `${m.split("/")[0]}年${parseInt(m.split("/")[1])}月`}</option>
      ))}
    </select>
  );
}

/** アルバムの date から "YYYY/MM" を重複なし・新しい順で取り出す */
export function monthsOf(dates: (string | undefined)[]): string[] {
  return Array.from(new Set(dates.map((d) => d?.substring(0, 7)).filter((m): m is string => !!m))).sort().reverse();
}
