"use client";

import Image from "next/image";
import Link from "next/link";
import type { Session } from "next-auth";

interface ProfileHeaderProps {
  session: Session;
}

/** マイページ上部のプロフィールカード（アイコン・名前・メール・設定リンク） */
export default function ProfileHeader({ session }: ProfileHeaderProps) {
  return (
    <div className="rounded-xl px-4 py-3 border mb-5 flex items-center gap-3" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
      {session.user?.image && (
        <Image src={session.user.image} alt={session.user.name ?? ""} width={36} height={36} className="rounded-full flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{session.user?.name}</p>
        <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{session.user?.email}</p>
      </div>
      <Link
        href="/settings"
        className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/8 transition-colors flex-shrink-0"
        style={{ color: "var(--text-secondary)" }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </Link>
    </div>
  );
}
