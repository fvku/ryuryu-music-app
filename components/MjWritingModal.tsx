"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ReleaseMasterAlbum } from "@/lib/types";
import { reportColumnError } from "@/components/ColumnErrorIndicator";
import { useSpotifyPlayer } from "@/hooks/useSpotifyPlayer";
import { useMjTracks } from "@/hooks/useMjTracks";
import { useInlineFieldUpdate } from "@/hooks/useInlineFieldUpdate";
import { getSpotifyToken, saveSpotifyToken, openSpotifyAuthPopup } from "@/lib/spotify-token";
import ModalHeader from "@/components/mj-writing-modal/ModalHeader";
import AlbumInfoSection from "@/components/mj-writing-modal/AlbumInfoSection";
import AssignSection from "@/components/mj-writing-modal/AssignSection";
import AssignConfirmDialog from "@/components/mj-writing-modal/AssignConfirmDialog";
import MjAdoptionDialogs from "@/components/mj-writing-modal/MjAdoptionDialogs";
import TrackSelector from "@/components/mj-writing-modal/TrackSelector";
import StartTimeSection from "@/components/mj-writing-modal/StartTimeSection";
import GenreCountryFields from "@/components/mj-writing-modal/GenreCountryFields";
import TextEditor from "@/components/mj-writing-modal/TextEditor";

interface Props {
  album: ReleaseMasterAlbum;
  coverUrl?: string;
  spotifyUrl?: string;
  onClose: () => void;
  onSaved: (updated: Partial<ReleaseMasterAlbum>) => void;
}

/**
 * M/J文章の編集モーダル（メインUI）。
 * データ取得と複数セクションが共有する状態のみここで持ち、
 * 各セクションの内部状態は components/mj-writing-modal/ の子に閉じる。
 */
export default function MjWritingModal({ album, coverUrl, spotifyUrl, onClose, onSaved }: Props) {
  const [mounted, setMounted] = useState(false);
  const [startTime, setStartTime] = useState<string>(() => album.mjStartTime?.trim() ?? "");
  const [text, setText] = useState<string>(() => album.mjText?.trim() ?? "");
  const [genreMemo, setGenreMemo] = useState<string>(() => album.genreMemo?.trim() ?? "");
  const [country, setCountry] = useState<string>(() => album.country?.trim() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // プロップ経由のURL（spotifyDataキャッシュ）を優先し、なければアルバムオブジェクトのURLを使う
  const effectiveSpotifyUrl = spotifyUrl || album.spotifyUrl;

  const { tracks, loadingTracks, trackError, selectedTrack, setSelectedTrack } = useMjTracks(effectiveSpotifyUrl, album);

  // Spotify player
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  const [connectingSpotify, setConnectingSpotify] = useState(false);
  const [seekValue, setSeekValue] = useState<number | null>(null);
  const player = useSpotifyPlayer(spotifyToken);

  const assign = useInlineFieldUpdate(album, "mjAssign", album.mjAssign?.trim() ?? "", onSaved);
  const mj = useInlineFieldUpdate(album, "mjAdoption", album.mjAdoption ?? "", onSaved);

  useEffect(() => {
    setMounted(true);
    setSpotifyToken(getSpotifyToken());
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.cssText = `position: fixed; top: -${scrollY}px; width: 100%; overflow-y: scroll;`;
    return () => {
      document.body.style.cssText = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/release-master/${album.no}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: album.uid,
          title: album.title,
          artist: album.artist,
          mjData: {
            trackNo: selectedTrack ? String(selectedTrack.trackNumber) : "",
            trackName: selectedTrack ? selectedTrack.name : "",
            startTime: startTime.trim(),
            mjText: text.trim(),
          },
          albumMeta: {
            genreMemo: genreMemo.trim(),
            country: country.trim(),
          },
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        if (errData.errorCode === "COLUMN_NOT_FOUND") reportColumnError(errData.missing ?? []);
        throw new Error(errData.error || "保存に失敗しました");
      }
      onSaved({
        mjTrackNo:   selectedTrack ? String(selectedTrack.trackNumber) : "",
        mjTrack:     selectedTrack ? selectedTrack.name : "",
        mjStartTime: startTime.trim(),
        mjText:      text.trim(),
        genreMemo:   genreMemo.trim(),
        country:     country.trim(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSaving(false);
    }
  }

  const isValid = text.trim().length > 0 || selectedTrack !== null;

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
        style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)" }}
      >
        <ModalHeader hasText={text.length > 0} onClose={onClose} />

        <div className="px-5 py-5 flex flex-col gap-6">
          <AlbumInfoSection
            album={album}
            coverUrl={coverUrl}
            effectiveSpotifyUrl={effectiveSpotifyUrl}
            currentMjAdoption={mj.current}
            onToggleMjPicker={() => mj.setPicker((v) => !v)}
          />

          <AssignSection
            currentAssign={assign.current}
            picker={assign.picker}
            onTogglePicker={() => assign.setPicker((v) => !v)}
            onClosePicker={() => assign.setPicker(false)}
            onSelect={(v) => { assign.setPending(v); assign.setPicker(false); }}
          />

          <TrackSelector
            effectiveSpotifyUrl={effectiveSpotifyUrl}
            tracks={tracks}
            loadingTracks={loadingTracks}
            trackError={trackError}
            selectedTrack={selectedTrack}
            onSelectTrack={setSelectedTrack}
            isPlayerReady={player.isReady}
            onPlayTrack={player.playTrack}
          />

          {selectedTrack && (
            <StartTimeSection
              selectedTrack={selectedTrack}
              startTime={startTime}
              onStartTimeChange={setStartTime}
              spotifyToken={spotifyToken}
              connectingSpotify={connectingSpotify}
              onConnect={() => {
                setConnectingSpotify(true);
                openSpotifyAuthPopup(
                  (token, expiresIn) => {
                    saveSpotifyToken(token, expiresIn);
                    setSpotifyToken(token);
                    setConnectingSpotify(false);
                  },
                  () => setConnectingSpotify(false)
                );
              }}
              player={player}
              seekValue={seekValue}
              onSeekChange={setSeekValue}
              onSeekCommit={(ms) => {
                player.commitSeek(ms);
                setSeekValue(null);
              }}
            />
          )}

          <GenreCountryFields
            genreMemo={genreMemo}
            onGenreMemoChange={setGenreMemo}
            country={country}
            onCountryChange={setCountry}
          />

          <TextEditor text={text} onTextChange={setText} />

          {error && <p className="text-xs px-1" style={{ color: "#ef4444" }}>{error}</p>}

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isValid}
            className="w-full py-3.5 rounded-2xl font-bold text-sm transition-opacity disabled:opacity-40"
            style={{ backgroundColor: "var(--accent)", color: "white" }}
          >
            {saving ? "保存中..." : "保存する"}
          </button>
        </div>
      </div>

      <MjAdoptionDialogs
        currentMjAdoption={mj.current}
        picker={mj.picker}
        pending={mj.pending}
        updating={mj.updating}
        onClosePicker={() => mj.setPicker(false)}
        onSelect={(v) => { mj.setPending(v); mj.setPicker(false); }}
        onCancelPending={() => mj.setPending(null)}
        onConfirm={mj.confirm}
      />

      <AssignConfirmDialog
        currentAssign={assign.current}
        pending={assign.pending}
        updating={assign.updating}
        onCancel={() => assign.setPending(null)}
        onConfirm={assign.confirm}
      />
    </div>,
    document.body
  );
}
