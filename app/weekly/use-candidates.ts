"use client";

/** 週次作業ページの候補一覧の状態と API 呼び出し */

import { useState } from "react";
import { isDefaultSelected, type Candidate } from "./CandidateList";

export async function api<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/admin/weekly", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `エラーが発生しました (${res.status})`);
  return data as T;
}

export function toRelease(c: Candidate) {
  return {
    date: c.date, title: c.title, artist: c.artist, waboku: c.waboku,
    spotifyUrl: c.spotifyUrl, coverUrl: c.coverUrl, trackCount: c.trackCount, totalDurationMs: c.totalDurationMs,
  };
}

export type Message = { tone: "ok" | "warn" | "error"; text: string };

/** 選んだ候補を追加し、結果の文言を返す */
export async function addPicked(friday: string, picked: Candidate[]): Promise<Message> {
  const result = await api<{ added: { rowNum: number }[]; skipped: { title: string; existingRow: number }[] }>(
    "add", { friday, releases: picked.map(toRelease) },
  );
  const skippedText = result.skipped.length > 0 ? `（${result.skipped.length}件は他の人が先に追加していたので飛ばしました）` : "";
  return { tone: "ok", text: `${result.added.length}件を追加しました${skippedText}。` };
}

export function useCandidates() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const load = (list: Candidate[]) => {
    setCandidates(list);
    setSelected(new Set(list.filter(isDefaultSelected).map((c) => c.id)));
  };
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  /** 候補の中身を差し替え、チェックは差し替え後の既定（対象外ならオフ）に合わせる */
  const replace = (next: Candidate) => {
    setCandidates((prev) => prev?.map((c) => (c.id === next.id ? next : c)) ?? prev);
    setSelected((prev) => {
      const s = new Set(prev);
      if (isDefaultSelected(next)) s.add(next.id); else s.delete(next.id);
      return s;
    });
  };
  return { candidates, selected, load, toggle, replace, reset: () => { setCandidates(null); setSelected(new Set()); } };
}
