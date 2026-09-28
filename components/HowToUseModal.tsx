"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { HowToUseBlock, HowToUseSection } from "@/lib/how-to-use";

/** 本文（見出し・段落・箇条書き）は content/how-to-use.md がマスター。ここは表示だけを担当する。 */
export default function HowToUseModal({ sections }: { sections: HowToUseSection[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors hover:opacity-80"
        style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
      >
        使い方
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
            style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)" }}
          >
            {/* Header */}
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b"
              style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}
            >
              <div className="w-10 h-10" />
              <div className="absolute left-1/2 -translate-x-1/2 top-2 w-10 h-1 rounded-full sm:hidden" style={{ backgroundColor: "var(--border-subtle)" }} />
              <h2 className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>使い方</h2>
              <button
                onClick={() => setOpen(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 text-lg font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-6 flex flex-col gap-7">
              {sections.map((section) => (
                <Section key={section.title} title={section.title}>
                  {section.blocks.map((block, i) => <Block key={i} block={block} />)}
                </Section>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function Block({ block }: { block: HowToUseBlock }) {
  if (block.type === "paragraph") return <p>{block.text}</p>;
  return <Items items={block.items} />;
}

function Items({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map(([label, desc]) => (
        <div key={label}>
          <span className="font-bold" style={{ color: "var(--text-primary)" }}>{label}</span>
          <span> — {desc}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-bold text-sm mb-2.5 pb-1.5 border-b" style={{ color: "var(--text-primary)", borderColor: "var(--border-subtle)" }}>{title}</h3>
      <div className="flex flex-col gap-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {children}
      </div>
    </div>
  );
}
