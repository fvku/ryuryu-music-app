"use client";

/** 週次作業ページの見た目の部品 */

export const ACCENT = "#60a5fa";
export const OK = "#4ade80";
export const WARN = "#fbbf24";
export const DANGER = "#f87171";

export function StepCard({
  no, title, when, done, children, why,
}: {
  no: number;
  title: string;
  /** いつやるか */
  when: string;
  /** 完了していれば true。進み具合の文言を渡してもよい */
  done?: boolean | string;
  why?: React.ReactNode;
  children: React.ReactNode;
}) {
  const complete = done === true;
  return (
    <section
      className="rounded-2xl p-5 border"
      style={{ backgroundColor: "var(--bg-card)", borderColor: complete ? "rgba(74,222,128,0.35)" : "rgba(59,130,246,0.35)" }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ backgroundColor: complete ? "rgba(74,222,128,0.15)" : "rgba(96,165,250,0.15)", color: complete ? OK : ACCENT }}
        >
          {complete ? "✓" : no}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-bold text-base" style={{ color: "var(--text-primary)" }}>{title}</h2>
            {typeof done === "string" && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{done}</span>}
          </div>
          <p className="text-xs mt-1" style={{ color: ACCENT }}>いつ：{when}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 text-sm" style={{ color: "var(--text-primary)" }}>{children}</div>
      {why && (
        <details className="mt-4 text-xs" style={{ color: "var(--text-secondary)" }}>
          <summary className="cursor-pointer select-none">この手順の詳細</summary>
          <div className="mt-2 flex flex-col gap-1.5 leading-relaxed">{why}</div>
        </details>
      )}
    </section>
  );
}

export function Button({
  children, onClick, disabled, variant = "primary", type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  type?: "button" | "submit";
}) {
  const primary = variant === "primary";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 rounded-xl text-sm font-semibold border disabled:opacity-40 transition-opacity"
      style={{
        backgroundColor: primary ? "rgba(96,165,250,0.15)" : "transparent",
        borderColor: primary ? ACCENT : "var(--border-subtle)",
        color: primary ? ACCENT : "var(--text-secondary)",
      }}
    >
      {children}
    </button>
  );
}

export function Badge({ children, color = "var(--text-secondary)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="inline-block text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap" style={{ color, borderColor: color }}>
      {children}
    </span>
  );
}

export function Note({ tone = "info", children }: { tone?: "info" | "ok" | "warn" | "error"; children: React.ReactNode }) {
  const color = { info: "var(--text-secondary)", ok: OK, warn: WARN, error: DANGER }[tone];
  const bg = { info: "rgba(255,255,255,0.04)", ok: "rgba(74,222,128,0.08)", warn: "rgba(251,191,36,0.08)", error: "rgba(248,113,113,0.08)" }[tone];
  return (
    <div className="rounded-xl px-3 py-2 text-xs leading-relaxed" style={{ color, backgroundColor: bg }}>
      {children}
    </div>
  );
}

/** 1234567 → "1.2M" */
export function formatListeners(value: string): string {
  const n = Number((value ?? "").replace(/,/g, ""));
  if (!value || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
