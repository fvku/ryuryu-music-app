"use client";

// TEMPORARY: 見た目確認用の固定データ。確認後に削除する。
import type { GeneratorSnapshot } from "@/lib/generator/client-types";
import type { Fields, GeneratorDocument, GeneratorItem } from "@/lib/generator/model";
import GeneratorWorkspace from "../[id]/GeneratorWorkspace";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
];

const text: Fields = {
  title: "Blue Rondo",
  artist: "The Quartet",
  duration: "10songs, 40min 12sec",
  genreMemo: "Jazz / Fusion",
  country: "US",
  trackNo: "3",
  track: "Take Five",
  text: "静かな導入から、後半にかけて熱を帯びていく一枚。\n反復するリフの上で、管と鍵盤が少しずつ位置を変えていく。\n終盤の長いフェードは、次作への助走のようにも聞こえる。",
};

const items: GeneratorItem[] = [0, 1, 2].map(index => ({
  id: ids[index],
  source: { kind: "manual", uid: null, no: null, date: "", importedAt: null, coverUrl: null, fields: { ...text } },
  content: {
    fields: { ...text, title: ["Blue Rondo", "Night Ferry", "Paper Moon"][index] },
    show: { title: true, artist: true, duration: true, genreMemo: true, country: false, track: true },
    tracking: -0.02,
    kerns: {},
    bodyLeadMode: "auto",
    bodyMaxLead: 42,
    typography: {},
    jacketAssetId: null,
  },
}));

const document: GeneratorDocument = {
  schemaVersion: 1,
  id: ids[5],
  series: "monthly",
  period: { type: "month", start: "2026-08-01", end: "2026-09-01" },
  rendererVersion: "monthly-japan-v1",
  items,
  pages: [
    { id: ids[3], kind: "adopted", itemIds: [ids[0]], bgColor: "#2f4858" },
    { id: ids[4], kind: "listed", itemIds: [ids[1], ids[2]], bgColor: "#4a3f6b" },
  ],
  theme: { useWave: true, waveAssetId: null, backgroundAssetId: null, outputSize: 2400 },
};

const snapshot: GeneratorSnapshot = {
  document,
  version: 7,
  themeVersion: 2,
  structureVersion: 1,
  pageVersions: { [ids[3]]: 3, [ids[4]]: 2 },
  itemVersions: { [ids[0]]: 5, [ids[1]]: 2, [ids[2]]: 1 },
  updatedAt: "2026-09-06T02:00:00.000Z",
  updatedBy: "kohei.fuku0926@gmail.com",
  locks: [{ kind: "theme", targetId: ids[5], owner: "akyme68@gmail.com", expiresAt: "2099-01-01T00:00:00.000Z" }],
};

export default function UiPreviewPage() {
  return <GeneratorWorkspace initialSnapshot={snapshot} actor="kohei.fuku0926@gmail.com" />;
}
