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
import { isInFlightCardFace } from "./canvas-card-status";

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
  data: {
    status?: unknown;
    url?: unknown;
    /**
     * A board read has shown this card at least once (#612 r4). It separates the two populations
     * an absent card can belong to: one the server has never heard of (just placed here, a read
     * already in flight cannot contain it) and one the server used to return and no longer does
     * — which, since reads omit tombstones, means it was deleted.
     */
    serverKnown?: unknown;
  };
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
  /**
   * Cards this tab has already taken off the board because they were DELETED (#612 r5).
   *
   * Removing a card cannot un-send a read that is already in flight: that read left before the
   * deletion, so it still carries the card — stamped `serverKnown` from its own snapshot — and
   * lands afterwards, putting it back. If the row it captured happens to be terminal, the card is
   * no longer in flight, the board's re-read loop stops with it on screen, and a deleted card
   * haunts the board for good. Deletion therefore outranks every snapshot, whenever it departed.
   */
  removedIds: ReadonlySet<string> = EMPTY_REMOVED,
): T[] {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  const merged = incoming.filter((node) => !removedIds.has(node.id)).map((node) => {
    const old = previousById.get(node.id);
    if (!old) return node;
    // A read that is still catching up may never pull a card BACKWARDS (#612 r3, judge P1②③).
    // The rule used to be spelled as a list of states this tab "already knew", and the list left
    // out every state a card reaches when its own poll ENDS — it gave up (timeout), or learnt an
    // ending the row has not been settled to yet. Those cards were replaced by the still-pending
    // server row, so the spinner came back with nothing left running to take it off again: the
    // poll was over, and the resolve that would have recorded the ending had not landed.
    //
    // So the rule is now the thing it was always trying to say: while the server still says this
    // card is being made and carries no media, it has nothing to teach this card; the moment it
    // holds a settled answer — an ending, or the picture — that answer wins, whatever this tab had
    // guessed. "Being made" is the in-flight FACE set (#602 T3), which is queued and generating —
    // the same one row word, split by what the job itself says.
    const serverStillCatchingUp = isInFlightCardFace(
      typeof node.data.status === "string" ? node.data.status : null,
    ) && !node.data.url;
    // Either way this card is one the server HAS answered for, which is what lets an absent card
    // be read as deleted further down.
    if (serverStillCatchingUp) return acknowledged(old);
    return old.selected === node.selected ? node : { ...node, selected: old.selected };
  });
  const mergedIds = new Set(merged.map((node) => node.id));
  // A card missing from an authoritative read is one of two very different things, and treating
  // them alike is what kept a deleted card on screen for ever (#612 r4). A card the server has
  // never returned may simply be newer than the read in flight — it stays. A card the server used
  // to return and no longer does has been deleted: reads omit tombstones, so nothing that arrives
  // later can ever take it off the board, and keeping it means a merchant watching a card being
  // made that does not exist. It goes.
  return [
    ...merged,
    ...previous.filter((node) => !mergedIds.has(node.id) && !node.data.serverKnown && !removedIds.has(node.id)),
  ];
}

/** No card has been removed on this board yet. Shared so the default costs no allocation. */
const EMPTY_REMOVED: ReadonlySet<string> = new Set<string>();

/**
 * Stamp a card as one a board read has shown, without disturbing one already stamped.
 *
 * It stamps the card that is ON SCREEN, not the row that just arrived, so this says "the server
 * has answered for this card" and never "these columns came from the server". That distinction is
 * what the lineage gate rests on (#605 r1 P1-1): a card the browser has just put down carries no
 * batch identity at all, so keeping it here keeps nulls — the tree, the badge and the compare
 * gate stay silent about it until a read that can place it brings the settled columns.
 */
function acknowledged<T extends CanvasMergeNode>(node: T): T {
  return node.data.serverKnown ? node : { ...node, data: { ...node.data, serverKnown: true } };
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

/**
 * Delete / Backspace on the board — which cards the press is asking to remove (FRONT-A15).
 *
 * 病根(Codex 真机走查 QA-CRE-002,2026-09-03,生产构建):画布把 React Flow 自己的删除键
 * 关掉了(`deleteKeyCode={null}`,因为它会不问一声就删,而在飞的付费卡删掉不退款),然后
 * **没有人接手**——选中一张文字卡按 Delete、按 Backspace,屏幕上什么都不发生。已批准的设计
 * 夹具里这个键是通的:`design-system/patterns/canvas/CanvasReference.tsx:470` 在不是打字的
 * 时候按 Backspace / Delete 就移走当前选中的全部卡。
 *
 * 这里只回答「要删哪几张」;真去删走的还是原来那两条确认路(单张 ✕ 的确认框、多张的批量
 * 确认框),所以「还在生成、删了不退款」那句警告一个字都不会被键盘绕过去。选中状态只有一份,
 * 就是 React Flow 记在卡上的 `selected`——调用方把它读出来传进来。
 */
export type CanvasDeleteKeyPress = {
  key: string;
  /** 光标正在输入框/文本域/可编辑区里 —— 那时 Backspace 是退格,不是删卡。 */
  editing: boolean;
  /** 屏幕上已经有一个对话框开着 —— 那一层自己处理按键,画板不插手。 */
  dialogOpen: boolean;
};

/** 这一按要删的卡;不是删除键、正在打字、有对话框开着或什么都没选中时返回 `null`。 */
export function canvasDeleteKeyIds(
  press: CanvasDeleteKeyPress,
  selectedIds: readonly string[],
): string[] | null {
  if (press.key !== "Delete" && press.key !== "Backspace") return null;
  if (press.editing || press.dialogOpen) return null;
  if (selectedIds.length === 0) return null;
  return [...selectedIds];
}

/** 一次按键落在哪种元素上算「正在打字」。`closest` 而不是 `matches`:Otto 的输入框是
 *  ProseMirror,按键的落点是它里面的某个子节点,不是那个 `contenteditable` 本身。 */
export const CANVAS_EDITABLE_SELECTOR =
  "input, textarea, select, [contenteditable='true'], [contenteditable='']";

/** 屏幕上开着的对话框 —— 确认框自己要吃掉 Escape / Backspace。 */
export const CANVAS_DIALOG_SELECTOR = "[role='dialog'], [role='alertdialog']";
