"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { artlioEdit, snapEdit, splitClipAt, rippleDeleteClip, reconcileTransitions, type ArtlioEdit, type ArtlioClip } from "@artlio/core";
import { getRenderJobs, saveProjectEdit, startRender, getEditorMedia } from "@/lib/actions";
import { setDnd, getDnd, hasDnd } from "@/lib/dnd";
import { Button, Chip, EmptyHero, MonoLabel } from "./ds";

/**
 * Assembly-cut editor: Shotstack Studio session policed by the artlioEdit
 * contract — getEdit() snapshots are parsed canonically before any
 * persistence, and a debounced validator flags out-of-contract edits live.
 *
 * Phase-③ tracer: persistence is the SERVER (Project.editJson via
 * saveProjectEdit; the phase-② localStorage mock is dead per process rule 1),
 * and Export is real — RenderJob row → pg-boss → worker ffmpeg → asset.
 */

interface StudioEdit {
  /** Serialise the live edit. `includeIds:true` keeps each clip's STABLE SDK id —
   *  the only reliable identity for reconciling index-based transitions across a
   *  native reorder/trim (asset.src alone is ambiguous once a split makes two
   *  same-src halves). The id-free form is what we persist (the contract has no id). */
  getEdit: (options?: { includeIds?: boolean }) => unknown;
  addClip: (trackIdx: number, clip: unknown) => Promise<void>;
  updateClip: (trackIdx: number, clipIdx: number, updates: unknown) => Promise<void>;
  /** hot-reload a whole edit config (used to push a custom contract op back) */
  loadEdit: (edit: unknown) => Promise<void>;
  /** current transport position in seconds (public field on Edit) */
  playbackTime: number;
  events: { on: (e: string, cb: (payload?: unknown) => void) => (() => void) | void };
}
type StudioHandles = {
  edit: StudioEdit;
  dispose: () => void;
};
type EditorClip = { id: string; src: string; kind: "image" | "video"; seconds: number };
/** The selected clip, as the SDK's clip:selected event reports it (subset we edit). */
type SelClip = { asset?: { type?: string; src?: string; volume?: number }; transition?: { in?: string; out?: string } };
type Selection = { trackIndex: number; clipIndex: number; clip: SelClip };
/** A between-clip transition, mirroring the contract's betweenClipTransition shape.
 *  Lives in Artlio React state (outside Shotstack) and is merged into the
 *  ArtlioEdit on save. */
type UiTransition = { fromClipIndex: number; toClipIndex: number; type: string; durationMs: number; direction?: "left" | "right" | "up" | "down" };

// The LTX-style 7-tile library. "None" = the ABSENCE of an entry (never stored).
const TRANSITION_TILES = ["None", "Fade", "Slide", "Wipe", "Flip", "Clock Wipe", "Iris"] as const;
const TILE_TO_TYPE: Record<string, string | null> = {
  None: null, Fade: "fade", Slide: "slide", Wipe: "wipe", Flip: "flip", "Clock Wipe": "clockwipe", Iris: "iris",
};
const DEFAULT_TRANSITION_MS = 500;

/** A blank cut so the editor (and its Assets panel) renders for an empty project
 *  that still has media to drop in — the artlioEdit contract (≥1 clip) is only
 *  enforced at export, so an empty timeline edits fine. */
const EMPTY_EDIT: ArtlioEdit = {
  timeline: { background: "#000000", tracks: [{ clips: [] }] },
  output: { format: "mp4", resolution: "hd", aspectRatio: "16:9", fps: 25 },
};

// right Inspector (selected-clip transition + audio) styles
const inspRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, font: "var(--text-caption)", color: "var(--fg-1)", cursor: "pointer" };
const inspHint: React.CSSProperties = { font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 };
const inspMute: React.CSSProperties = { font: "var(--text-caption)", color: "var(--fg-2)", background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "5px 8px", cursor: "pointer" };

