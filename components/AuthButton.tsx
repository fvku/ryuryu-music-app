"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import Image from "next/image";

export default function AuthButton() {
  const { data: session, status } = useSession();

  if (status === "loading") return null;

  if (session?.user) {
    return (
      <div className="flex items-center gap-3">
        {session.user.image && (
          <Image
            src={session.user.image}
            alt={session.user.name ?? ""}
            width={28}
            height={28}
            className="rounded-full"
          />
        )}
        <span className="text-sm hidden sm:block" style={{ color: "var(--text-secondary)" }}>
          {session.user.name}
        </span>
        <button
          onClick={() => signOut()}
          className="text-sm px-3 py-1.5 rounded-lg border transition-colors hover:border-white/20"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          ログアウト
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn("google")}
      className="text-sm px-4 py-1.5 rounded-lg font-medium transition-colors hover:opacity-90"
      style={{ backgroundColor: "var(--accent)", color: "white" }}
    >
      ログイン
    </button>
  );
}
