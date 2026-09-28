"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Session } from "next-auth";
import { getMemberShortName } from "@/lib/members";

interface ProfileHeaderProps {
  session: Session;
}

/** 投稿作業のメニュー。以前はフッターに置いていた入口をここへ集めた */
const WORK_LINKS = [
  { href: "/weekly", label: "Weekly作業", description: "金曜19時投稿の準備（取り込み・更新・振り分け）" },
  { href: "/generator", label: "投稿画像ジェネレーター", description: "Weekly・Monthly・Japanの投稿画像をつくる" },
];

const CARD = "rounded-xl px-3 py-3 border flex items-center gap-2.5 min-w-0";

/**
 * マイページ上部のカード2枚。
 * 左：投稿作業（タップで Weekly作業・画像ジェネレーター等の入口が開く）
 * 右：プロフィール（アイコン・メンバー名・設定リンク）
 */
export default function ProfileHeader({ session }: ProfileHeaderProps) {
  const [open, setOpen] = useState(false);
  const email = session.user?.email ?? "";
  const name = getMemberShortName(email) ?? session.user?.name ?? "";

  return (
    <div className="mb-5">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className={`${CARD} text-left transition-colors hover:bg-white/5`}
          style={{ backgroundColor: "var(--bg-card)", borderColor: open ? "var(--border-accent)" : "var(--border-subtle)" }}
        >
          <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(139,92,246,0.15)", color: "var(--accent)" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>投稿作業</span>
            <span className="hidden sm:block text-xs truncate" style={{ color: "var(--text-secondary)" }}>Weekly・画像づくり</span>
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            className="flex-shrink-0 transition-transform" style={{ color: "var(--text-secondary)", transform: open ? "rotate(180deg)" : "none" }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        <div className={CARD} style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          {session.user?.image && (
            <Image src={session.user.image} alt={name} width={36} height={36} className="rounded-full flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{name}</p>
            {/* スマホでは幅が足りずメールアドレスが途切れるので、名前だけにする */}
            <p className="hidden sm:block text-xs truncate" style={{ color: "var(--text-secondary)" }}>{email}</p>
          </div>
          <Link
            href="/settings"
            aria-label="設定"
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/8 transition-colors flex-shrink-0"
            style={{ color: "var(--text-secondary)" }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
        </div>
      </div>

      {open && (
        <nav className="mt-2 rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-accent)" }}>
          {WORK_LINKS.map((item) => (
            <Link key={item.href} href={item.href}
              className="flex items-center gap-3 px-4 py-3 border-b hover:bg-white/5 transition-colors"
              style={{ borderColor: "var(--border-subtle)" }}>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{item.label}</span>
                <span className="block text-xs truncate" style={{ color: "var(--text-secondary)" }}>{item.description}</span>
              </span>
              <span style={{ color: "var(--text-secondary)" }}>›</span>
            </Link>
          ))}
          <Link href="/admin" className="block px-4 py-2 text-xs hover:bg-white/5 transition-colors" style={{ color: "var(--text-secondary)" }}>
            管理者ページ（保守・トラブル時）›
          </Link>
        </nav>
      )}
    </div>
  );
}
