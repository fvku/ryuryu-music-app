"use client";

import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";

export type Tone = "info" | "success" | "warn" | "error";

const chipTone: Record<Tone, string> = {
  info: "bg-white/10 text-slate-200",
  success: "bg-emerald-500/15 text-emerald-300",
  warn: "bg-amber-500/15 text-amber-300",
  error: "bg-rose-500/15 text-rose-300",
};

const bannerTone: Record<Tone, { border: string; background: string; text: string }> = {
  info: { border: "var(--border-subtle)", background: "rgba(255,255,255,.03)", text: "var(--text-secondary)" },
  success: { border: "rgba(16,185,129,.35)", background: "rgba(16,185,129,.08)", text: "#6ee7b7" },
  warn: { border: "rgba(245,158,11,.35)", background: "rgba(245,158,11,.08)", text: "#fcd34d" },
  error: { border: "rgba(244,63,94,.35)", background: "rgba(244,63,94,.08)", text: "#fda4af" },
};

/** 対象の状態を1語で示す小さなラベル。文章のステータスとは役割を分ける。 */
export function Chip({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${chipTone[tone]}`}>
      {children}
    </span>
  );
}

/** 直前の操作結果や警告を、深刻度が分かる形で1か所に出す。 */
export function StatusBanner({ tone = "info", children, actions }: { tone?: Tone; children: ReactNode; actions?: ReactNode }) {
  const style = bannerTone[tone];
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm"
      style={{ borderColor: style.border, backgroundColor: style.background, color: style.text }}
    >
      <span className="min-w-[14rem] flex-1">{children}</span>
      {actions && <span className="flex shrink-0 flex-wrap gap-2">{actions}</span>}
    </div>
  );
}

export function Panel({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section
      id={id}
      className={`rounded-2xl border p-4 sm:p-5 ${className}`}
      style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
    >
      {children}
    </section>
  );
}

export function PanelHeading({ title, note, chips }: { title: string; note?: string; chips?: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {chips}
      </div>
      {note && (
        <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>
          {note}
        </p>
      )}
    </div>
  );
}

export type SegmentOption<T extends string> = { value: T; label: string; dot?: Tone };

/** 画面を切り替える唯一の操作。対象ごとの未保存・編集中は小さな点で示す。 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "medium",
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange(next: T): void;
  size?: "medium" | "small";
}) {
  const padding = size === "small" ? "px-3 py-1.5 text-xs" : "px-3 py-2 text-sm";
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1 overflow-x-auto rounded-xl border p-1"
      style={{ borderColor: "var(--border-subtle)", backgroundColor: "rgba(0,0,0,.25)" }}
    >
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg font-medium transition ${padding} ${active ? "text-white" : "hover:bg-white/5"}`}
            style={{
              backgroundColor: active ? "var(--accent)" : "transparent",
              color: active ? "#ffffff" : "var(--text-secondary)",
            }}
          >
            {option.label}
            {option.dot && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: option.dot === "warn" ? "#fbbf24" : option.dot === "error" ? "#fb7185" : "#34d399" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

const buttonBase = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

export function PrimaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={`${buttonBase} bg-violet-600 font-semibold text-white hover:bg-violet-500 ${rest.className || ""}`}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={`${buttonBase} border hover:bg-white/5 ${rest.className || ""}`} style={{ borderColor: "var(--border-subtle)" }}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[11px] leading-4" style={{ color: "var(--text-secondary)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

const controlClass = "mt-1 w-full rounded-lg border bg-black/20 px-3 text-base text-white disabled:opacity-40";

export function TextInput({ ref, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} {...props} className={`${controlClass} min-h-11 ${props.className || ""}`} style={{ borderColor: "var(--border-subtle)" }} />;
}

export function TextArea({ ref, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: React.Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} {...props} className={`${controlClass} py-3 leading-6 ${props.className || ""}`} style={{ borderColor: "var(--border-subtle)" }} />;
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${controlClass} min-h-11 ${props.className || ""}`} style={{ borderColor: "var(--border-subtle)" }} />;
}

export function Checkbox({ label, ...rest }: { label: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" {...rest} className="h-4 w-4 shrink-0 accent-violet-500" />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

/** 並び順のように、その場で完結させたい操作を前面に出す。 */
export function Modal({ title, description, onClose, children }: { title: string; description?: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-black/70 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-2xl border p-5 sm:rounded-2xl"
        style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {description && (
              <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>{description}</p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="min-h-9 shrink-0 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border-subtle)" }}>
            閉じる
          </button>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** 同じ一覧を縦・横で二重に描かないための、表示中だけを知る手段。 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
