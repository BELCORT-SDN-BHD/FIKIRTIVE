import { describe, it, expect } from "vitest";
import { buildStuffItems, filterStuffItems, productImageIndex } from "../stuff-items";
import type { EntityDTO } from "../types";
import type { BrandRecordRow } from "../brand-record-actions";

const ent = (id: string, type: EntityDTO["type"], name: string, assetId?: string): EntityDTO => ({
  id, type, name, aliases: [], notes: "", negativeConstraints: "",
  refs: assetId ? [{ id: `ref-${id}`, assetId, url: `/a/${assetId}.png`, kind: "image" }] : [],
  baseAssetId: assetId ?? null, variants: [], usageCount: 0,
});
const rec = (name: string, imageAssetId?: string): BrandRecordRow => ({
  id: `r-${name}`, kind: "product", data: { name, ...(imageAssetId ? { imageAssetId } : {}) },
  status: "active", startsAt: null, endsAt: null, source: "user", pinned: false, updatedAt: new Date(),
});

describe("buildStuffItems", () => {
  it("classifies entities, gens and ads with stable unique ids", () => {
    const items = buildStuffItems({
      entities: [ent("e1", "CHARACTER", "Rosa", "as1"), ent("e2", "PRODUCT", "Latte", "as2")],
      history: [
        { id: "g1", projectId: "p1", assetId: "ag1", src: "/g1.png", kind: "image", prompt: "Still" },
        { id: "g2", projectId: "p2", assetId: "ag2", src: "/g2.mp4", kind: "video", prompt: "Motion" },
      ],
      ads: [{ id: "a1", projectId: "p3", assetId: "aa1", src: "/ad1.mp4", kind: "video", prompt: "Raya teaser", createdAt: "2026-01-01T00:00:00.000Z" }],
      records: [rec("Latte", "as2")],
    });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.find((i) => i.entityId === "e2")?.productName).toBe("Latte");
    expect(items.find((i) => i.entityId === "e1")?.assetId).toBe("as1");
    expect(items.find((i) => i.id === "gen:g1")).toMatchObject({ generationId: "g1", projectId: "p1", assetId: "ag1", label: "Still" });
    expect(items.find((i) => i.id === "ad:a1")).toMatchObject({ generationId: "a1", projectId: "p3", assetId: "aa1", label: "Raya teaser" });
  });

  it("shows an ad generation once and keeps it in the Ads filter", () => {
    const shared = {
      id: "g-ad",
      projectId: "p1",
      assetId: "asset-ad",
      kind: "image" as const,
      prompt: "Raya bundle",
    };
    const items = buildStuffItems({
      entities: [],
      history: [{ ...shared, src: "/history-ad.png" }],
      ads: [{ ...shared, src: "/ad.png", createdAt: "2026-01-01T00:00:00.000Z" }],
      records: [],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "ad:g-ad", source: "ad", generationId: "g-ad" });
    expect(filterStuffItems(items, "ads", "")).toEqual(items);
  });

  // #949 A4 — a generation with no prompt (an Otto reference edit, or a row the
  // prompt never landed on) used to fall back to the raw id (a ULID) as the label.
  it("labels a prompt-less item by media kind, never the raw id", () => {
    const items = buildStuffItems({
      entities: [],
      history: [
        { id: "01M02KMT02PPGWCJPH", projectId: "p1", assetId: "ag1", src: "/g1.png", kind: "image", prompt: "" },
        { id: "01M02J7ZJJW43F420JH", projectId: "p1", assetId: "ag2", src: "/g2.mp4", kind: "video", prompt: "" },
      ],
      ads: [{ id: "01M02AD00000000000A", projectId: "p3", assetId: "aa1", src: "/ad1.png", kind: "image", prompt: "", createdAt: "2026-01-01T00:00:00.000Z" }],
      records: [],
    });
    expect(items.find((i) => i.id === "gen:01M02KMT02PPGWCJPH")?.label).toBe("Untitled image");
    expect(items.find((i) => i.id === "gen:01M02J7ZJJW43F420JH")?.label).toBe("Untitled video");
    expect(items.find((i) => i.id === "ad:01M02AD00000000000A")?.label).toBe("Untitled image");
  });
});

describe("filterStuffItems", () => {
  const items = buildStuffItems({
    entities: [ent("e1", "CHARACTER", "Rosa", "as1"), ent("e2", "PRODUCT", "Latte", "as2"), ent("e3", "LOCATION", "Cafe", "as3")],
    history: [
      { id: "g1", projectId: "p1", assetId: "ag1", src: "/g1.png", kind: "image", prompt: "Still" },
      { id: "g2", projectId: "p1", assetId: "ag2", src: "/g2.mp4", kind: "video", prompt: "Motion" },
    ],
    ads: [], records: [],
  });
  it("cast/product-assets filter by entity type; location shows in images+all only", () => {
    expect(filterStuffItems(items, "cast", "").map((i) => i.entityId)).toEqual(["e1"]);
    expect(filterStuffItems(items, "products", "").map((i) => i.entityId)).toEqual(["e2"]);
    expect(filterStuffItems(items, "images", "").length).toBe(4); // 3 entity images + g1
    expect(filterStuffItems(items, "videos", "").map((i) => i.id)).toEqual(["gen:g2"]);
    expect(filterStuffItems(items, "all", "").length).toBe(5);
  });
  it("search is case-insensitive substring on label", () => {
    expect(filterStuffItems(items, "all", "LATTE").map((i) => i.entityId)).toEqual(["e2"]);
  });
});

describe("productImageIndex", () => {
  it("maps assetId → product name, active products only", () => {
    const archived = { ...rec("Old", "asX"), status: "archived" as const };
    const idx = productImageIndex([rec("Latte", "as2"), archived, rec("NoImg")]);
    expect(idx.get("as2")).toBe("Latte");
    expect(idx.has("asX")).toBe(false);
    expect(idx.size).toBe(1);
  });
});
