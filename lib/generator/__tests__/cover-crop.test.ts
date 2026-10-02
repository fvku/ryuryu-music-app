import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasPreviewPage } from "../canvas-preview";
import { importWeeklyDocument } from "../source";
import { preparePage, type GeneratorRuntime } from "@/app/generator/runtime";
import type { ReleaseMasterAlbum } from "@/lib/types";

const detectFocusX = vi.hoisted(() => vi.fn(async () => .7));
vi.mock("@/tools/generator-lab/core/face-crop.mjs", () => ({ detectFocusX }));

const runtime = { coverFontReady: () => true, coversByUid: new Map(), coversByNo: new Map() } as GeneratorRuntime;
function document() {
  const album = { uid: crypto.randomUUID(), no: "1", date: "2026-10-02", weekNumber: "40", weekAdoption: "採用",
    title: "Album", artist: "Artist", genreMemo: "Pop", country: "UK", mjTrackNo: "", mjTrack: "", mjText: "", coverUrl: `https://example.com/${crypto.randomUUID()}.png`, coverUrlLarge: "", duration: "10songs, 40min" } as ReleaseMasterAlbum;
  return importWeeklyDocument([album], "2026-10-02");
}

class TestImage {
  src = "";
  width = 600;
  height = 600;
  addEventListener() {}
  async decode() {}
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Weekly cover crop preparation shared by preview and PNG export", () => {
  it("uses manual positions ahead of face detection and resets to automatic", async () => {
    vi.stubGlobal("Image", TestImage);
    const doc = document();
    doc.items[0].content.coverFocusX = .23;
    const manual = await preparePage(runtime, doc.id, canvasPreviewPage(doc, 0)!);
    expect(manual.slots[0].jacket.focusX).toBe(.23);
    expect(detectFocusX).not.toHaveBeenCalled();
    doc.items[0].content.coverFocusX = null;
    const auto = await preparePage(runtime, doc.id, canvasPreviewPage(doc, 0)!);
    expect(auto.slots[0].jacket.focusX).toBe(.7);
    expect(detectFocusX).toHaveBeenCalledOnce();
  });

  it("keeps the full jacket on feature pages even when the cover has a manual crop", async () => {
    vi.stubGlobal("Image", TestImage);
    const doc = document();
    doc.items[0].content.coverFocusX = 0;
    const page = await preparePage(runtime, doc.id, canvasPreviewPage(doc, 1)!);
    expect(page.slots[0].jacket.focusX).toBeUndefined();
    expect(detectFocusX).not.toHaveBeenCalled();
  });
});
