import { describe, expect, it } from "vitest";
import {
  canvasBatchDeleteCopy,
  canvasBatchSelection,
  canvasDownloadFileName,
  canvasFileExtension,
  canvasFileStem,
  mergeReloadedCanvasNodes,
} from "../canvas-selection";

describe("canvasFileStem", () => {
  it("turns a prompt into a readable file name", () => {
    expect(canvasFileStem("Red sneakers on wet sand", "image")).toBe("red-sneakers-on-wet-sand");
  });

  it("falls back to the card type when there is no usable prompt", () => {
    expect(canvasFileStem("", "image")).toBe("image");
    expect(canvasFileStem("   ***   ", "video")).toBe("video");
    expect(canvasFileStem(null, "image")).toBe("image");
  });

  it("keeps the name short and never ends on a separator", () => {
    const stem = canvasFileStem("a".repeat(80), "image");
    expect(stem.length).toBeLessThanOrEqual(40);
    expect(stem.endsWith("-")).toBe(false);
  });
});

describe("canvasFileExtension", () => {
  it("saves media under the extension the stored file actually has", () => {
    expect(canvasFileExtension("https://cdn.example/a/b.webp", "image")).toBe("webp");
    expect(canvasFileExtension("https://cdn.example/a/b.mp4?sig=abc", "video")).toBe("mp4");
  });

  it("falls back by card type when the URL carries no usable extension", () => {
    expect(canvasFileExtension("https://cdn.example/asset", "image")).toBe("png");
    expect(canvasFileExtension("https://cdn.example/asset", "video")).toBe("mp4");
    expect(canvasFileExtension("https://cdn.example/a.tar.gz", "image")).toBe("png");
  });
});

describe("canvasBatchSelection", () => {
  it("collects every selected card that actually has media to download", () => {
    const selection = canvasBatchSelection([
      { id: "1", type: "image", url: "https://cdn.example/one.png", prompt: "sneaker" },
      { id: "2", type: "video", url: "https://cdn.example/two.mp4", prompt: "sneaker" },
      { id: "3", type: "image", url: null, prompt: "still generating" },
      { id: "4", type: "text", url: "https://cdn.example/no.png", prompt: "note" },
    ]);

    expect(selection.count).toBe(4);
    expect(selection.ids).toEqual(["1", "2", "3", "4"]);
    expect(selection.downloads.map((item) => item.fileName)).toEqual(["sneaker-1.png", "sneaker-2.mp4"]);
  });

  it("counts the paid cards still in flight so the confirm can warn about them", () => {
    const selection = canvasBatchSelection([
      { id: "1", type: "image", url: "https://cdn.example/one.png", inFlightPaid: false },
      { id: "2", type: "video", url: null, inFlightPaid: true },
    ]);

    expect(selection.inFlightPaidCount).toBe(1);
  });

  it("numbers downloads so a batch from one prompt does not collide", () => {
    const node = { id: "1", type: "image" as const, prompt: "same prompt" };
    expect(canvasDownloadFileName(node, 0, "https://cdn.example/a.png")).toBe("same-prompt-1.png");
    expect(canvasDownloadFileName(node, 1, "https://cdn.example/b.png")).toBe("same-prompt-2.png");
  });
});

describe("canvasBatchDeleteCopy", () => {
  it("says plainly what removing settled cards does", () => {
    const copy = canvasBatchDeleteCopy({ count: 3, inFlightPaidCount: 0 });
    expect(copy.title).toBe("Remove 3 cards from canvas?");
    expect(copy.description).toContain("stays saved in your library");
  });

  it("warns that removing an in-flight paid card does not refund it", () => {
    const copy = canvasBatchDeleteCopy({ count: 2, inFlightPaidCount: 1 });
    expect(copy.title).toBe("Still generating — remove anyway?");
    expect(copy.description).toContain("won't refund");
    expect(copy.description).toContain("charge you a second time");
  });
});

/**
 * What survives a board reload (round-1 review P2-1).
 *
 * The canvas re-reads the board on a timer while anything is generating, and again whenever a
 * card finishes. The server row knows nothing about what the merchant has picked, so every one
 * of those reloads used to wipe a multi-card selection — the merchant would shift-click four
 * cards, the board would refresh under them, and the batch bar would vanish mid-action.
 */
describe("mergeReloadedCanvasNodes", () => {
  type BoardNode = {
    id: string;
    selected?: boolean;
    local?: boolean;
    data: { status: string; url: string | null | undefined };
  };
  const server = (id: string, extra: { status?: string; url?: string | null } = {}): BoardNode => ({
    id,
    data: {
      status: extra.status ?? "done",
      url: "url" in extra ? extra.url : "https://cdn.example/a.png",
    },
  });

  it("keeps every card the merchant had picked selected", () => {
    const previous = [
      { ...server("a"), selected: true },
      { ...server("b"), selected: true },
      { ...server("c"), selected: false },
    ];

    const merged = mergeReloadedCanvasNodes(previous, [server("a"), server("b"), server("c")]);

    expect(merged.filter((node) => node.selected).map((node) => node.id)).toEqual(["a", "b"]);
  });

  it("still takes the server's fresh media for a selected card", () => {
    const previous = [{ ...server("a", { status: "pending", url: null }), selected: true }];

    const merged = mergeReloadedCanvasNodes(previous, [server("a", { url: "https://cdn.example/new.png" })]);

    expect(merged[0]!.data).toEqual({ status: "done", url: "https://cdn.example/new.png" });
    expect(merged[0]!.selected).toBe(true);
  });

  it("does not clobber a card that is still generating locally", () => {
    const local = { ...server("a", { status: "pending", url: null }), selected: false, local: true };

    const merged = mergeReloadedCanvasNodes([local], [server("a", { status: "pending", url: null })]);

    expect(merged[0]).toBe(local);
  });

  it("never drags a finished card back to 'generating' on an older read", () => {
    // The board is read on a timer. A read that LEFT the server before the card settled still
    // describes it as pending with no media, and it can land after the browser's own poll has
    // already put the finished image on screen. Taking that row wholesale made a card the
    // merchant had just watched appear start spinning again (r3 review P2-1).
    const finishedHere = { ...server("a"), selected: true };

    const merged = mergeReloadedCanvasNodes([finishedHere], [server("a", { status: "pending", url: null })]);

    expect(merged[0]).toBe(finishedHere);
  });

  it("keeps a card the server read has not caught up with yet", () => {
    const merged = mergeReloadedCanvasNodes([server("local-only")], [server("a")]);

    expect(merged.map((node) => node.id)).toEqual(["a", "local-only"]);
  });
});
