import { randomUUID } from "node:crypto";
import type { ReleaseMasterAlbum } from "../types";
import { GeneratorError } from "./errors";
import { parseDocument, type GeneratorDocument, type GeneratorItem, type GeneratorPage } from "./model";
import { createGeneratorItem, selectReleaseMasterAlbums, selectWeeklyAlbums, sortAlbums, sortWeeklyOthers } from "./source";

export type ReimportGroup = Exclude<GeneratorPage["kind"], "cover">;
export type ReimportAdded = { key: string; title: string; artist: string; group: ReimportGroup };
export type ReimportRemoved = { itemId: string; title: string; artist: string; group: ReimportGroup; edited: boolean };
export type ReimportMoved = { itemId: string; title: string; artist: string; from: ReimportGroup; to: ReimportGroup };
export type ReimportDiff = {
  added: ReimportAdded[];
  removed: ReimportRemoved[];
  moved: ReimportMoved[];
  limits: { featureMax: number | null; othersMax: number | null; featureAfter: number | null; othersAfter: number | null };
};

type Selected = { album: ReleaseMasterAlbum; group: ReimportGroup; key: string };

function normalized(value: string): string { return value.trim().toLowerCase(); }
export function releaseMasterKey(album: Pick<ReleaseMasterAlbum, "uid" | "no" | "title" | "artist">): string {
  if (album.uid.trim()) return `uid:${album.uid.trim()}`;
  if (album.no.trim()) return `no:${album.no.trim()}`;
  return `name:${normalized(album.title)}::${normalized(album.artist)}`;
}
function itemNameKey(item: GeneratorItem): string { return `${normalized(item.source.fields.title)}::${normalized(item.source.fields.artist)}`; }
function edited(item: GeneratorItem, series: GeneratorDocument["series"]): boolean {
  const expected = { ...item.source.fields };
  if (series !== "weekly") expected.title = expected.title.replace(/^\s*[\[［]\s*ep\s*[\]］]\s*/i, "");
  if (series === "weekly") expected.text = "";
  return JSON.stringify(expected) !== JSON.stringify(item.content.fields);
}
function groupOf(document: GeneratorDocument): Map<string, ReimportGroup> {
  const result = new Map<string, ReimportGroup>();
  for (const page of document.pages) if (page.kind !== "cover") for (const id of page.itemIds) result.set(id, page.kind);
  return result;
}
function selection(document: GeneratorDocument, albums: ReleaseMasterAlbum[]): Selected[] {
  if (document.series === "weekly") {
    const selected = selectWeeklyAlbums(albums, document.period.start);
    if (selected.feature.length > 5 || selected.others.length > 60) throw new GeneratorError("INVALID_INPUT", 400, "WEEK列の採用は5件以下、掲載は60件以下にしてください。");
    return [...selected.feature.map(album => ({ album, group: "feature" as const })), ...selected.others.map(album => ({ album, group: "others" as const }))]
      .map(value => ({ ...value, key: releaseMasterKey(value.album) }));
  }
  const selected = selectReleaseMasterAlbums(albums, document.series, document.period.start.slice(0, 7));
  if (selected.adopted.length + selected.listed.length > 200) throw new GeneratorError("INVALID_INPUT", 400, "対象アルバムが多すぎます。");
  return [...selected.adopted.map(album => ({ album, group: "adopted" as const })), ...selected.listed.map(album => ({ album, group: "listed" as const }))]
    .map(value => ({ ...value, key: releaseMasterKey(value.album) }));
}

type SelectedIndex = ReturnType<typeof selectedIndex>;

function selectedIndex(chosen: Selected[], albums: ReleaseMasterAlbum[]) {
  const byUid = new Map<string, Selected>(), byNo = new Map<string, Selected>(), byName = new Map<string, Selected>();
  for (const value of chosen) {
    if (value.album.uid.trim() && !byUid.has(value.album.uid.trim())) byUid.set(value.album.uid.trim(), value);
    if (value.album.no.trim() && !byNo.has(value.album.no.trim())) byNo.set(value.album.no.trim(), value);
    const name = `${normalized(value.album.title)}::${normalized(value.album.artist)}`;
    if (!byName.has(name)) byName.set(name, value);
  }
  return {
    byUid,
    byNo,
    byName,
    knownUids: new Set(albums.map(album => album.uid.trim()).filter(Boolean)),
    knownNos: new Set(albums.map(album => album.no.trim()).filter(Boolean)),
    knownNames: new Set(albums.map(album => `${normalized(album.title)}::${normalized(album.artist)}`)),
  };
}

