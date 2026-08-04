/**
 * canvas-selection — what a multi-card selection can do. Pure, no I/O, no spend.
 *
 * The canvas could only ever act on one card at a time: no shift-click, no box select, and
 * no way to download or clear a shoot in one go (#547 B6). Selection itself lives in React
 * Flow; this module answers the two questions the batch bar needs — what can be downloaded,
 * and is anything in the selection a paid job still in flight (removing one of those does not
 * refund it, so the confirm has to say so).
 *
 * `inFlightPaid` is supplied by the caller from `isInFlightPaidGen` — the single definition
 * of "paid and unresolved" stays where the spend path already keeps it.
 */

export type CanvasSelectionNode = {
  id: string;
  type: string | null | undefined;
  url?: string | null;
  prompt?: string | null;
  /** From isInFlightPaidGen — a paid image/video that has not resolved to media yet. */
  inFlightPaid?: boolean;
};

export type CanvasDownload = { id: string; url: string; fileName: string };

export type CanvasBatchSelection = {
  ids: string[];
  count: number;
  downloads: CanvasDownload[];
  inFlightPaidCount: number;
};

const MEDIA_TYPES = new Set(["image", "video"]);
const EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mov"]);

/** Turn a prompt into a short, safe file-name stem. Falls back to the card type. */
export function canvasFileStem(prompt: string | null | undefined, fallback: string): string {
  const slug = (prompt ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40)
    .replace(/-+$/u, "");
  return slug || fallback;
}

/** Extension the browser should save this media under — read from the URL, never guessed wildly. */
export function canvasFileExtension(url: string, type: string | null | undefined): string {
  const path = url.split(/[?#]/u)[0] ?? "";
  const candidate = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (path.includes(".") && EXTENSIONS.has(candidate)) return candidate;
  return type === "video" ? "mp4" : "png";
}

/** "red-sneakers-on-sand-2.png" — stable, readable, and unique inside one download batch. */
export function canvasDownloadFileName(
  node: CanvasSelectionNode,
  index: number,
  url: string,
): string {
  const stem = canvasFileStem(node.prompt, node.type === "video" ? "video" : "image");
  return `${stem}-${index + 1}.${canvasFileExtension(url, node.type)}`;
}

/** Everything the batch bar needs about the current selection. */
export function canvasBatchSelection(nodes: readonly CanvasSelectionNode[]): CanvasBatchSelection {
  const ids = nodes.map((node) => node.id);
  const downloads: CanvasDownload[] = [];
  for (const node of nodes) {
    if (!MEDIA_TYPES.has(node.type ?? "")) continue;
    const url = node.url;
    if (typeof url !== "string" || !url) continue;
    downloads.push({ id: node.id, url, fileName: canvasDownloadFileName(node, downloads.length, url) });
  }
  return {
    ids,
    count: ids.length,
    downloads,
    inFlightPaidCount: nodes.filter((node) => node.inFlightPaid === true).length,
  };
}

export type CanvasMergeNode = {
  id: string;
  selected?: boolean;
  data: { status?: unknown; url?: unknown };
};

/**
 * Fold a fresh server read of the board into what is already on screen.
 *
 * Two things must survive a reload, and they used to be one line apart:
 *
 *   1. A card the server has not caught up with keeps its local copy. A row that still says
 *      "pending" and carries no media is BEHIND the screen, never ahead of it — the card is
 *      either still generating in this browser (replacing it restarts the "generating…" the
 *      merchant is watching) or has already finished here, and the read simply left the server
 *      before it settled. Reads do not come back in the order they were sent, so that older
 *      answer used to land last and put a finished card back to "generating" (r3 review P2-1).
 *   2. Whatever the merchant has SELECTED stays selected. The server row carries no selection,
 *      so taking it wholesale silently deselected everything — and the board reloads on a timer
 *      while anything is generating, so a multi-card selection could disappear between picking
 *      the cards and pressing Download.
 *
 * Cards the server read does not know about yet (just placed locally) are kept at the end.
 */
export function mergeReloadedCanvasNodes<T extends CanvasMergeNode>(
  previous: readonly T[],
  incoming: readonly T[],
): T[] {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  const merged = incoming.map((node) => {
    const old = previousById.get(node.id);
    if (!old) return node;
    // A read that is still catching up may never pull a card BACKWARDS (#612 r3, judge P1②③).
    // The rule used to be spelled as a list of states this tab "already knew", and the list left
    // out every state a card reaches when its own poll ENDS — it gave up (timeout), or learnt an
    // ending the row has not been settled to yet. Those cards were replaced by the still-pending
    // server row, so the spinner came back with nothing left running to take it off again: the
    // poll was over, and the resolve that would have recorded the ending had not landed.
    //
    // So the rule is now the thing it was always trying to say: while the server row is still
    // `pending` with no media it has nothing to teach this card, and the moment it holds a settled
    // answer — an ending, or the picture — that answer wins, whatever this tab had guessed.
    const serverStillCatchingUp = node.data.status === "pending" && !node.data.url;
    if (serverStillCatchingUp) return old;
    return old.selected === node.selected ? node : { ...node, selected: old.selected };
  });
  const mergedIds = new Set(merged.map((node) => node.id));
  return [...merged, ...previous.filter((node) => !mergedIds.has(node.id))];
}

/** Plain-language confirm copy for removing a whole selection. */
export function canvasBatchDeleteCopy(selection: Pick<CanvasBatchSelection, "count" | "inFlightPaidCount">): {
  title: string;
  description: string;
} {
  const cards = selection.count === 1 ? "1 card" : `${selection.count} cards`;
  if (selection.inFlightPaidCount > 0) {
    const stillMaking = selection.inFlightPaidCount === 1
      ? "One of them is still being made and has already been charged."
      : `${selection.inFlightPaidCount} of them are still being made and have already been charged.`;
    return {
      title: "Still generating — remove anyway?",
      description: `${stillMaking} Removing won't refund those credits, and they will still finish and land in your Library. Generating them again would charge you a second time. This takes ${cards} off your board.`,
    };
  }
  return {
    title: `Remove ${cards} from canvas?`,
    description: "This takes them off your board. Any generated image or video stays saved in your library.",
  };
}
