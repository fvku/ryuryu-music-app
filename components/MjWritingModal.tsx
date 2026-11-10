"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ReleaseMasterAlbum } from "@/lib/types";
import { reportColumnError } from "@/components/ColumnErrorIndicator";
import { useSpotifyPlayer } from "@/hooks/useSpotifyPlayer";
import { SpotifyTrack, useMjTracks } from "@/hooks/useMjTracks";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { changedMjFields, MJ_FIELD_LABEL, MjConflict, MjValues } from "@/lib/mj-concurrency";
import { clearDraft, draftKey, loadDraft, saveDraft } from "@/lib/drafts";
import { notifyDataChanged } from "@/lib/data-events";
import { useInlineFieldUpdate } from "@/hooks/useInlineFieldUpdate";
import { getSpotifyToken, saveSpotifyToken, openSpotifyAuthPopup, spotifyAuthErrorMessage } from "@/lib/spotify-token";
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
type TrackChoice = SpotifyTrack | null;

interface MjDraft {
  startTime: string;
  text: string;
  genreMemo: string;
  country: string;
  /** 選び直したときだけ入る。undefined は「曲は触っていない」 */
  track?: TrackChoice;
}

function baseFromAlbum(album: ReleaseMasterAlbum): MjValues {
  return {
    mjTrackNo: album.mjTrackNo?.trim() ?? "",
    mjTrack: album.mjTrack?.trim() ?? "",
    mjStartTime: album.mjStartTime?.trim() ?? "",
    mjText: album.mjText?.trim() ?? "",
    genreMemo: album.genreMemo?.trim() ?? "",
    country: album.country?.trim() ?? "",
  };
}