function matchCandidate(item: GeneratorItem, index: SelectedIndex): { value: Selected; priority: number } | null {
  const uid = item.source.uid?.trim();
  if (uid) {
    const matched = index.byUid.get(uid);
    if (matched) return { value: matched, priority: 0 };
    // The original UID still exists in Release Master, so the row is simply no
    // longer selected. Falling through could connect it to a different same-name row.
    if (index.knownUids.has(uid)) return null;
  }
  const name = itemNameKey(item);
  const matchedByName = index.byName.get(name);
  // No. can move when Release Master rows are rearranged. For rows without a
  // stable UID, unchanged title + artist is therefore a stronger identity.
  if (matchedByName) return { value: matchedByName, priority: 1 };
  if (index.knownNames.has(name)) return null;
  const no = item.source.no?.trim();
  if (no) {
    const matched = index.byNo.get(no);
    if (matched) return { value: matched, priority: 2 };
    if (index.knownNos.has(no)) return null;
  }
  return null;
}

function matchDocument(document: GeneratorDocument, index: SelectedIndex): Map<string, Selected> {
  const items = new Map(document.items.map(item => [item.id, item]));
  const ordered = document.pages.flatMap(page => page.itemIds).map(id => items.get(id)).filter((item): item is GeneratorItem => Boolean(item));
  const candidates = new Map(ordered.filter(item => item.source.kind === "release-master").map(item => [item.id, matchCandidate(item, index)]));
  const result = new Map<string, Selected>(), used = new Set<string>();
  // Assign stronger identities first. This also makes the match one-to-one, so
  // duplicate existing items cannot both claim the same selected Release Master row.
  for (const priority of [0, 1, 2]) for (const item of ordered) {
    if (result.has(item.id)) continue;
    const candidate = candidates.get(item.id);
    if (!candidate || candidate.priority !== priority || used.has(candidate.value.key)) continue;
    result.set(item.id, candidate.value);
    used.add(candidate.value.key);
  }
  return result;
}

export function collectReimportDiff(document: GeneratorDocument, albums: ReleaseMasterAlbum[]): ReimportDiff {
  const chosen = selection(document, albums), index = selectedIndex(chosen, albums);
  const matches = matchDocument(document, index), groups = groupOf(document), matchedKeys = new Set([...matches.values()].map(value => value.key));
  const added = chosen.filter(value => !matchedKeys.has(value.key)).map(value => ({ key: value.key, title: value.album.title, artist: value.album.artist, group: value.group }));
  const removed: ReimportRemoved[] = [], moved: ReimportMoved[] = [];
  for (const item of document.items) {
    const group = groups.get(item.id); if (!group || item.source.kind !== "release-master") continue;
    const source = matches.get(item.id);
    if (!source) removed.push({ itemId: item.id, title: item.content.fields.title, artist: item.content.fields.artist, group, edited: edited(item, document.series) });
    else if (source.group !== group) moved.push({ itemId: item.id, title: item.content.fields.title, artist: item.content.fields.artist, from: group, to: source.group });
  }
  const featureAfter = document.series === "weekly" ? chosen.filter(value => value.group === "feature").length : null;
  const othersAfter = document.series === "weekly" ? chosen.filter(value => value.group === "others").length : null;
  return { added, removed, moved, limits: { featureMax: document.series === "weekly" ? 5 : null, othersMax: document.series === "weekly" ? 60 : null, featureAfter, othersAfter } };
}

function orderedAlbums(ids: string[], matched: Map<string, Selected>, group: ReimportGroup): string[] {
  const albums = ids.map(id => matched.get(id)?.album).filter((value): value is ReleaseMasterAlbum => Boolean(value));
  const ordered = group === "others" ? sortWeeklyOthers(albums) : sortAlbums(albums);
  const byKey = new Map(ids.map(id => [matched.get(id)?.key || "", id]));
  const sorted = ordered.map(album => byKey.get(releaseMasterKey(album))!).filter(Boolean);
  // 手で足した作品はRelease Masterの並び規則に無いので、消さずに区分末尾へ残す。
  return [...sorted, ...ids.filter(id => !sorted.includes(id))];
}
function page(id: string, kind: GeneratorPage["kind"], itemIds: string[], existing?: GeneratorPage): GeneratorPage {
  return { id, kind, itemIds, bgColor: existing?.bgColor || null };
}

