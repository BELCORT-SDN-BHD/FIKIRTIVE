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