export default function MjWritingModal({ album, coverUrl, spotifyUrl, onClose, onSaved }: Props) {
  // 開いた時点（または最後に保存・取り込みした時点）のシートの値。差分と競合の判定の基準
  const [base, setBase] = useState<MjValues>(() => baseFromAlbum(album));
  const [startTime, setStartTime] = useState<string>(() => album.mjStartTime?.trim() ?? "");
  const [text, setText] = useState<string>(() => album.mjText?.trim() ?? "");
  const [genreMemo, setGenreMemo] = useState<string>(() => album.genreMemo?.trim() ?? "");
  const [country, setCountry] = useState<string>(() => album.country?.trim() ?? "");
  // 利用者が曲を選び直した（または外した）ときだけ true。曲一覧の取得失敗で保存済みの曲を消さないため
  const [trackTouched, setTrackTouched] = useState(false);
  const [chosenTrack, setChosenTrack] = useState<TrackChoice>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<MjConflict[] | null>(null);

  const draftStorageKey = draftKey("mj", album);
  const [draftOffer, setDraftOffer] = useState<MjDraft | null>(() => {
    const d = loadDraft<MjDraft>(draftStorageKey);
    if (!d) return null;
    const b = baseFromAlbum(album);
    const differs = d.value.text.trim() !== b.mjText || d.value.startTime.trim() !== b.mjStartTime
      || d.value.genreMemo.trim() !== b.genreMemo || d.value.country.trim() !== b.country || d.value.track !== undefined;
    return differs ? d.value : null;
  });

  // プロップ経由のURL（spotifyDataキャッシュ）を優先し、なければアルバムオブジェクトのURLを使う
  const effectiveSpotifyUrl = spotifyUrl || album.spotifyUrl;

  const { tracks, loadingTracks, trackError, initialTrack } = useMjTracks(effectiveSpotifyUrl, base.mjTrackNo ?? "", base.mjTrack ?? "");
  const selectedTrack = trackTouched ? chosenTrack : initialTrack;
  const savedTrackLabel = !trackTouched && !initialTrack && base.mjTrack
    ? `${base.mjTrackNo ? `#${base.mjTrackNo} ` : ""}${base.mjTrack}`
    : null;

  const next: MjValues = {
    mjStartTime: startTime,
    mjText: text,
    genreMemo,
    country,
    ...(trackTouched
      ? { mjTrackNo: chosenTrack ? String(chosenTrack.trackNumber) : "", mjTrack: chosenTrack ? chosenTrack.name : "" }
      : {}),
  };
  const changes = changedMjFields(base, next);
  const dirty = Object.keys(changes).length > 0;
  const guardedClose = useUnsavedGuard(dirty, onClose);

  // 書きかけをこの端末に退避する（保存に成功したら消す）
  useEffect(() => {
    if (!dirty) {
      // 元の内容に戻した場合は古い書きかけを残さない（復元の提案中は消さない）
      if (!draftOffer) clearDraft(draftStorageKey);
      return;
    }
    const timer = setTimeout(() => {
      saveDraft<MjDraft>(draftStorageKey, {
        startTime, text, genreMemo, country,
        ...(trackTouched ? { track: chosenTrack } : {}),
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [dirty, draftOffer, draftStorageKey, startTime, text, genreMemo, country, trackTouched, chosenTrack]);

  // Spotify player
  const [spotifyToken, setSpotifyToken] = useState<string | null>(() => getSpotifyToken());
  const [connectingSpotify, setConnectingSpotify] = useState(false);
  const [seekValue, setSeekValue] = useState<number | null>(null);
  const player = useSpotifyPlayer(spotifyToken, {
    // トークンが失効し再取得もできなかったら接続状態に戻す（パネルが「再接続」導線を出す）
    onTokenInvalid: () => setSpotifyToken(null),
  });

  const notifySaved = (updated: Partial<ReleaseMasterAlbum>) => {
    onSaved(updated);
    notifyDataChanged({ kind: "album", albumNo: album.no, patch: updated });
  };
  const assign = useInlineFieldUpdate(album, "mjAssign", album.mjAssign?.trim() ?? "", notifySaved);
  const mj = useInlineFieldUpdate(album, "mjAdoption", album.mjAdoption ?? "", notifySaved);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") guardedClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [guardedClose]);

  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.cssText = `position: fixed; top: -${scrollY}px; width: 100%; overflow-y: scroll;`;
    return () => {
      document.body.style.cssText = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  function selectTrack(track: TrackChoice) {
    setTrackTouched(true);
    setChosenTrack(track);
  }

  function restoreDraft(d: MjDraft) {
    setStartTime(d.startTime);
    setText(d.text);
    setGenreMemo(d.genreMemo);
    setCountry(d.country);
    if (d.track !== undefined) selectTrack(d.track);
    setDraftOffer(null);
  }

  function discardDraft() {
    clearDraft(draftStorageKey);
    setDraftOffer(null);
  }

  /** 他の人の保存内容を画面へ取り込む（自分の入力はその項目だけ相手の値に置き換わる） */
  function acceptTheirs(list: MjConflict[]) {
    const theirs: MjValues = {};
    for (const c of list) theirs[c.field] = c.current;
    setBase((b) => ({ ...b, ...theirs }));
    if (theirs.mjText !== undefined) setText(theirs.mjText);
    if (theirs.mjStartTime !== undefined) setStartTime(theirs.mjStartTime);
    if (theirs.genreMemo !== undefined) setGenreMemo(theirs.genreMemo);
    if (theirs.country !== undefined) setCountry(theirs.country);
    if (theirs.mjTrack !== undefined || theirs.mjTrackNo !== undefined) {
      setTrackTouched(false);
      setChosenTrack(null);
    }
    setConflicts(null);
    setError(null);
  }

  async function handleSave(overwrite?: MjConflict[]) {
    // 上書きを選んだ場合は、相手の値を見たうえでの保存として基準を相手の値へ進める
    const effectiveBase: MjValues = { ...base };
    for (const c of overwrite ?? []) effectiveBase[c.field] = c.current;
    const toSend = changedMjFields(effectiveBase, next);
    if (Object.keys(toSend).length === 0) {
      setBase(effectiveBase);
      setConflicts(null);
      clearDraft(draftStorageKey);
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const mjData: Record<string, string> = {};
      if (toSend.mjTrackNo !== undefined) mjData.trackNo = toSend.mjTrackNo;
      if (toSend.mjTrack !== undefined) mjData.trackName = toSend.mjTrack;
      if (toSend.mjStartTime !== undefined) mjData.startTime = toSend.mjStartTime;
      if (toSend.mjText !== undefined) mjData.mjText = toSend.mjText;
      const albumMeta: Record<string, string> = {};
      if (toSend.genreMemo !== undefined) albumMeta.genreMemo = toSend.genreMemo;
      if (toSend.country !== undefined) albumMeta.country = toSend.country;
      const sentBase: MjValues = {};
      for (const f of Object.keys(toSend) as (keyof MjValues)[]) sentBase[f] = effectiveBase[f] ?? "";

      const res = await fetch(`/api/release-master/${album.no}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: album.uid,
          title: album.title,
          artist: album.artist,
          base: sentBase,
          ...(Object.keys(mjData).length > 0 ? { mjData } : {}),
          ...(Object.keys(albumMeta).length > 0 ? { albumMeta } : {}),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 409 && Array.isArray(errData.conflicts)) {
          setBase(effectiveBase);
          setConflicts(errData.conflicts as MjConflict[]);
          return;
        }
        if (errData.errorCode === "COLUMN_NOT_FOUND") reportColumnError(errData.missing ?? []);
        throw new Error(errData.error || "保存に失敗しました");
      }
      const patch: Partial<ReleaseMasterAlbum> = {};
      if (toSend.mjTrackNo !== undefined) patch.mjTrackNo = toSend.mjTrackNo;
      if (toSend.mjTrack !== undefined) patch.mjTrack = toSend.mjTrack;
      if (toSend.mjStartTime !== undefined) patch.mjStartTime = toSend.mjStartTime;
      if (toSend.mjText !== undefined) patch.mjText = toSend.mjText;
      if (toSend.genreMemo !== undefined) patch.genreMemo = toSend.genreMemo;
      if (toSend.country !== undefined) patch.country = toSend.country;
      setBase({ ...effectiveBase, ...toSend });
      setConflicts(null);
      clearDraft(draftStorageKey);
      notifySaved(patch);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) guardedClose(); }}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
        style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)" }}
      >
        <ModalHeader hasText={text.length > 0} onClose={guardedClose} />

        <div className="px-5 py-5 flex flex-col gap-6">
          {draftOffer && (
            <div role="status" className="rounded-xl p-3 border flex flex-col gap-2" style={{ backgroundColor: "rgba(139,92,246,0.1)", borderColor: "rgba(139,92,246,0.35)" }}>
              <p className="text-xs" style={{ color: "var(--text-primary)" }}>この端末に保存していない書きかけがあります。</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => restoreDraft(draftOffer)} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ backgroundColor: "var(--accent)", color: "white" }}>書きかけを戻す</button>
                <button type="button" onClick={discardDraft} className="px-3 py-1.5 rounded-lg text-xs border" style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>破棄する</button>
              </div>
            </div>
          )}
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
            savedTrackLabel={savedTrackLabel}
            onSelectTrack={(track) => {
              selectTrack(track);
              // 再生中に別トラックへ切り替え／選択解除したら前の曲を止める
              // （自動再生はしない。再生ボタンで新トラックを頭から再生できる状態にする）
              if (player.isReady && !player.isPaused && track?.uri !== player.currentUri) {
                player.pause();
              }
            }}
          />

          {selectedTrack && (
            <StartTimeSection
              selectedTrack={selectedTrack}
              startTime={startTime}
              onStartTimeChange={setStartTime}
              spotifyToken={spotifyToken}
              connectingSpotify={connectingSpotify}
              onConnect={() => {
                setError(null);
                setConnectingSpotify(true);
                openSpotifyAuthPopup(
                  (token, expiresIn) => {
                    saveSpotifyToken(token, expiresIn);
                    setSpotifyToken(token);
                    setConnectingSpotify(false);
                  },
                  (error) => { setConnectingSpotify(false); setError(spotifyAuthErrorMessage(error)); }
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

          {conflicts && (
            <div role="alert" className="rounded-xl p-3 border flex flex-col gap-2" style={{ backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.4)" }}>
              <p className="text-xs font-bold" style={{ color: "#fca5a5" }}>開いている間に、他の人が同じ項目を保存しました。まだ保存していません。</p>
              {conflicts.map((c) => (
                <div key={c.field} className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  <span className="font-bold" style={{ color: "var(--text-primary)" }}>{MJ_FIELD_LABEL[c.field]}</span>
                  <span>（相手の内容）</span>
                  <p className="mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto rounded-lg px-2 py-1.5" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>{c.current || "（空欄）"}</p>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => acceptTheirs(conflicts)} className="px-3 py-1.5 rounded-lg text-xs font-bold border" style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}>相手の内容を取り込む</button>
                <button type="button" disabled={saving} onClick={() => handleSave(conflicts)} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40" style={{ backgroundColor: "#ef4444", color: "white" }}>自分の内容で上書きする</button>
              </div>
            </div>
          )}

          {error && <p role="alert" className="text-xs px-1" style={{ color: "#ef4444" }}>{error}</p>}

          {/* Save */}
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={saving || !dirty || conflicts !== null}
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
