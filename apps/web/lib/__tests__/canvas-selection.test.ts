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
    data: { status: string; url: string | null | undefined; serverKnown?: boolean };
  };
  /** A card a board read has already shown — the population an absent row means "deleted" for. */
  const server = (id: string, extra: { status?: string; url?: string | null } = {}): BoardNode => ({
    id,
    data: {
      status: extra.status ?? "done",
      url: "url" in extra ? extra.url : "https://cdn.example/a.png",
      serverKnown: true,
    },
  });

  /** A card this tab has just placed: no read has returned it yet, so absence proves nothing. */
  const justPlaced = (id: string): BoardNode => ({
    id,
    data: { status: "generating", url: null },
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
    const previous = [{ ...server("a", { status: "generating", url: null }), selected: true }];

    const merged = mergeReloadedCanvasNodes(previous, [server("a", { url: "https://cdn.example/new.png" })]);

    expect(merged[0]!.data).toMatchObject({ status: "done", url: "https://cdn.example/new.png" });
    expect(merged[0]!.selected).toBe(true);
  });

  it("does not clobber a card that is still generating locally", () => {
    const local = { ...server("a", { status: "generating", url: null }), selected: false, local: true };

    const merged = mergeReloadedCanvasNodes([local], [server("a", { status: "generating", url: null })]);

    expect(merged[0]).toBe(local);
  });

  it("never drags a finished card back to 'generating' on an older read", () => {
    // The board is read on a timer. A read that LEFT the server before the card settled still
    // describes it as pending with no media, and it can land after the browser's own poll has
    // already put the finished image on screen. Taking that row wholesale made a card the
    // merchant had just watched appear start spinning again (r3 review P2-1).
    const finishedHere = { ...server("a"), selected: true };

    const merged = mergeReloadedCanvasNodes([finishedHere], [server("a", { status: "generating", url: null })]);

    expect(merged[0]).toBe(finishedHere);
  });

  it("keeps a card the server read has not caught up with yet", () => {
    const merged = mergeReloadedCanvasNodes([justPlaced("local-only")], [server("a")]);

    expect(merged.map((node) => node.id)).toEqual(["a", "local-only"]);
  });

  // #612 r4 (cross-family review P1): the other side of the same question. A card the server used
  // to return and no longer does was DELETED — board reads omit tombstones, so keeping it means
  // nothing that ever arrives can take it off again, and a card that is still "being made" stays
  // on screen for ever. The two populations are told apart by whether a read has shown the card.
  it("lets go of a card the server used to return and no longer does", () => {
    const deletedElsewhere = { ...server("gone", { status: "generating", url: null }), selected: true };

    const merged = mergeReloadedCanvasNodes([deletedElsewhere, server("a")], [server("a")]);

    expect(merged.map((node) => node.id)).toEqual(["a"]);
  });

  // #612 r3 (cross-family review P1②③): the same "an older read must not drag a card backwards"
  // rule, for the states the old `knownHere` list left out. A card whose own poll has ENDED — it
  // gave up (timeout), or learnt an ending the server row has not been settled to yet — was
  // replaced by the still-pending server row, so the spinner came back with nothing left running
  // to take it off again.
  it.each([
    ["timeout"],
    ["failed"],
    ["cancelled"],
    ["missing"],
  ])("does not put the spinner back on a card this tab has already left %s", (status) => {
    const here = { ...server("a", { status, url: null }), selected: true };

    const merged = mergeReloadedCanvasNodes([here], [server("a", { status: "generating", url: null })]);

    expect(merged[0]).toBe(here);
    expect(merged[0]!.data.status).not.toBe("pending");
  });

  // #612 r5: a read cannot be un-sent. One that left before a deletion still carries the card and
  // lands afterwards; if the row it captured is terminal, nothing re-reads for that card again.
  it("refuses to bring back a card this tab removed, whenever the read departed", () => {
    const captured = server("gone", { status: "failed", url: null });

    const merged = mergeReloadedCanvasNodes([], [captured, server("a")], new Set(["gone"]));

    expect(merged.map((node) => node.id)).toEqual(["a"]);
  });

  it("keeps removed cards out even if they are still in this tab's own list", () => {
    const stillHere = server("gone", { status: "generating", url: null });

    const merged = mergeReloadedCanvasNodes([stillHere], [server("a")], new Set(["gone"]));

    expect(merged.map((node) => node.id)).toEqual(["a"]);
  });

  // The tail's OWN line of defence, pinned on a row the other rule cannot reach. A card this tab
  // placed itself carries no `serverKnown` stamp, so "the server used to return it and no longer
  // does" says nothing about it — being absent from the read is exactly what a just-placed card
  // looks like. Only the removal memory can tell that this one is gone. Without this case the
  // tail's memory check could be deleted and every test would stay green (r5 review P2).
  it("drops a card it removed even when no read ever acknowledged it", () => {
    const placedHereThenDeleted = justPlaced("gone");

    const merged = mergeReloadedCanvasNodes(
      [placedHereThenDeleted, server("a")],
      [server("a")],
      new Set(["gone"]),
    );

    expect(merged.map((node) => node.id)).toEqual(["a"]);
  });

  it("takes the server's answer the moment the server HAS one", () => {
    // The other half of the same rule: a reread only loses while it is still catching up. As soon
    // as the row is settled truth it wins, whatever this tab had guessed.
    const here = { ...server("a", { status: "timeout", url: null }), selected: true };

    const settled = mergeReloadedCanvasNodes([here], [server("a", { status: "failed", url: null })]);
    const delivered = mergeReloadedCanvasNodes([here], [server("a", { url: "https://cdn.example/new.png" })]);

    expect(settled[0]!.data.status).toBe("failed");
    expect(delivered[0]!.data).toMatchObject({ status: "done", url: "https://cdn.example/new.png" });
    expect(delivered[0]!.selected).toBe(true);
  });
});