export function Editor({
  projectId,
  boardEdit,
  savedEdit,
  attachedCount,
  onDirtyChange,
}: {
  projectId: string;
  /** rebuilt from the shot board every load */
  boardEdit: ArtlioEdit | null;
  /** the persisted working cut (Project.editJson), wins when present */
  savedEdit: ArtlioEdit | null;
  attachedCount: number;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const studioRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const handles = useRef<StudioHandles | null>(null);
  const initialEdit = savedEdit ?? boardEdit;
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [dirty, setDirtyState] = useState(false);
  const loadedFrom: "board" | "saved" = savedEdit ? "saved" : "board";
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [liveIssue, setLiveIssue] = useState<string | null>(null);
  const setDirty = (d: boolean) => {
    setDirtyState(d);
    onDirtyChange(d);
  };

  // the timeline-selected clip, for the right Inspector (transition + audio)
  const [selected, setSelected] = useState<Selection | null>(null);

  // EP1 between-clip transitions live OUTSIDE the Shotstack Edit — Shotstack's
  // schema has no track-level transition and strips unknown fields, so this
  // Artlio-owned array is merged into the ArtlioEdit at snapshot()/save time.
  // Keyed by fromClipIndex on the visual track (track 0).
  const [transitions, setTransitionsState] = useState<UiTransition[]>(
    () => (initialEdit?.timeline.tracks[0] as { transitions?: UiTransition[] } | undefined)?.transitions ?? [],
  );
  // The SAME transitions, mirrored in a ref so closures that capture this effect
  // (the edit:changed listener, currentMergedEdit, commitTransitions) always read
  // the CURRENT value — never the state captured when the effect mounted. A later
  // snap reload that re-seeded from stale state would otherwise wipe live
  // transitions. ALL writes go through setTransitions, which keeps both in sync.
  const transitionsRef = useRef<UiTransition[]>(transitions);
  const setTransitions = (next: UiTransition[] | ((prev: UiTransition[]) => UiTransition[])) => {
    const value = typeof next === "function" ? next(transitionsRef.current) : next;
    transitionsRef.current = value;
    setTransitionsState(value);
  };
  // the visual track's clip list as it was at the LAST snapshot/reload — the
  // "before" side for reconcileTransitions when a NATIVE Shotstack edit
  // (drag-reorder / trim) fires edit:changed. Updated on every reload and after
  // each reconcile so a sequence of native edits maps incrementally.
  const prevClipsRef = useRef<ArtlioClip[]>(
    (initialEdit?.timeline.tracks[0]?.clips as ArtlioClip[] | undefined) ?? [],
  );
  // the clip boundary the user is editing (the transition AFTER clip N → N+1)
  const [boundary, setBoundary] = useState<number | null>(null);

  // EP2 ONE authoritative history. Shotstack's own undo()/redo() is bypassed (its
  // keyboard handler is preempted, see the capture-phase listener below) — it only
  // records Shotstack-issued commands and can't see our custom split/ripple ops, so
  // two stacks = two sources of truth. We keep one. `committedRef` is the last
  // SETTLED parsed edit; `commitState` is the SINGLE place history grows and is
  // idempotent (a no-op when the new edit equals committedRef), so the same change
  // recorded by both an explicit op and the debounced observer counts exactly once.
  const HISTORY_MAX = 50;
  const undoStack = useRef<ArtlioEdit[]>([]);
  const redoStack = useRef<ArtlioEdit[]>([]);
  const committedRef = useRef<ArtlioEdit | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncHistoryButtons = () => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  };
  // true while OUR loadEdit (split/ripple/undo/redo/snap reload) is driving the
  // editor, so the debounced edit:changed observer ignores the reload it triggers.
  // Best-effort only: commitState's idempotency is the real guard against a leak.
  const selfReload = useRef(false);
  // the pending edit:changed debounce timer, in a ref so flushNative() (which
  // settles a native edit synchronously) can CANCEL the redundant late observer
  // pass before an explicit op reloads — otherwise it could fire mid-loadEdit.
  const editChangedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // SERIALIZES editing/persisting commands. Every user command checks it at entry and
  // bails if set, then holds it across its async body — so no command can interleave at
  // another's await point (e.g. split running while export awaits save, or ⌘Z twice
  // fast) and read/commit a half-loaded edit. A synchronous ref (React state lags in
  // long-lived closures). Distinct from selfReload, which only tells the observer to
  // ignore OUR loadEdit's edit:changed.
  const opLock = useRef(false);
  // set just before an INTENTIONAL location.reload() (resetToBoard) so the dirty
  // beforeunload guard doesn't prompt — we're deliberately reloading after a save.
  const intentionalReload = useRef(false);

  // editor Assets panel: the project's generated media, clickable to add to the cut
  const [media, setMedia] = useState<EditorClip[]>([]);
  const [dropping, setDropping] = useState(false); // dragging an Assets item over the timeline
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale media on a project switch (don't show/append another project's clips)
    setMedia([]);
    getEditorMedia(projectId).then((m) => { if (alive) setMedia(m); }).catch(() => {});
    return () => { alive = false; };
  }, [projectId]);
  // start with a blank cut if there's no board/saved cut but there IS media to add
  const startEdit = initialEdit ?? (media.length > 0 ? EMPTY_EDIT : null);

  // refresh/close with an unsaved cut → browser-native confirm (mirrors Composer)
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { if (!intentionalReload.current) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // EP2 keyboard: undo/redo + split + ripple-delete. Registered in the CAPTURE
  // phase on window so it runs BEFORE Shotstack's own document keydown listeners
  // (Controls binds ⌘Z→its internal undo and Delete/Backspace→a non-ripple delete,
  // in the bubble phase). For the keys we OWN we stopImmediatePropagation so those
  // SDK handlers never fire — our single-source history + ripple-delete win. Keys
  // we don't own (space, arrows, Home/End…) fall through to the SDK untouched.
  // Skipped while typing in an input/textarea so we never hijack text editing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;
      const own = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (meta && e.key.toLowerCase() === "z") {
        own();
        void (e.shiftKey ? redo() : undo());
      } else if (!meta && (e.key === "s" || e.key === "S")) {
        if (selected) { own(); void splitAtPlayhead(); }
      } else if (!meta && (e.key === "Backspace" || e.key === "Delete")) {
        if (selected) { own(); void rippleDeleteSelected(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, status]);

  // leaving the editor (nav away / unmount) → report clean, so re-entry doesn't
  // prompt on a stale dirty flag (the parent's guard reads this)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirtyChange(false), []);

  useEffect(() => {
    if (!startEdit) return;
    let disposed = false;
    // partial teardown for a cancelled init (StrictMode double-effect /
    // project switch): dispose whatever got constructed so far, in order
    const partials: Array<{ dispose?: () => void }> = [];
    const teardown = () => {
      for (const p of [...partials].reverse()) {
        try {
          p.dispose?.();
        } catch {
          /* already torn down */
        }
      }
      partials.length = 0;
    };

    (async () => {
      try {
        // Studio is browser-only (PixiJS) — import inside the effect, never SSR
        const { Edit, Canvas, Controls, Timeline, UIController } = await import(
          "@shotstack/shotstack-studio"
        );
        if (disposed) return;

        const edit = new Edit(startEdit as never);
        const canvas = new Canvas(edit);
        partials.push(canvas);
        const ui = UIController.create(edit, canvas);
        partials.push(ui);
        await canvas.load();
        if (disposed) return teardown();
        await edit.load();
        if (disposed) return teardown();

        const timeline = new Timeline(edit, timelineRef.current as HTMLElement, {
          resizable: true,
        });
        partials.push(timeline);
        await timeline.load();
        if (disposed) return teardown();

        const controls = new Controls(edit);
        // codex review: Controls leaks its document keyboard listeners — the
        // SDK ships NO teardown API on this class (verified in index.d.ts).
        // The optional call is forward-compat for when they add one; until
        // then a project switch leaves one stale handler behind (known, low
        // impact, tracked in TODOS).
        partials.push({ dispose: () => (controls as unknown as { dispose?: () => void }).dispose?.() });
        await controls.load();
        if (disposed) return teardown();

        // live contract check + snap-on-commit, debounced — surface drift while
        // editing, and after a native trim/move drag re-tile any sub-threshold
        // gap (snapEdit, contract-time; Shotstack exposes no pixel→time map).
        const off = edit.events.on("edit:changed", () => {
          setDirty(true);
          if (selfReload.current) return; // our own loadEdit — already committed
          clearTimeout(editChangedTimer.current);
          editChangedTimer.current = setTimeout(() => {
            void (async () => {
              // a reload or another command is in flight (scheduled before this timer) —
              // skip; running now would read a half-loaded edit. The command commits its
              // own result; flushNative also cancels this timer for command-driven changes.
              if (selfReload.current || opLock.current) return;
              // hold opLock for the WHOLE observer pass (incl. its own reload's await) so a
              // user command can't interleave during the snap reload.
              opLock.current = true;
              try {
                // This fires for changes Shotstack owns: native drag-reorder/trim AND
                // our SDK-routed mutations (addClip / volume / fade). currentMergedEdit
                // reconciles the index-based transitions against the live clips FIRST
                // (so a native reorder/trim can't leave a transition on the wrong cut),
                // then we snap any sub-threshold gap and record ONE history entry.
                const merged = currentMergedEdit();
                if (!merged) return;
                const res = artlioEdit.safeParse(merged);
                setLiveIssue(res.success ? null : res.error.issues[0]?.message ?? "invalid edit");
                if (!res.success) return; // transient invalid — don't commit or snap
                const snapped = snapEdit(res.data);
                const needsReload =
                  JSON.stringify(snapped.timeline.tracks) !== JSON.stringify(res.data.timeline.tracks);
                const settled = needsReload ? snapped : res.data;
                // single-source history: idempotent vs committedRef, so this records a
                // native edit but no-ops if an explicit op already committed the change.
                commitState(settled);
                if (needsReload) {
                  selfReload.current = true;
                  try {
                    await reloadFromEdit(settled); // push the snapped geometry into Shotstack
                  } finally {
                    selfReload.current = false;
                  }
                }
              } finally {
                opLock.current = false;
              }
            })();
          }, 800);
        });
        partials.push({
          dispose: () => {
            clearTimeout(editChangedTimer.current);
            if (typeof off === "function") off();
          },
        });

        // selection → right Inspector (transition + audio for the picked clip)
        const offSel = edit.events.on("clip:selected", (ref) => {
          const r = ref as unknown as Selection | undefined;
          if (r && typeof r.trackIndex === "number") {
            setSelected({ trackIndex: r.trackIndex, clipIndex: r.clipIndex, clip: r.clip ?? {} });
            // a transition lives "after clip N" on the single visual track (track 0);
            // Shotstack's clipIndex matches our sorted-by-start order there.
            if (r.trackIndex === 0 && typeof r.clipIndex === "number") setBoundary(r.clipIndex);
          }
        });
        const offClear = edit.events.on("selection:cleared", () => setSelected(null));
        partials.push({ dispose: () => { if (typeof offSel === "function") offSel(); if (typeof offClear === "function") offClear(); } });

        handles.current = { edit: edit as unknown as StudioEdit, dispose: teardown };
        // baseline the reconcile "before" list from the loaded edit's LIVE clips WITH
        // stable ids (Shotstack assigns them on load + may canonicalize), so the
        // first native edit reconciles by the same identity space the live edit uses.
        prevClipsRef.current =
          (((edit as unknown as StudioEdit).getEdit({ includeIds: true }) as ArtlioEdit).timeline.tracks[0]
            ?.clips as ArtlioClip[]) ?? [];
        // a fresh project/cut starts with no history (don't carry another cut's)
        undoStack.current = [];
        redoStack.current = [];
        committedRef.current = null;
        // seed committedRef with the loaded state (parsed) so the first real change
        // pushes the right "before"; null is fine for an empty (sub-contract) cut.
        {
          const seed = currentMergedEdit();
          const seedParsed = seed ? artlioEdit.safeParse(seed) : null;
          committedRef.current = seedParsed?.success ? seedParsed.data : null;
        }
        syncHistoryButtons();
        setStatus("ready");
      } catch (e) {
        console.error("[editor] studio failed to load", e);
        teardown();
        if (!disposed) setStatus("failed");
      }
    })();

    return () => {
      disposed = true;
      setSelected(null);
      handles.current?.dispose();
      handles.current = null;
      teardown(); // covers a cancelled init that never reached handles
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, startEdit]);

  /** RECONCILE the index-based transitions against the LIVE clips (by stable id) and
   *  return the reconciled set. A native Shotstack reorder/trim re-tiles the clips
   *  but leaves our boundary-INDEXED transitions on the wrong clips; this remaps
   *  them, dropping any whose pair is no longer a gapless-adjacent, long-enough pair.
   *  Called from currentMergedEdit so EVERY consumer (save, ops, undo, the observer)
   *  sees correct indices — never just the debounced path. Advances the baseline. */
  function reconcileNow(): UiTransition[] {
    const h = handles.current;
    if (!h) return transitionsRef.current;
    // identity space: clips WITH stable ids (the only reliable match across a native
    // reorder; asset.src is ambiguous once a split makes two same-src halves).
    const liveIdClips =
      ((h.edit.getEdit({ includeIds: true }) as ArtlioEdit).timeline.tracks[0]?.clips as ArtlioClip[] | undefined) ?? [];
    if (transitionsRef.current.length > 0) {
      const reconciled = reconcileTransitions(
        prevClipsRef.current,
        liveIdClips,
        transitionsRef.current as never,
      ) as unknown as UiTransition[];
      if (JSON.stringify(reconciled) !== JSON.stringify(transitionsRef.current)) {
        setTransitions(reconciled); // wrapper updates ref synchronously
      }
    }
    prevClipsRef.current = liveIdClips;
    return transitionsRef.current;
  }

  /** The live Shotstack edit MERGED with the (reconciled) React transitions, NO
   *  parse — the object the ops, save, and history all consume. The merge reads the
   *  id-FREE getEdit() so no SDK id leaks into the persisted contract; transitions
   *  are reconciled first (reconcileNow) so the indices match the live clips. */
  function currentMergedEdit(): ArtlioEdit | null {
    const h = handles.current;
    if (!h) return null;
    const live = reconcileNow(); // reconcile BEFORE merging (covers save/op/undo)
    const raw = h.edit.getEdit() as ArtlioEdit; // id-free — what we persist
    // UiTransition.type is a loose `string` (the tile→type map); the contract
    // narrows it at parse time. Consumers always safeParse / feed an op that
    // re-parses, so cast the pre-parse merge to ArtlioEdit.
    const merged = {
      ...raw,
      timeline: {
        ...raw.timeline,
        tracks: raw.timeline.tracks.map((t, i) =>
          i === 0 && live.length > 0 ? { ...t, transitions: live } : t,
        ),
      },
    };
    return merged as unknown as ArtlioEdit;
  }

  function snapshot(): { edit?: ArtlioEdit; error?: string } {
    const merged = currentMergedEdit();
    if (!merged) return { error: "Editor not ready yet." };
    const result = artlioEdit.safeParse(merged);
    if (!result.success) {
      const first = result.error.issues[0];
      return {
        error: `${first?.message ?? "invalid edit"}${first?.path?.length ? ` (at ${first.path.join(".")})` : ""}`,
      };
    }
    return { edit: result.data };
  }

  /** The SINGLE place history grows. Records the transition committedRef → `next`
   *  iff they differ (idempotent), so a change recorded by BOTH an explicit op and
   *  the debounced observer counts exactly once. `next` is always already PARSED, so
   *  the stacks can never hold an out-of-contract edit (fixes the prior unparsed-push
   *  bug). Bounded; a new entry clears the redo branch. */
  function commitState(next: ArtlioEdit): void {
    const prev = committedRef.current;
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) return; // no real change
    if (prev) {
      undoStack.current.push(prev);
      if (undoStack.current.length > HISTORY_MAX) undoStack.current.shift();
    }
    redoStack.current = [];
    committedRef.current = next;
    syncHistoryButtons();
  }

  /** FLUSH a pending native edit (a drag/trim whose 800ms observer hasn't fired yet)
   *  into history BEFORE any explicit op acts, and return the current settled, parsed
   *  baseline. This reconciles the transitions to the live clips (via currentMergedEdit
   *  → reconcileNow, which also advances prevClipsRef) and records the pending change
   *  as its OWN history entry — so a native edit followed immediately by a split keeps
   *  two undo steps, and a transition added after a native reorder is built in the
   *  CURRENT index space (fixes the two stale-baseline races). Idempotent when nothing
   *  is pending (commitState no-ops). Returns null (and surfaces the issue) if the live
   *  edit is momentarily out of contract — the caller must bail. */
  function flushNative(): ArtlioEdit | null {
    // never read/commit live Shotstack state while OUR reload is in flight — the edit
    // is half-loaded. Callers treat null as "busy, try again" and bail. (Re-entrancy
    // guard: a second command landing during reloadFromEdit's await.)
    if (selfReload.current) return null;
    // we're settling the native edit synchronously here — cancel the redundant late
    // observer pass so it can't fire mid-reload and commit a half-loaded edit.
    clearTimeout(editChangedTimer.current);
    const merged = currentMergedEdit(); // reconciles + advances prevClipsRef
    if (!merged) return null;
    const res = artlioEdit.safeParse(merged);
    if (!res.success) {
      setLiveIssue(res.error.issues[0]?.message ?? "invalid edit");
      return null;
    }
    setLiveIssue(null);
    commitState(res.data); // record any pending native/SDK change (idempotent if none)
    return res.data;
  }

  /** Commit a NEW transitions set. Transitions live in React (not Shotstack) so they
   *  fire NO edit:changed — the debounced observer can't capture them, so we record
   *  here explicitly: build the merged edit with `next`, parse, commitState, then
   *  apply to state. Skips (with a notice) if the result would be out of contract.
   *  CALLER CONTRACT: call flushNative() first so transitionsRef + prevClipsRef are in
   *  the current (post-native-edit) index space before `next` is computed. */
  function commitTransitions(next: UiTransition[]): void {
    const h = handles.current;
    if (!h) return;
    const raw = h.edit.getEdit() as ArtlioEdit;
    const merged = {
      ...raw,
      timeline: {
        ...raw.timeline,
        tracks: raw.timeline.tracks.map((t, i) =>
          i === 0 && next.length > 0 ? { ...t, transitions: next } : t,
        ),
      },
    } as unknown as ArtlioEdit;
    const parsed = artlioEdit.safeParse(merged);
    if (!parsed.success) {
      setNotice({ tone: "warn", text: parsed.error.issues[0]?.message ?? "invalid transition" });
      return; // don't apply an out-of-contract transition
    }
    commitState(parsed.data);
    setTransitions(next);
    setDirty(true);
  }

  /** load a post-op ArtlioEdit into the live editor: hot-reload Shotstack with the
   *  clips/output, re-seed the React transition state (Shotstack strips track-level
   *  transitions), and re-baseline prevClipsRef from the LIVE clips' fresh stable ids
   *  (Shotstack re-ids on loadEdit) so the next native edit reconciles correctly. The
   *  caller sets selfReload around this so the reload's edit:changed is ignored. */
  async function reloadFromEdit(next: ArtlioEdit) {
    const h = handles.current;
    if (!h) return;
    await h.edit.loadEdit(next);
    const nextTransitions = (next.timeline.tracks[0] as { transitions?: UiTransition[] } | undefined)?.transitions ?? [];
    setTransitions(nextTransitions);
    prevClipsRef.current =
      ((h.edit.getEdit({ includeIds: true }) as ArtlioEdit).timeline.tracks[0]?.clips as ArtlioClip[] | undefined) ?? [];
    setDirty(true);
  }

  async function undo() {
    if (opLock.current) return; // another command is in flight — serialize
    opLock.current = true;
    try {
      flushNative(); // a pending native edit becomes its OWN undo step before we pop
      if (undoStack.current.length === 0) return;
      const prev = undoStack.current.pop()!;
      if (committedRef.current) redoStack.current.push(committedRef.current); // already parsed
      committedRef.current = prev;
      syncHistoryButtons();
      selfReload.current = true;
      try {
        await reloadFromEdit(prev);
      } finally {
        selfReload.current = false;
      }
    } finally {
      opLock.current = false;
    }
  }
  async function redo() {
    if (opLock.current) return; // another command is in flight — serialize
    opLock.current = true;
    try {
      flushNative(); // a pending native edit clears the redo branch (recorded as new history)
      if (redoStack.current.length === 0) return; // flush may have just emptied it
      const next = redoStack.current.pop()!;
      if (committedRef.current) undoStack.current.push(committedRef.current); // already parsed
      committedRef.current = next;
      syncHistoryButtons();
      selfReload.current = true;
      try {
        await reloadFromEdit(next);
      } finally {
        selfReload.current = false;
      }
    } finally {
      opLock.current = false;
    }
  }

  // append a project asset to the visual track (track 0) at the current end
  async function appendAsset(clip: EditorClip) {
    const h = handles.current;
    if (!h || status !== "ready" || opLock.current) return; // serialize: no edits mid-op
    const cur = h.edit.getEdit() as ArtlioEdit;
    const track0 = cur.timeline.tracks[0]?.clips ?? [];
    const end = track0.reduce((m, c) => Math.max(m, c.start + c.length), 0);
    opLock.current = true;
    try {
      await h.edit.addClip(0, { asset: { type: clip.kind, src: clip.src }, start: end, length: clip.seconds });
      flushNative(); // commit deterministically now — don't depend on the observer (which we hold off)
    } catch (e) {
      console.error("[editor] addClip failed", e);
    } finally {
      opLock.current = false;
    }
  }

  // Inspector: patch the selected clip via the SDK, then re-read the AUTHORITATIVE
  // edit and reflect that — never an optimistic guess. The SDK may not honor
  // `transition: undefined` as a delete, so the panel must show what was actually
  // applied (else a stale checkbox lies about the cut).
  function syncSelectedFromEdit(trackIndex: number, clipIndex: number) {
    const h = handles.current;
    if (!h) return;
    const cur = h.edit.getEdit() as ArtlioEdit;
    const real = cur.timeline.tracks[trackIndex]?.clips[clipIndex];
    if (real) setSelected({ trackIndex, clipIndex, clip: real as SelClip });
  }
  async function applyTransition(nextIn: boolean, nextOut: boolean) {
    const h = handles.current;
    if (!h || status !== "ready" || !selected || opLock.current) return; // serialize: no edits mid-op
    const { trackIndex, clipIndex } = selected;
    const transition = nextIn || nextOut ? { in: nextIn ? "fade" : undefined, out: nextOut ? "fade" : undefined } : undefined;
    opLock.current = true;
    try {
      await h.edit.updateClip(trackIndex, clipIndex, { transition });
      syncSelectedFromEdit(trackIndex, clipIndex);
      flushNative(); // commit deterministically now — don't depend on the observer (which we hold off)
    } catch (e) {
      console.error("[editor] set transition failed", e);
    } finally {
      opLock.current = false;
    }
  }
  async function applyVolume(v: number) {
    const h = handles.current;
    if (!h || status !== "ready" || !selected || opLock.current) return; // serialize: no edits mid-op
    const { trackIndex, clipIndex } = selected;
    // patch volume onto the REAL asset (preserve type/src/trim) — rebuilding from
    // the selection snapshot could replace it with a partial and break export
    const cur = h.edit.getEdit() as ArtlioEdit;
    const real = cur.timeline.tracks[trackIndex]?.clips[clipIndex];
    if (!real) return;
    const asset = { ...real.asset, volume: v };
    opLock.current = true;
    try {
      await h.edit.updateClip(trackIndex, clipIndex, { asset });
      syncSelectedFromEdit(trackIndex, clipIndex);
      flushNative(); // commit deterministically now — don't depend on the observer (which we hold off)
    } catch (e) {
      console.error("[editor] set volume failed", e);
    } finally {
      opLock.current = false;
    }
  }

  // ---- EP1 between-clip transitions (Artlio state, outside Shotstack) ----
  // Set or update the transition on the selected boundary. "None" removes it.
  function setBoundaryTransition(tile: string) {
    if (boundary == null) return;
    if (opLock.current) return; // another command is in flight — serialize
    if (!flushNative()) return; // reconcile to current indices + record any pending native edit
    const type = TILE_TO_TYPE[tile];
    const prev = transitionsRef.current; // now reconciled to the live clip order
    const rest = prev.filter((t) => t.fromClipIndex !== boundary);
    let next: UiTransition[];
    if (!type) {
      next = rest; // "None" = remove the entry
    } else {
      const existing = prev.find((t) => t.fromClipIndex === boundary);
      next = [
        ...rest,
        { fromClipIndex: boundary, toClipIndex: boundary + 1, type, durationMs: existing?.durationMs ?? DEFAULT_TRANSITION_MS },
      ];
    }
    commitTransitions(next); // state-only change → record history explicitly
  }
  // Adjust the duration (ms) of the transition on the selected boundary.
  function setBoundaryDuration(durationMs: number) {
    if (boundary == null) return;
    if (opLock.current) return; // another command is in flight — serialize
    if (!flushNative()) return; // reconcile to current indices + record any pending native edit
    const next = transitionsRef.current.map((t) => (t.fromClipIndex === boundary ? { ...t, durationMs } : t));
    commitTransitions(next); // state-only change → record history explicitly
  }
  function clearAllTransitions() {
    if (transitionsRef.current.length === 0) return; // nothing to clear → no history entry
    if (opLock.current) return; // another command is in flight — serialize
    if (!flushNative()) return; // reconcile to current indices + record any pending native edit
    commitTransitions([]); // state-only change → record history explicitly
  }

  // ---- EP2 editing-feel gestures (pure contract ops + reload) ----
  // Split the selected visual clip at the transport playhead.
  async function splitAtPlayhead() {
    if (opLock.current) return; // another command is in flight — serialize
    const h = handles.current;
    if (!h || status !== "ready" || !selected || selected.trackIndex !== 0) {
      setNotice({ tone: "warn", text: "Select a clip on the video track, move the playhead into it, then split." });
      return;
    }
    opLock.current = true;
    try {
      const at = h.edit.playbackTime; // seconds on the timeline
      // flush any pending native edit into history FIRST (its own undo step) and get the
      // settled, reconciled baseline; compute the split from THAT, not a stale snapshot.
      const base = flushNative();
      if (!base) { setNotice({ tone: "warn", text: "The cut isn't valid yet — fix it before splitting." }); return; }
      // compute the next edit (may throw → no history change), then record + reload.
      // The op re-parses, so `next` is always in contract; selfReload keeps its
      // reload's edit:changed from double-recording.
      const next = splitClipAt(base, selected.trackIndex, selected.clipIndex, at);
      commitState(next);
      selfReload.current = true;
      try {
        await reloadFromEdit(next);
      } finally {
        selfReload.current = false;
      }
      setNotice({ tone: "ok", text: "Clip split at the playhead." });
    } catch (e) {
      setNotice({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't split there." });
    } finally {
      opLock.current = false;
    }
  }

  // Ripple-delete the selected visual clip (remove + close the gap).
  async function rippleDeleteSelected() {
    if (opLock.current) return; // another command is in flight — serialize
    const h = handles.current;
    if (!h || status !== "ready" || !selected || selected.trackIndex !== 0) {
      setNotice({ tone: "warn", text: "Select a clip on the video track to ripple-delete it." });
      return;
    }
    opLock.current = true;
    try {
      // flush any pending native edit into history FIRST (its own undo step) and get the
      // settled, reconciled baseline; compute the ripple-delete from THAT.
      const base = flushNative();
      if (!base) { setNotice({ tone: "warn", text: "The cut isn't valid yet — fix it before removing a clip." }); return; }
      const next = rippleDeleteClip(base, selected.trackIndex, selected.clipIndex);
      commitState(next);
      selfReload.current = true;
      try {
        await reloadFromEdit(next);
      } finally {
        selfReload.current = false;
      }
      setSelected(null);
      setBoundary(null);
      setNotice({ tone: "ok", text: "Clip removed; the gap was closed." });
    } catch (e) {
      setNotice({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't remove that clip." });
    } finally {
      opLock.current = false;
    }
  }
  // Re-lay the visual track so clips tile from 0 (closes a legacy gap so a
  // transition's gapless-adjacency requirement passes). Pure client-side; the
  // user then saves. This is the global-gap handling the contract leaves to the
  // UI — the contract only enforces gaplessness locally, per placed transition.
  async function closeGaps() {
    const h = handles.current;
    if (!h || status !== "ready" || opLock.current) return; // serialize: no edits mid-op
    const cur = h.edit.getEdit() as ArtlioEdit;
    const t0 = cur.timeline.tracks[0]?.clips ?? [];
    const ordered = [...t0].sort((a, b) => a.start - b.start);
    // is there any gap to close? (don't push a no-op history entry)
    let probe = 0;
    const hasGap = ordered.some((c) => { const g = Math.abs(c.start - probe) > 1e-6; probe += c.length; return g; });
    if (!hasGap) { setNotice({ tone: "ok", text: "No gaps to close." }); return; }
    // Shotstack-routed (updateClip) → the debounced observer records it via commitState
    opLock.current = true;
    try {
      let cursor = 0;
      for (const c of ordered) {
        if (Math.abs(c.start - cursor) > 1e-6) {
          await h.edit.updateClip(0, t0.indexOf(c), { start: cursor }).catch(() => {});
        }
        cursor += c.length;
      }
      flushNative(); // commit deterministically now — don't depend on the observer (which we hold off)
      setNotice({ tone: "ok", text: "Gaps closed — save the cut." });
    } finally {
      opLock.current = false;
    }
  }

  const [busy, setBusy] = useState(false);

  /** persist a PRE-VALIDATED edit. Unlocked — the caller (saveCut/exportCut) already
   *  holds opLock and took the snapshot, so this never re-reads live Shotstack state. */
  async function persistEdit(edit: ArtlioEdit): Promise<boolean> {
    setBusy(true);
    try {
      const res = await saveProjectEdit(projectId, JSON.stringify(edit));
      if (res && "error" in res && res.error) {
        setNotice({ tone: "warn", text: res.error });
        return false;
      }
      setDirty(false);
      return true;
    } catch {
      setNotice({ tone: "warn", text: "Save failed — check your connection and retry." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveCut(): Promise<boolean> {
    if (opLock.current) { setNotice({ tone: "warn", text: "Editor is updating — try saving again in a moment." }); return false; }
    opLock.current = true;
    try {
      flushNative(); // commit any pending native edit to history + cancel the observer timer
      const { edit, error } = snapshot(); // snapshot under the lock — never half-loaded
      if (error || !edit) {
        setNotice({ tone: "warn", text: error ? `Out of contract: ${error}` : "Editor not ready yet." });
        return false;
      }
      const ok = await persistEdit(edit);
      if (ok) {
        setNotice({ tone: "ok", text: "Cut saved." });
        setTimeout(() => setNotice(null), 2200);
      }
      return ok;
    } finally {
      opLock.current = false;
    }
  }

  async function exportCut() {
    if (opLock.current) { setNotice({ tone: "warn", text: "Editor is updating — try exporting again in a moment." }); return; }
    opLock.current = true;
    try {
      // commit any pending native edit, then snapshot ONCE under the lock and save+render
      // that EXACT edit — no re-read after an await (which could pick up a half-loaded edit).
      // Export renders what is SAVED, so persist first when dirty.
      flushNative(); // commit any pending native edit to history + cancel the observer timer
      const { edit, error } = snapshot();
      if (error || !edit) { setNotice({ tone: "warn", text: error ? `Out of contract: ${error}` : "Editor not ready yet." }); return; }
      if (dirty) {
        const ok = await persistEdit(edit);
        if (!ok) return;
      }
      setBusy(true);
      try {
        const res = await startRender(projectId, JSON.stringify(edit));
        if (res && "error" in res && res.error) setNotice({ tone: "warn", text: res.error });
        else {
          setNotice({ tone: "ok", text: "Render queued — progress below." });
          setTimeout(() => setNotice(null), 2600);
          setJobsTick((t) => t + 1); // poll immediately
        }
      } catch {
        setNotice({ tone: "warn", text: "Export failed — check your connection and retry." });
      } finally {
        setBusy(false);
      }
    } finally {
      opLock.current = false;
    }
  }

  async function resetToBoard() {
    if (!boardEdit) return;
    if (opLock.current) { setNotice({ tone: "warn", text: "Editor is updating — try again in a moment." }); return; }
    if (!confirm("Replace the saved cut with a fresh one built from the shot board?")) return;
    opLock.current = true; // serialize with save/export/edits — a single last-writer race otherwise
    setBusy(true);
    try {
      const res = await saveProjectEdit(projectId, JSON.stringify(boardEdit));
      if (res && "error" in res && res.error) setNotice({ tone: "warn", text: res.error });
      else {
        // we just persisted boardEdit; the live editor still shows the old cut, so
        // suppress the dirty unload prompt for this intentional reload.
        intentionalReload.current = true;
        setDirty(false);
        location.reload();
      }
    } finally {
      setBusy(false);
      opLock.current = false;
    }
  }

  // ---- render jobs strip (polls while anything is active) ----
  type JobRow = Awaited<ReturnType<typeof getRenderJobs>>[number];
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsTick, setJobsTick] = useState(0);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const rows = await getRenderJobs(projectId);
        if (stop) return;
        setJobs(rows);
        const active = rows.some((r) => r.status === "QUEUED" || r.status === "RENDERING");
        timer = setTimeout(poll, active ? 2500 : 15000);
      } catch {
        if (!stop) timer = setTimeout(poll, 10000);
      }
    };
    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [projectId, jobsTick]);

  if (!startEdit) {
    return (
      <div className="screen">
        <div className="screen-pad" style={{ display: "flex", justifyContent: "center", paddingTop: 70 }}>
          <EmptyHero
            title="Nothing to cut yet"
            desc="Generate a clip in Gen space (or a shot in the Storyboard) and it lands here — then trim, reorder, and export."
          >
            <Link href={`/studio?p=${projectId}`}>
              <Button>Go to Gen space</Button>
            </Link>
          </EmptyHero>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "0 18px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px 12px", flexWrap: "wrap" }}>
        <MonoLabel>Assembly cut</MonoLabel>
        <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>
          {loadedFrom === "saved"
            ? "saved cut loaded"
            : `${attachedCount} clip${attachedCount === 1 ? "" : "s"} from the board`}
        </span>
        {loadedFrom === "saved" && boardEdit && (
          <button
            onClick={resetToBoard}
            disabled={busy}
            style={{
              font: "var(--text-caption)", color: "var(--fg-2)", background: "none",
              border: "none", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3,
            }}
          >
            Reset to board
          </button>
        )}
        {dirty && <span style={{ font: "var(--text-mono-meta)", color: "var(--warning)" }}>unsaved</span>}
        {liveIssue && (
          <span role="status" style={{ font: "var(--text-small)", color: "var(--warning)" }}>
            Out of contract: {liveIssue}
          </span>
        )}
        {notice && (
          <span
            role="status"
            style={{ font: "var(--text-small)", color: notice.tone === "ok" ? "var(--positive)" : "var(--warning)" }}
          >
            {notice.text}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Chip mono interactive={false} title="The render target. Phase 2 adds your own templates and APIs.">
          Target · worker ffmpeg
        </Chip>
        <Button variant="glass" size="sm" onClick={saveCut} disabled={status !== "ready" || !dirty || busy}>
          {busy ? "Working…" : "Save cut"}
        </Button>
        <Button variant="glass" size="sm" onClick={undo} disabled={status !== "ready" || !canUndo || busy} title="Undo (⌘Z)">
          Undo
        </Button>
        <Button variant="glass" size="sm" onClick={redo} disabled={status !== "ready" || !canRedo || busy} title="Redo (⇧⌘Z)">
          Redo
        </Button>
        <Button variant="glass" size="sm" onClick={splitAtPlayhead} disabled={status !== "ready" || !selected || busy} title="Split selected clip at the playhead (S)">
          Split
        </Button>
        <Button variant="glass" size="sm" onClick={rippleDeleteSelected} disabled={status !== "ready" || !selected || busy} title="Ripple-delete selected clip (⌫)">
          Ripple delete
        </Button>
        {notice?.tone === "warn" && /gapless|gap|tile|contiguous/i.test(notice.text) && (
          <Button variant="glass" size="sm" onClick={closeGaps} disabled={status !== "ready" || busy}>
            Close gaps
          </Button>
        )}
        <Button size="sm" onClick={exportCut} disabled={status !== "ready" || busy}>
          Export MP4
        </Button>
      </div>

      {status === "failed" ? (
        <div className="al-panel" style={{ padding: 24 }}>
          <p style={{ font: "var(--text-body)", color: "var(--danger)", margin: 0 }}>
            The editor failed to load — check the console, then reload the page.
          </p>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 12 }}>
          {/* Assets panel — click a clip to append it to the cut */}
          <aside style={{ width: 220, flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--line-2)", borderRadius: "var(--radius-lg)", overflow: "hidden", maxHeight: "100%" }}>
            <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--line-2)", flex: "none" }}><MonoLabel>Assets</MonoLabel></div>
            <div style={{ flex: 1, overflow: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {media.length === 0 ? (
                <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>No media yet — generate in Gen space, then click a clip here to add it to the cut.</p>
              ) : media.map((m) => (
                <button key={m.id} onClick={() => appendAsset(m)} title="Add to the cut, or drag onto the timeline" disabled={status !== "ready"}
                  draggable onDragStart={(e) => setDnd(e.dataTransfer, { kind: "editor-clip", src: m.src, clipKind: m.kind, seconds: m.seconds })}
                  style={{ position: "relative", border: "1px solid var(--line-2)", borderRadius: "var(--radius-md)", overflow: "hidden", background: "#000", aspectRatio: "16 / 10", cursor: "pointer", padding: 0 }}>
                  {m.kind === "video"
                    ? <video src={m.src} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={m.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  <span aria-hidden style={{ position: "absolute", top: 4, left: 4, width: 18, height: 18, display: "grid", placeItems: "center", borderRadius: 4, background: "rgba(0,0,0,.6)", color: "#fff", font: "var(--text-mono-meta)" }}>+</span>
                  <span style={{ position: "absolute", bottom: 4, right: 4, font: "var(--text-mono-meta)", color: "#fff", background: "rgba(0,0,0,.6)", padding: "0 5px", borderRadius: 3 }}>{m.kind === "video" ? `${Math.round(m.seconds)}s` : "img"}</span>
                </button>
              ))}
            </div>
          </aside>
          {/* Transitions tab — applies to a selected clip boundary; lives outside Shotstack */}
          <aside style={{ width: 200, flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--line-2)", borderRadius: "var(--radius-lg)", overflow: "hidden", maxHeight: "100%" }}>
            <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "space-between", flex: "none" }}>
              <MonoLabel>Transitions</MonoLabel>
              <button onClick={clearAllTransitions} disabled={transitions.length === 0}
                style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", background: "none", border: "none", cursor: transitions.length ? "pointer" : "default", textDecoration: "underline", textUnderlineOffset: 3 }}>
                Clear all
              </button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {boundary == null ? (
                <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>Pick a clip on the timeline, then choose a transition for the cut after it.</p>
              ) : (() => {
                const active = transitions.find((t) => t.fromClipIndex === boundary);
                return (
                  <>
                    <p style={{ font: "var(--text-caption)", color: "var(--fg-2)", margin: "0 0 2px" }}>Between clip {boundary + 1} and {boundary + 2}</p>
                    {TRANSITION_TILES.map((tile) => {
                      const isOn = (TILE_TO_TYPE[tile] ?? null) === (active?.type ?? null);
                      return (
                        <button key={tile} onClick={() => setBoundaryTransition(tile)}
                          style={{ textAlign: "left", font: "var(--text-caption)", color: isOn ? "var(--fg-0)" : "var(--fg-1)", background: isOn ? "var(--glass-2)" : "var(--glass-1)", border: `1px solid ${isOn ? "var(--line-1)" : "var(--line-2)"}`, borderRadius: "var(--radius-sm)", padding: "7px 10px", cursor: "pointer" }}>
                          {tile}
                        </button>
                      );
                    })}
                    {active && (
                      <section style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <MonoLabel>Duration</MonoLabel>
                          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>{(active.durationMs / 1000).toFixed(1)}s</span>
                        </div>
                        <input type="range" min={100} max={2000} step={100} value={active.durationMs}
                          onChange={(e) => setBoundaryDuration(Number(e.target.value))} style={{ width: "100%" }} aria-label="Transition duration" />
                        <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>Must be ≤ half the shorter adjacent clip.</p>
                      </section>
                    )}
                  </>
                );
              })()}
            </div>
          </aside>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div
            ref={studioRef}
            data-shotstack-studio
            className="al-panel"
            style={{ flex: 1, minHeight: 240, overflow: "hidden", borderRadius: "var(--radius-lg)" }}
          />
          {transitions.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 0", alignItems: "center" }} aria-label="Active transitions">
              <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-4)" }}>cuts:</span>
              {[...transitions].sort((a, b) => a.fromClipIndex - b.fromClipIndex).map((t) => (
                <button key={t.fromClipIndex} onClick={() => setBoundary(t.fromClipIndex)} title="Edit this transition"
                  style={{ font: "var(--text-mono-meta)", color: boundary === t.fromClipIndex ? "var(--fg-0)" : "var(--fg-2)", background: boundary === t.fromClipIndex ? "var(--glass-2)" : "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: 99, padding: "2px 8px", cursor: "pointer" }}>
                  {t.fromClipIndex + 1}↔{t.toClipIndex + 1}: {t.type}{t.direction ? ` ${t.direction}` : ""}
                </button>
              ))}
            </div>
          )}
          <div
            ref={timelineRef}
            data-shotstack-timeline
            data-dnd="timeline"
            onDragOver={(e) => { if (hasDnd(e.dataTransfer, "editor-clip") && status === "ready") { e.preventDefault(); setDropping(true); } }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => {
              e.preventDefault(); setDropping(false);
              const payload = getDnd(e.dataTransfer);
              if (payload?.kind === "editor-clip" && handles.current && status === "ready") {
                void appendAsset({ id: "", src: payload.src, kind: payload.clipKind, seconds: payload.seconds });
              }
            }}
            style={{
              height: 280,
              overflow: "hidden",
              marginTop: 12,
              borderRadius: "var(--radius-lg)",
              border: `1px solid ${dropping ? "rgba(120,160,255,.7)" : "var(--line-2)"}`,
            }}
          />
          {jobs.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }} aria-label="Renders">
              <MonoLabel>Renders</MonoLabel>
              {jobs.map((j) => (
                <div key={j.id} className="glass-chip" style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: "var(--radius-md)", padding: "8px 12px" }}>
                  <span className="mono-label" style={{ color: j.status === "FAILED" ? "var(--danger)" : j.status === "DONE" ? "var(--positive)" : "var(--fg-2)" }}>
                    {j.status}
                  </span>
                  {(j.status === "QUEUED" || j.status === "RENDERING") && (
                    <span style={{ flex: 1, height: 4, borderRadius: 99, background: "rgba(255,255,255,.08)", overflow: "hidden" }} aria-label={`progress ${j.progress}%`}>
                      <span style={{ display: "block", height: "100%", width: `${j.progress}%`, background: "linear-gradient(90deg, rgba(255,255,255,.55), #fff)", transition: "width .4s var(--ease-out)" }} />
                    </span>
                  )}
                  {j.status === "FAILED" && (
                    <span style={{ flex: 1, font: "var(--text-small)", color: "var(--danger)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={j.error}>
                      {j.error || "render failed"} — fix the cut and export again
                    </span>
                  )}
                  {j.status === "DONE" && j.url && (
                    <>
                      <span style={{ flex: 1 }} />
                      <a href={j.url} download style={{ font: "var(--text-small)", color: "var(--fg-1)", textDecoration: "underline", textUnderlineOffset: 3 }}>
                        Download MP4
                      </a>
                    </>
                  )}
                  {j.status === "DONE" && !j.url && (
                    <span style={{ flex: 1, font: "var(--text-small)", color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      Render finished — file not ready yet, reload to fetch it
                    </span>
                  )}
                  <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-4)" }} suppressHydrationWarning>
                    {new Date(j.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
          </div>
          {selected && (() => {
            const type = selected.clip.asset?.type;
            const isVisual = type === "video" || type === "image";
            const hasAudio = type === "video"; // generated videos carry native sound; images are silent
            const fadeIn = !!selected.clip.transition?.in;
            const fadeOut = !!selected.clip.transition?.out;
            const volume = selected.clip.asset?.volume ?? 1;
            return (
              <aside style={{ width: 210, flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--line-2)", borderRadius: "var(--radius-lg)", overflow: "hidden", maxHeight: "100%" }}>
                <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--line-2)", flex: "none" }}><MonoLabel>Clip</MonoLabel></div>
                <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 16 }}>
                  {isVisual && (
                    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <MonoLabel>Transition</MonoLabel>
                      <label style={inspRow}><input type="checkbox" checked={fadeIn} onChange={(e) => applyTransition(e.target.checked, fadeOut)} /> Fade in</label>
                      <label style={inspRow}><input type="checkbox" checked={fadeOut} onChange={(e) => applyTransition(fadeIn, e.target.checked)} /> Fade out</label>
                      <p style={inspHint}>0.5s fade to / from black.</p>
                    </section>
                  )}
                  {hasAudio && (
                    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <MonoLabel>Audio</MonoLabel>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => applyVolume(Number(e.target.value) / 100)} style={{ flex: 1 }} aria-label="Clip volume" />
                        <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", width: 34, textAlign: "right" }}>{Math.round(volume * 100)}%</span>
                      </div>
                      <button onClick={() => applyVolume(volume > 0 ? 0 : 1)} style={inspMute}>{volume > 0 ? "Mute clip" : "Unmute clip"}</button>
                    </section>
                  )}
                  {!isVisual && !hasAudio && <p style={inspHint}>This clip has no editable transition or audio.</p>}
                </div>
              </aside>
            );
          })()}
        </div>
      )}
    </div>
  );
}
