"use client";

interface GenreCountryFieldsProps {
  genreMemo: string;
  onGenreMemoChange: (value: string) => void;
  country: string;
  onCountryChange: (value: string) => void;
}

/** ジャンル/メモ（K列）・国（L列）の編集 */
export default function GenreCountryFields({ genreMemo, onGenreMemoChange, country, onCountryChange }: GenreCountryFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-xs font-bold mb-2" style={{ color: "var(--text-primary)" }}>ジャンル / メモ（K列）</h3>
        <input
          type="text"
          value={genreMemo}
          onChange={(e) => onGenreMemoChange(e.target.value)}
          placeholder="例: indie rock, jazz, city pop..."
          className="w-full px-3 py-2 rounded-xl border text-sm focus:outline-none focus:border-violet-500/50"
          style={{
            backgroundColor: "#0d0d14",
            borderColor: genreMemo ? "rgba(139,92,246,0.4)" : "var(--border-subtle)",
            color: "var(--text-primary)",
          }}
        />
      </div>
      <div>
        <h3 className="text-xs font-bold mb-2" style={{ color: "var(--text-primary)" }}>国（L列）</h3>
        <input
          type="text"
          value={country}
          onChange={(e) => onCountryChange(e.target.value)}
          placeholder="例: Japan, United States, UK..."
          className="w-full px-3 py-2 rounded-xl border text-sm focus:outline-none focus:border-violet-500/50"
          style={{
            backgroundColor: "#0d0d14",
            borderColor: country ? "rgba(139,92,246,0.4)" : "var(--border-subtle)",
            color: "var(--text-primary)",
          }}
        />
      </div>
    </div>
  );
}
