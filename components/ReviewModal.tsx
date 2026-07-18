"use client";

import { useSession } from "next-auth/react";
import { ReleaseMasterAlbum } from "@/lib/types";
import { EMAIL_TO_SHORT_NAME } from "@/lib/members";
import { getCombinedScore, toMemberScores, filterMismatchedScores } from "@/lib/score-utils";
import { useAlbumScores } from "@/hooks/useAlbumScores";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import { useBookmark } from "@/hooks/useBookmark";
import { useMjAdoption } from "@/hooks/useMjAdoption";
import ModalHeader from "@/components/review-modal/ModalHeader";
import AlbumInfoSection from "@/components/review-modal/AlbumInfoSection";
import ScoresSection from "@/components/review-modal/ScoresSection";
import RecommendSection from "@/components/review-modal/RecommendSection";
import RecommendationList from "@/components/review-modal/RecommendationList";
import ReviewForm from "@/components/review-modal/ReviewForm";
import MjAdoptionDialogs from "@/components/review-modal/MjAdoptionDialogs";

interface ReviewModalProps {
  album: ReleaseMasterAlbum;
  coverUrl?: string;
  spotifyUrl?: string;
  onClose: () => void;
}

/**
 * アルバムクリック時のレビューモーダル（メインUI）。
 * データ取得と複数セクションが共有する状態のみここで持ち、
 * 各セクションの内部状態は components/review-modal/ の子に閉じる。
 */
export default function ReviewModal({ album, coverUrl, spotifyUrl, onClose }: ReviewModalProps) {
  const { data: session, status } = useSession();
  const { scores, loadingScores, refetchScores } = useAlbumScores(album);
  const { dragY, isDragging, headerTouchHandlers } = useModalDismiss(onClose);
  const { bookmarked, bookmarkLoading, toggleBookmark } = useBookmark(album, status);
  const mj = useMjAdoption(album);

  const myEmail = session?.user?.email?.toLowerCase() ?? null;
  const myShortName = myEmail ? (EMAIL_TO_SHORT_NAME[myEmail] ?? session?.user?.name ?? null) : null;
  // emailが正規識別子。旧エントリ(短縮名)も照合
  const myScore = myEmail
    ? scores.find((s) => {
        const n = s.memberName.toLowerCase();
        return n === myEmail || (myShortName ? n === myShortName.toLowerCase() : false);
      })
    : undefined;
  const alreadyReviewed = !!myScore;

  // legacyScoresとscoresの値が食い違う場合はscoresを非表示にする
  // (列追加前後で誤って取り込まれたデータを除外)
  const validScores = filterMismatchedScores(album, scores);

  // 統合平均: Release Masterスコア優先。同一メンバーは Release Master を使う。
  // 不一致ガード適用後の validScores のみを渡す
  const { avg: combinedAverage, count: combinedCount } = getCombinedScore(album, toMemberScores(validScores));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
        style={{
          backgroundColor: "var(--bg-primary)",
          border: "1px solid var(--border-subtle)",
          transform: `translateY(${dragY}px)`,
          transition: isDragging ? "none" : "transform 0.3s ease",
        }}
      >
        <ModalHeader
          album={album}
          status={status}
          bookmarked={bookmarked}
          bookmarkLoading={bookmarkLoading}
          onToggleBookmark={toggleBookmark}
          onClose={onClose}
          touchHandlers={headerTouchHandlers}
        />

        <div className="p-5 flex flex-col gap-5">
          <AlbumInfoSection
            album={album}
            coverUrl={coverUrl}
            spotifyUrl={spotifyUrl}
            status={status}
            mjAdoption={mj.mjAdoption}
            onToggleMjPicker={() => mj.setMjPicker((v) => !v)}
          />

          <ScoresSection
            album={album}
            validScores={validScores}
            loadingScores={loadingScores}
            combinedAverage={combinedAverage}
            combinedCount={combinedCount}
          />

          {status === "authenticated" && (
            <RecommendSection album={album} coverUrl={coverUrl} myEmail={myEmail} />
          )}

          <RecommendationList album={album} />

          <ReviewForm
            album={album}
            status={status}
            myScore={myScore}
            alreadyReviewed={alreadyReviewed}
            myShortName={myShortName}
            sessionUserName={session?.user?.name}
            onScoresChanged={refetchScores}
          />
        </div>
      </div>

      <MjAdoptionDialogs
        mjAdoption={mj.mjAdoption}
        mjPicker={mj.mjPicker}
        mjPending={mj.mjPending}
        mjUpdating={mj.mjUpdating}
        onClosePicker={() => mj.setMjPicker(false)}
        onSelect={(v) => { mj.setMjPending(v); mj.setMjPicker(false); }}
        onCancelPending={() => mj.setMjPending(null)}
        onConfirm={mj.confirmMjUpdate}
      />
    </div>
  );
}
