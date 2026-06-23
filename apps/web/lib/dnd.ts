// Typed drag-and-drop payloads. Each kind travels on its OWN custom MIME type so
// (a) OS file drags can't trigger our handlers, and (b) a drop target can tell
// during `dragover` whether the drag is meant for it — the HTML5 spec exposes
// `DataTransfer.types` during dragover but blocks `getData()` until `drop`, so the
// kind has to live in the MIME, not the payload, for the hover highlight.
export type DndPayload =
  | { kind: "editor-clip"; src: string; clipKind: "image" | "video" | "audio"; seconds: number }
  | { kind: "candidate-frame"; generationId: string };

const MIME: Record<DndPayload["kind"], string> = {
  "editor-clip": "application/x-fikirtive-editor-clip",
  "candidate-frame": "application/x-fikirtive-candidate-frame",
};

export function setDnd(dt: DataTransfer | null, p: DndPayload): void {
  if (!dt) return;
  dt.setData(MIME[p.kind], JSON.stringify(p));
  dt.effectAllowed = "copy";
}

function parse(raw: string | undefined, kind: DndPayload["kind"]): DndPayload | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (kind === "editor-clip") {
    if (o.kind === "editor-clip" && typeof o.src === "string" &&
        (o.clipKind === "image" || o.clipKind === "video" || o.clipKind === "audio") &&
        typeof o.seconds === "number" && Number.isFinite(o.seconds)) {
      return { kind: "editor-clip", src: o.src, clipKind: o.clipKind, seconds: o.seconds };
    }
    return null;
  }
  if (o.kind === "candidate-frame" && typeof o.generationId === "string" && o.generationId.length > 0) {
    return { kind: "candidate-frame", generationId: o.generationId };
  }
  return null;
}

export function getDnd(dt: DataTransfer | null): DndPayload | null {
  if (!dt) return null;
  return parse(dt.getData(MIME["editor-clip"]), "editor-clip")
    ?? parse(dt.getData(MIME["candidate-frame"]), "candidate-frame");
}

/** True when the drag carries our payload of the given kind. Uses `types` only
 *  (readable during dragover, unlike getData), so the hover highlight stays
 *  precise — a candidate drag won't light up the editor timeline, etc. */
export function hasDnd(dt: DataTransfer | null, kind: DndPayload["kind"]): boolean {
  return !!dt && Array.from(dt.types).includes(MIME[kind]);
}
