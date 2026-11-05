"use client";

/**
 * Spotify のプレイリストから候補を読み込んで Release Master に追加する手順の中身。
 * 邦楽（New Music Wednesday）と洋邦混在（New Music Friday Japan）で共用する。
 *
 * 対象週が変わったら親が key を変えて作り直す（前の週の候補を残さない）。
 */

import { useState } from "react";
import { titleAndExclusion } from "@/lib/weekly/waboku";
import { CandidateList, type Candidate } from "./CandidateList";
import { Button, Note } from "./parts";
import { addPicked, api, useCandidates, type Message } from "./use-candidates";

export function PlaylistImport({
  friday, mode, settingKey, playlistUrl: savedUrl, loadLabel, singlesLabel, onAdded,
}: {
  friday: string;
  mode: "japan" | "mixed";
  /** プレイリストURLを保存する settings シートのキー */
  settingKey: string;
  playlistUrl: string;
  loadLabel: string;
  singlesLabel?: string;
  onAdded: () => Promise<void> | void;
}) {
  const [override, setOverride] = useState<string | null>(null);
  const playlistUrl = override ?? savedUrl;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const list = useCandidates();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"load" | "add" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  async function load() {
    setBusy("load"); setMessage(null);
    try {
      const data = await api<{ playlistName: string; candidates: Candidate[] }>("playlist-preview", { friday, playlistUrl, mode });
      setName(data.playlistName);
      list.load(data.candidates);
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    const picked = (list.candidates ?? []).filter((c) => list.selected.has(c.id));
    if (picked.length === 0) return;
    setBusy("add"); setMessage(null);
    try {
      setMessage(await addPicked(friday, picked));
      list.reset();
      await onAdded();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const value = draft.trim();
    if (!value) return;
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: settingKey, value }),
    });
    if (res.ok) { setOverride(value); setEditing(false); list.reset(); }
    else setMessage({ tone: "error", text: "プレイリストURLを保存できませんでした" });
  }

  /** 洋邦の判定が外れていたときの切り替え。作品名（[EP]）と対象外の理由も作り直す */
  function toggleWaboku(c: Candidate) {
    const waboku = c.waboku === "洋楽" ? "邦楽" : "洋楽";
    const { title, excludeReason } = titleAndExclusion(c.albumName ?? c.title, c.type, c.baseExcludeReason ?? null, waboku);
    list.replace({ ...c, waboku, title, excludeReason, wabokuReason: "手で切り替え" });
  }

  const counts = list.candidates && mode === "mixed"
    ? list.candidates.filter((c) => list.selected.has(c.id)).reduce(
      (acc, c) => ({ ...acc, [c.waboku]: acc[c.waboku] + 1 }), { 洋楽: 0, 邦楽: 0 })
    : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={load} disabled={busy !== null}>
          {busy === "load" ? "読み込み中...（10秒ほど）" : loadLabel}
        </Button>
        <button type="button" onClick={() => { setDraft(playlistUrl); setEditing(!editing); }}
          className="text-xs underline underline-offset-2" style={{ color: "var(--text-secondary)" }}>
          読み込むプレイリストを変える
        </button>
      </div>
      {editing && (
        <div className="flex flex-wrap gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)}
            className="flex-1 min-w-0 rounded-xl border px-3 py-2 text-xs"
            style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }} />
          <Button variant="secondary" onClick={save}>保存</Button>
        </div>
      )}
      {message && <Note tone={message.tone}>{message.text}</Note>}
      {list.candidates && (
        <>
          {name && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              「{name}」から {list.candidates.length}作品を確認しました
              {counts && `（チェック中：洋楽${counts.洋楽}・邦楽${counts.邦楽}）`}
            </p>
          )}
          <CandidateList
            candidates={list.candidates}
            selected={list.selected}
            onToggle={list.toggle}
            onToggleWaboku={mode === "mixed" ? toggleWaboku : undefined}
            onAdd={add}
            adding={busy === "add"}
            singlesLabel={singlesLabel}
          />
        </>
      )}
    </>
  );
}