/** Creates the exact server-side proposal. Existing item IDs/content and page colours are never supplied by the client. */
export function buildReimport({
  document, albums, addKeys, removeItemIds, resort, importedAt = new Date().toISOString(),
}: {
  document: GeneratorDocument; albums: ReleaseMasterAlbum[]; addKeys: string[]; removeItemIds: string[]; resort: boolean; importedAt?: string;
}): { pages: GeneratorPage[]; addItems: GeneratorItem[]; removeItemIds: string[] } {
  const diff = collectReimportDiff(document, albums), chosen = selection(document, albums), selected = selectedIndex(chosen, albums);
  const matches = matchDocument(document, selected);
  const validAdds = new Set(diff.added.map(value => value.key)), validRemovals = new Set(diff.removed.map(value => value.itemId));
  if (new Set(addKeys).size !== addKeys.length || new Set(removeItemIds).size !== removeItemIds.length
    || addKeys.some(key => !validAdds.has(key)) || removeItemIds.some(id => !validRemovals.has(id))) {
    throw new GeneratorError("INVALID_INPUT", 400, "取り込み対象が最新版と一致しません。差分を読み直してください。");
  }
  const group = groupOf(document), removed = new Set(removeItemIds);
  const ids: Record<ReimportGroup, string[]> = { adopted: [], listed: [], feature: [], others: [] };
  const incoming: Record<ReimportGroup, string[]> = { adopted: [], listed: [], feature: [], others: [] };
  for (const sourcePage of document.pages) for (const id of sourcePage.itemIds) {
    if (removed.has(id)) continue;
    const current = group.get(id), target = matches.get(id)?.group || current;
    if (target && target === current) ids[target].push(id);
    else if (target) incoming[target].push(id);
  }
  for (const kind of Object.keys(ids) as ReimportGroup[]) ids[kind].push(...incoming[kind]);
  const additions = chosen.filter(value => addKeys.includes(value.key));
  const addItems = additions.map(value => createGeneratorItem(value.album, document.series, importedAt));
  for (let index = 0; index < additions.length; index++) {
    ids[additions[index].group].push(addItems[index].id);
    matches.set(addItems[index].id, additions[index]);
  }
  if (resort) for (const kind of Object.keys(ids) as ReimportGroup[]) ids[kind] = orderedAlbums(ids[kind], matches, kind);

  const original = document.pages;
  if (document.series === "weekly") {
    if (ids.feature.length > 5 || ids.others.length > 60) throw new GeneratorError("INVALID_INPUT", 400, "WEEK列の採用は5件以下、掲載は60件以下にしてください。");
    const cover = original.find(value => value.kind === "cover")!;
    const oldFeatures = original.filter(value => value.kind === "feature"), oldOthers = original.find(value => value.kind === "others")!;
    const features = ids.feature.map((id, index) => {
      const kept = resort ? oldFeatures[index] : group.get(id) === "feature" ? oldFeatures.find(value => value.itemIds[0] === id) : undefined;
      return page(kept?.id || randomUUID(), "feature", [id], kept);
    });
    const result = [page(cover.id, "cover", [], cover), ...features, page(oldOthers.id, "others", ids.others, oldOthers)];
    parseDocument({ ...document, pages: result, items: [...document.items.filter(item => !removed.has(item.id)), ...addItems] });
    return { pages: result, addItems, removeItemIds };
  }
  const oldAdopted = original.filter(value => value.kind === "adopted"), oldListed = original.filter(value => value.kind === "listed");
  const adopted = ids.adopted.map((id, index) => {
    const kept = resort ? oldAdopted[index] : group.get(id) === "adopted" ? oldAdopted.find(value => value.itemIds[0] === id) : undefined;
    return page(kept?.id || randomUUID(), "adopted", [id], kept);
  });
  const listed: GeneratorPage[] = [];
  if (!resort) {
    const allowed = new Set(ids.listed), retained = new Set<string>();
    for (const sourcePage of oldListed) {
      const itemIds = sourcePage.itemIds.filter(id => allowed.has(id) && group.get(id) === "listed");
      if (itemIds.length) { listed.push(page(sourcePage.id, "listed", itemIds, sourcePage)); itemIds.forEach(id => retained.add(id)); }
    }
    const tail = ids.listed.filter(id => !retained.has(id));
    if (listed.length && listed.at(-1)!.itemIds.length === 1 && tail.length) listed.at(-1)!.itemIds.push(tail.shift()!);
    for (let index = 0; index < tail.length; index += 2) listed.push(page(randomUUID(), "listed", tail.slice(index, index + 2)));
  } else {
    for (let index = 0; index < ids.listed.length; index += 2) listed.push(page(oldListed[listed.length]?.id || randomUUID(), "listed", ids.listed.slice(index, index + 2), oldListed[listed.length]));
  }
  const result = [...adopted, ...listed];
  parseDocument({ ...document, pages: result, items: [...document.items.filter(item => !removed.has(item.id)), ...addItems] });
  return { pages: result, addItems, removeItemIds };
}
