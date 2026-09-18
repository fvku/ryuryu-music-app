"use client";

interface SegmentTabsProps<K extends string> {
  options: { key: K; label: string; count?: number; dot?: boolean }[];
  value: K;
  onChange: (key: K) => void;
}

/** タブ内の全幅切替（LISTEN の SAVED/RECOMMEND、M/J 文章の MONTHLY/JAPAN） */
export default function SegmentTabs<K extends string>({ options, value, onChange }: SegmentTabsProps<K>) {
  return (
    <div className="flex rounded-xl overflow-hidden mb-4 border" style={{ borderColor: "var(--border-subtle)" }}>
      {options.map(({ key, label, count, dot }) => {
        const active = value === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className="flex-1 py-2.5 text-xs font-bold tracking-wide transition-colors"
            style={{
              backgroundColor: active ? "var(--accent)" : "var(--bg-card)",
              color: active ? "white" : "var(--text-secondary)",
            }}
          >
            <span className="relative inline-flex items-center gap-1">
              {label}
              {dot && <span className="absolute -top-1 -right-2 w-1.5 h-1.5 rounded-full bg-red-500" />}
              {!!count && (
                <span className="text-xs px-1.5 rounded-full" style={{ backgroundColor: active ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)" }}>
                  {count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
