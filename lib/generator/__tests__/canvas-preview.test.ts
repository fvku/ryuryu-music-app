import { describe, expect, it } from "vitest";
import { canvasPreviewPage } from "../canvas-preview";
import { fixture } from "./fixture";

describe("generator canvas preview adapter", () => {
  it("preserves the saved page order and editable values", () => {
    const document = fixture();
    const page = canvasPreviewPage(document, 1);
    expect(page?.no).toBe(3);
    expect(page?.kind).toBe("listed");
    expect(page?.slots.map(slot => slot.id)).toEqual(document.pages[1].itemIds);
    expect(page?.slots[0].fields).toEqual(document.items[1].content.fields);
    expect(page?.slots[0].bodyLeadMode).toBe("auto");
  });

  it("returns null for a missing page or broken item reference", () => {
    const document = fixture();
    expect(canvasPreviewPage(document, 99)).toBeNull();
    document.pages[0].itemIds[0] = crypto.randomUUID();
    expect(canvasPreviewPage(document, 0)).toBeNull();
  });
});
