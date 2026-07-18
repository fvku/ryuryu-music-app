"use client";

import { useSession, signOut } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getSpotifyToken, saveSpotifyToken, clearSpotifyToken, openSpotifyAuthPopup } from "@/lib/spotify-token";

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [spotifyToken, setSpotifyToken] = useState<string | null>(() => getSpotifyToken());
  const [connectingSpotify, setConnectingSpotify] = useState(false);
  const [spotifyError, setSpotifyError] = useState("");

  if (status === "loading") return null;
  if (!session) {
    router.replace("/login");
    return null;
  }

  function handleConnectSpotify() {
    setConnectingSpotify(true);
    setSpotifyError("");
    openSpotifyAuthPopup(
      (token, expiresIn) => {
        saveSpotifyToken(token, expiresIn);
        setSpotifyToken(token);
        setConnectingSpotify(false);
      },
      (err) => {
        setSpotifyError(err === "cancelled" ? "キャンセルされました" : "接続に失敗しました");
        setConnectingSpotify(false);
      }
    );
  }

  function handleDisconnectSpotify() {
    clearSpotifyToken();
    setSpotifyToken(null);
  }

  return (
    <div className="min-h-screen p-5" style={{ backgroundColor: "var(--bg-primary)" }}>
      <div className="max-w-md mx-auto">

        {/* ヘッダー */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/8 transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="font-bold text-base" style={{ color: "var(--text-primary)" }}>設定</h1>
        </div>

        <div className="flex flex-col gap-4">

          {/* Google アカウント */}
          <div className="rounded-2xl border p-5" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
            <h2 className="text-xs font-bold mb-4" style={{ color: "var(--text-secondary)" }}>GOOGLE アカウント</h2>
            <div className="flex items-center gap-3 mb-4">
              {session.user?.image && (
                <Image
                  src={session.user.image}
                  alt={session.user.name ?? ""}
                  width={40}
                  height={40}
                  className="rounded-full flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>
                  {session.user?.name}
                </p>
                <p className="text-xs truncate mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  {session.user?.email}
                </p>
              </div>
              <span className="text-xs px-2 py-1 rounded-full flex-shrink-0"
                style={{ backgroundColor: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
                接続済み
              </span>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              ログアウト
            </button>
          </div>

          {/* Spotify */}
          <div className="rounded-2xl border p-5" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
            <h2 className="text-xs font-bold mb-4" style={{ color: "var(--text-secondary)" }}>SPOTIFY</h2>

            {spotifyToken ? (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: "rgba(29,185,84,0.15)" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#1DB954">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>Spotify</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      M/J作業での曲の再生に使用中
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full flex-shrink-0"
                    style={{ backgroundColor: "rgba(29,185,84,0.12)", color: "#1DB954" }}>
                    接続済み
                  </span>
                </div>
                <button
                  onClick={handleDisconnectSpotify}
                  className="w-full py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70"
                  style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                >
                  接続を解除する
                </button>
              </>
            ) : (
              <>
                <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
                  M/J作業で曲を聴きながら再生開始位置を設定できます。Spotify Premium が必要です。
                </p>
                {spotifyError && (
                  <p className="text-xs mb-3" style={{ color: "#ef4444" }}>{spotifyError}</p>
                )}
                <button
                  onClick={handleConnectSpotify}
                  disabled={connectingSpotify}
                  className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-opacity disabled:opacity-60 hover:opacity-90"
                  style={{ backgroundColor: "#1DB954", color: "white" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                  </svg>
                  {connectingSpotify ? "接続中..." : "Spotifyで接続する"}
                </button>
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
