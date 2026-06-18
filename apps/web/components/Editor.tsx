"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { artlioEdit, snapEdit, splitClipAt, rippleDeleteClip, reconcileTransitions, editToFcpXml, OVERLAY_POSITIONS, type ArtlioEdit, type ArtlioClip, type CaptionCue, type TextOverlay, type AudioRole } from "@artlio/core";
import { getRenderJobs, saveProjectEdit, startRender, getEditorMedia, startCaption, getCaptionJob, getTranscript } from "@/lib/actions";
import { uploadFilesDirect } from "@/lib/direct-upload";
import { finalizeCandidateUploads } from "@/lib/upload-actions";
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
type EditorClip = { id: string; src: string; kind: "image" | "video" | "audio"; seconds: number };
/** The selected clip, as the SDK's clip:selected event reports it (subset we edit). */
type SelClip = { asset?: { type?: string; src?: string; volume?: number }; transition?: { in?: string; out?: string } };
type Selection = { trackIndex: number; clipIndex: number; clip: SelClip };
/** A between-clip transition, mirroring the contract's betweenClipTransition shape.
 *  Lives in Artlio React state (outside Shotstack) and is merged into the
 *  ArtlioEdit on save. */
type UiTransition = { fromClipIndex: number; toClipIndex: number; type: string; durationMs: number; direction?: "left" | "right" | "up" | "down" };
/** Captions + static text overlays live in Artlio React state (outside Shotstack)
 *  and are merged into the timeline (one level up, NOT on a track) at save — same
 *  round-trip as transitions, since the Shotstack Edit strips unknown fields. */
type UiCaption = CaptionCue;
type UiOverlay = TextOverlay;

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

  // EP3 captions + static text overlays — SAME outside-Shotstack pattern as
  // transitions, but TIMELINE-level (siblings of tracks, not on a track/clip):
  // burn-in is on the final composited stream, and Shotstack strips unknown
  // fields, so they live in Artlio state and are merged into the ArtlioEdit at
  // currentMergedEdit(). A ref mirrors each so currentMergedEdit reads the CURRENT
  // value (never the value captured when the load effect mounted). ALL writes go
  // through the setter, which keeps ref + state in sync.
  const [captions, setCaptionsState] = useState<UiCaption[]>(
    () => (initialEdit?.timeline.captions as UiCaption[] | undefined) ?? [],
  );
  const captionsRef = useRef<UiCaption[]>(captions);
  const setCaptions = (next: UiCaption[] | ((prev: UiCaption[]) => UiCaption[])) => {
    const value = typeof next === "function" ? next(captionsRef.current) : next;
    captionsRef.current = value;
    setCaptionsState(value);
  };
  const [overlays, setOverlaysState] = useState<UiOverlay[]>(
    () => (initialEdit?.timeline.textOverlays as UiOverlay[] | undefined) ?? [],
  );
  const overlaysRef = useRef<UiOverlay[]>(overlays);
  const setOverlays = (next: UiOverlay[] | ((prev: UiOverlay[]) => UiOverlay[])) => {
    const value = typeof next === "function" ? next(overlaysRef.current) : next;
    overlaysRef.current = value;
    setOverlaysState(value);
  };
  // EP4 ducking: per-track audioRole ("voice"/"music"), keyed by track index. Lives
  // OUTSIDE Shotstack (its Edit strips unknown track fields, same as transitions) so
  // it must be re-merged into the ArtlioEdit in currentMergedEdit/commit helpers and
  // re-seeded in reloadFromEdit. Mirrored in a ref so closures read the CURRENT map.
  const seedRoles = (edit: ArtlioEdit | null | undefined): Record<number, AudioRole> => {
    const out: Record<number, AudioRole> = {};
    edit?.timeline.tracks.forEach((t, i) => { if (t.audioRole) out[i] = t.audioRole; });
    return out;
  };
  const [audioRoles, setAudioRolesState] = useState<Record<number, AudioRole>>(() => seedRoles(initialEdit));
  const audioRolesRef = useRef<Record<number, AudioRole>>(audioRoles);
  const setAudioRoles = (next: Record<number, AudioRole>) => {
    audioRolesRef.current = next;
    setAudioRolesState(next);
  };
  // EP4 output presets live in React (like transitions, outside Shotstack) and are
  // merged into the persisted ArtlioEdit. Seeded from the loaded edit's output.
  const [output, setOutput] = useState<ArtlioEdit["output"]>(
    () => initialEdit?.output ?? EMPTY_EDIT.output,
  );
  // EP4 approx preview (sequential <video> of the visual track, no effects) + audio
  // upload spinner. Both UI-only; no contract/Shotstack/spend interaction.
  const [approxPreview, setApproxPreview] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  // caption-generate flow state (async dispatch + poll, all $0)
  const [capBusy, setCapBusy] = useState(false);
  const [capNote, setCapNote] = useState<string | null>(null);
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
    // Captions/overlays fold in ONE level up (timeline-level, never on a track) —
    // and only when non-empty, so "absence = feature unused" round-trips (no empty
    // [] is ever persisted, matching the transitions/None rule).
    const merged = {
      ...raw,
      output, // EP4: the Output control is the source of truth, not Shotstack's
      timeline: {
        ...raw.timeline,
        tracks: raw.timeline.tracks.map((t, i) => {
          // EP4: re-attach the React-held audioRole (Shotstack strips it). Only when
          // set, so absence round-trips as a flat mix (matches the transitions rule).
          const role = audioRolesRef.current[i];
          const withRole = role ? { ...t, audioRole: role } : t;
          return i === 0 && live.length > 0 ? { ...withRole, transitions: live } : withRole;
        }),
        ...(captionsRef.current.length > 0 ? { captions: captionsRef.current } : {}),
        ...(overlaysRef.current.length > 0 ? { textOverlays: overlaysRef.current } : {}),
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
      output, // EP4: preserve the chosen output presets (Shotstack doesn't carry them)
      timeline: {
        ...raw.timeline,
        tracks: raw.timeline.tracks.map((t, i) => {
          // EP4: re-attach the React-held audioRole — editing a transition must not
          // drop a track's ducking role (it lives in React state, stripped by Shotstack).
          const role = audioRolesRef.current[i];
          const withRole = role ? { ...t, audioRole: role } : t;
          return i === 0 && next.length > 0 ? { ...withRole, transitions: next } : withRole;
        }),
        // preserve the timeline-level Artlio arrays — editing a transition must not
        // drop captions/overlays from the committed edit (they live in React state).
        ...(captionsRef.current.length > 0 ? { captions: captionsRef.current } : {}),
        ...(overlaysRef.current.length > 0 ? { textOverlays: overlaysRef.current } : {}),
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

  /** Commit NEW captions/overlays. Like commitTransitions, these live in React (not
   *  Shotstack) so they fire NO edit:changed — record here explicitly so each edit
   *  is undoable + persisted. Builds the merged edit with the staged arrays (folded
   *  TIMELINE-level, only when non-empty), parses, commitState, then applies to
   *  state. Skips (with a notice) if the result would be out of contract. Reads the
   *  CURRENT reconciled transitions so a caption edit never drops a live transition. */
  function commitCaptionsOverlays(nextCaptions: UiCaption[], nextOverlays: UiOverlay[]): void {
    const h = handles.current;
    if (!h) return;
    const live = reconcileNow();
    const raw = h.edit.getEdit() as ArtlioEdit;
    const merged = {
      ...raw,
      output, // EP4: preserve the chosen output presets (Shotstack doesn't carry them)
      timeline: {
        ...raw.timeline,
        tracks: raw.timeline.tracks.map((t, i) => {
          // EP4: re-attach the React-held audioRole — editing a caption/overlay must
          // not drop a track's ducking role (lives in React state, stripped by Shotstack).
          const role = audioRolesRef.current[i];
          const withRole = role ? { ...t, audioRole: role } : t;
          return i === 0 && live.length > 0 ? { ...withRole, transitions: live } : withRole;
        }),
        ...(nextCaptions.length > 0 ? { captions: nextCaptions } : {}),
        ...(nextOverlays.length > 0 ? { textOverlays: nextOverlays } : {}),
      },
    } as unknown as ArtlioEdit;
    const parsed = artlioEdit.safeParse(merged);
    if (!parsed.success) {
      setNotice({ tone: "warn", text: parsed.error.issues[0]?.message ?? "invalid caption/text" });
      return; // don't apply an out-of-contract caption/overlay
    }
    commitState(parsed.data);
    setCaptions(nextCaptions);
    setOverlays(nextOverlays);
    setDirty(true);
  }

  /** Commit a NEW output preset (aspect/resolution/fps). The Output control lives in
   *  React (Shotstack doesn't carry our presets), so a change fires NO edit:changed —
   *  record here explicitly (same state-only pattern as commitTransitions/captions):
   *  build the merged edit with `next` output, parse, commitState, then setOutput. This
   *  makes output changes undoable + serialized, restored by undo/redo as their own
   *  history step. Preserves the React-held transitions/audioRoles/captions/overlays. */
  function commitOutput(next: ArtlioEdit["output"]): void {
    const h = handles.current;
    if (!h) return;
    const live = reconcileNow();
    const raw = h.edit.getEdit() as ArtlioEdit;
    const merged = {
      ...raw,
      output: next,
      timeline: {
        ...raw.timeline,
        tracks: raw.timeline.tracks.map((t, i) => {
          const role = audioRolesRef.current[i];
          const withRole = role ? { ...t, audioRole: role } : t;
          return i === 0 && live.length > 0 ? { ...withRole, transitions: live } : withRole;
        }),
        ...(captionsRef.current.length > 0 ? { captions: captionsRef.current } : {}),
        ...(overlaysRef.current.length > 0 ? { textOverlays: overlaysRef.current } : {}),
      },
    } as unknown as ArtlioEdit;
    const parsed = artlioEdit.safeParse(merged);
    if (!parsed.success) {
      setNotice({ tone: "warn", text: parsed.error.issues[0]?.message ?? "invalid output preset" });
      return;
    }
    commitState(parsed.data);
    setOutput(next);
    setDirty(true);
  }
  // Apply an output-preset change through the state-only commit path so it's undoable.
  function changeOutput(patch: Partial<ArtlioEdit["output"]>): void {
    if (opLock.current) return; // another command is in flight — serialize
    if (!flushNative()) return; // reconcile + record any pending native edit first
    commitOutput({ ...output, ...patch });
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
    // re-seed the timeline-level Artlio state too (Shotstack doesn't carry these) so
    // undo/redo and any reload restore captions/overlays — not just transitions.
    setCaptions((next.timeline as { captions?: UiCaption[] }).captions ?? []);
    setOverlays((next.timeline as { textOverlays?: UiOverlay[] }).textOverlays ?? []);
    // EP4: re-seed per-track audioRole + the output presets (Shotstack strips both) so
    // undo/redo and any reload restore the ducking roles and output — not just captions.
    setAudioRoles(seedRoles(next));
    setOutput(next.output);
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

  // EP4: place an audio asset on its OWN audio track (the contract forbids audio
  // on the visual track). Build the next edit in JS — append at the end of an
  // existing audio track, or CREATE a new one if there's room (≤3 tracks total,
  // ≤2 audio). `target` "new" FORCES a fresh audio track (so a user can put music
  // on its own track for the voice+music ducking workflow); "auto" appends to the
  // first audio track if one exists, else creates the first. Push via reloadFromEdit
  // (the EP2 op pattern): the SDK's addClip targets an existing index and can't
  // create an audio track.
  async function appendAudioAsset(clip: EditorClip, target: "auto" | "new" = "auto") {
    const h = handles.current;
    if (!h || status !== "ready" || opLock.current) return;
    if (!flushNative()) return; // settle pending native edits + reconcile first
    opLock.current = true;
    try {
      const base = currentMergedEdit();
      if (!base) return;
      const tracks = base.timeline.tracks.map((t) => ({ ...t, clips: [...t.clips] }));
      const isAudio = (t: { clips: { asset: { type: string } }[] }) => t.clips.length > 0 && t.clips.every((c) => c.asset.type === "audio");
      const idx = target === "new" ? -1 : tracks.findIndex(isAudio);
      const newClip = { asset: { type: "audio" as const, src: clip.src }, start: 0, length: clip.seconds };
      if (idx >= 0) {
        const end = tracks[idx]!.clips.reduce((m, c) => Math.max(m, c.start + c.length), 0);
        tracks[idx]!.clips.push({ ...newClip, start: end });
      } else {
        const audioCount = tracks.filter(isAudio).length;
        if (tracks.length >= 3 || audioCount >= 2) {
          setNotice({ tone: "warn", text: "No room for another audio track (max 2)." });
          return;
        }
        tracks.push({ clips: [newClip] });
      }
      const next = { ...base, timeline: { ...base.timeline, tracks } };
      const parsed = artlioEdit.safeParse(next);
      if (!parsed.success) {
        setNotice({ tone: "warn", text: parsed.error.issues[0]?.message ?? "Could not place audio." });
        return;
      }
      commitState(parsed.data);
      selfReload.current = true;
      try { await reloadFromEdit(parsed.data); } finally { selfReload.current = false; }
    } catch (e) {
      console.error("[editor] appendAudioAsset failed", e);
    } finally {
      opLock.current = false;
    }
  }

  // EP4 audio upload: reuses the EXISTING $0 ingest path (direct PUT → finalize →
  // UPLOAD Generation + INGEST probe). No fal/generation/spend path. After finalize
  // the new audio shows up in the Sound list (getEditorMedia now surfaces audio).
  async function uploadAudio(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingAudio(true);
    try {
      const outcome = await uploadFilesDirect(Array.from(files), () => {});
      const res = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in res) { setNotice({ tone: "warn", text: res.error }); return; }
      const fresh = await getEditorMedia(projectId);
      setMedia(fresh);
      setNotice({ tone: "ok", text: `Uploaded ${res.count} audio file${res.count === 1 ? "" : "s"} — find it in Sound.` });
    } catch (e) {
      setNotice({ tone: "warn", text: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setUploadingAudio(false);
    }
  }

  // EP4 ducking: toggle whether an audio track is the "music" bed ducked under
  // voice (or marked "voice"). Sets the React-held audioRole for the track index,
  // rebuilds + reloads the edit so it's undoable + persisted. Contract enforces
  // ≤1 music track; an out-of-contract choice is rejected with a notice.
  async function setAudioTrackRole(trackIndex: number, role: AudioRole | undefined) {
    const h = handles.current;
    if (!h || status !== "ready" || opLock.current) return;
    if (!flushNative()) return;
    opLock.current = true;
    try {
      const nextRoles = { ...audioRolesRef.current };
      if (role) nextRoles[trackIndex] = role; else delete nextRoles[trackIndex];
      const base = currentMergedEdit();
      if (!base) return;
      const tracks = base.timeline.tracks.map((t, i) => {
        if (i !== trackIndex) return t;
        const copy = { ...t };
        if (role) copy.audioRole = role; else delete copy.audioRole; // clearing = the absence of an entry (flat mix)
        return copy;
      });
      const next = { ...base, timeline: { ...base.timeline, tracks } };
      const parsed = artlioEdit.safeParse(next);
      if (!parsed.success) { setNotice({ tone: "warn", text: parsed.error.issues[0]?.message ?? "Invalid role." }); return; }
      setAudioRoles(nextRoles); // update the ref BEFORE reload so currentMergedEdit re-merges it
      commitState(parsed.data);
      selfReload.current = true;
      try { await reloadFromEdit(parsed.data); } finally { selfReload.current = false; }
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

  // ---- EP3 captions + static text overlays (Artlio state, outside Shotstack) ----
  // Generate captions for the selected (or first) visual clip: dispatch the $0
  // whisper caption job, poll to DONE, then seed timeline.captions from the cached
  // transcript. NO spend — the job runs ffmpeg + whisper only.
  async function generateCaptions() {
    if (capBusy) return;
    const h = handles.current;
    if (!h || status !== "ready") return;
    const cur = h.edit.getEdit() as ArtlioEdit;
    const clips = cur.timeline.tracks[0]?.clips ?? [];
    // prefer the selected clip on the video track; else the first visual clip
    const picked =
      (selected?.trackIndex === 0 ? clips[selected.clipIndex] : undefined) ?? clips[0];
    const src = picked?.asset.src;
    if (!src) { setCapNote("Add a video clip to the timeline first."); return; }
    // capture the clip window NOW (whisper transcribes the asset from 0 = ASSET-LOCAL
    // time, but timeline.captions[] is ABSOLUTE timeline time). Map at seed time using
    // this clip's placement: visible asset range = [trim, trim+length]; timeline =
    // clip.start + (assetTime - trim). Captured here so a later native edit can't shift it.
    const clipStart = picked!.start;
    const clipLen = picked!.length;
    const clipTrim = picked!.asset.trim ?? 0;
    setCapBusy(true);
    setCapNote("Transcribing…");
    try {
      const started = await startCaption(projectId, src);
      if ("error" in started) { setCapNote(started.error); return; }
      const jobId = started.id;
      // poll until terminal (caption job reuses RenderStatus: QUEUED/RENDERING/DONE/FAILED)
      let done = false;
      for (let i = 0; i < 200 && !done; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const job = await getCaptionJob(jobId);
        if (!job) { setCapNote("Caption job vanished — try again."); return; }
        if (job.status === "FAILED") { setCapNote(job.error || "Caption job failed."); return; }
        if (job.status === "DONE") done = true;
      }
      if (!done) { setCapNote("Captions are taking a while — reopen the panel to check."); return; }
      const cues = await getTranscript(projectId, src);
      if (cues.length === 0) { setCapNote("No speech detected in this clip."); return; }
      // map asset-local cues → absolute timeline time within this clip's visible window
      const winEnd = clipTrim + clipLen;
      // FLOOR of the clip end (ms): cap every cue's end here so independent rounding of
      // start/length can never push a cue past editDuration (the clip end is ≤ editDuration),
      // which would make the contract reject + silently drop the whole caption set.
      const clipEndMsFloor = Math.floor((clipStart + clipLen) * 1000);
      const EPS = 0.001;
      const mapped: UiCaption[] = [];
      for (const c of cues) {
        const s = c.startMs / 1000;            // asset-local seconds
        const e = (c.startMs + c.lengthMs) / 1000;
        const vs = Math.max(s, clipTrim);      // clip to the visible [trim, trim+length] window
        const ve = Math.min(e, winEnd);
        if (ve - vs <= EPS) continue;          // cue not visible in this clip → drop
        const startMs = Math.round((clipStart + (vs - clipTrim)) * 1000);
        // derive end from a CAPPED integer, then lengthMs = end − start (never round both
        // independently — that can overshoot the timeline end by a millisecond).
        const endMs = Math.min(Math.round((clipStart + (ve - clipTrim)) * 1000), clipEndMsFloor);
        if (endMs - startMs < 1) continue;     // too short after clamping → drop
        mapped.push({ startMs, lengthMs: endMs - startMs, text: c.text });
      }
      if (mapped.length === 0) { setCapNote("No speech in this clip's visible range."); return; }
      // keep captions OUTSIDE this clip's timeline window [clip.start, clip.end) (so
      // re-generating one clip doesn't wipe captions on other clips), replace the inside.
      const clipStartMs = Math.round(clipStart * 1000);
      const clipEndMs = Math.round((clipStart + clipLen) * 1000);
      const kept = captionsRef.current.filter(
        (c) => c.startMs + c.lengthMs <= clipStartMs || c.startMs >= clipEndMs,
      );
      const nextCaps = [...kept, ...mapped].sort((a, b) => a.startMs - b.startMs);
      commitCaptionsOverlays(nextCaps, overlaysRef.current);
      setCapNote(`Added ${mapped.length} caption${mapped.length === 1 ? "" : "s"}.`);
    } catch {
      setCapNote("Couldn't generate captions — check your connection and retry.");
    } finally {
      setCapBusy(false);
    }
  }
  // Patch one caption cue (text or timing); state-only → recorded explicitly.
  function patchCaption(index: number, patch: Partial<UiCaption>) {
    if (opLock.current) return; // serialize with other commands
    if (!flushNative()) return; // reconcile + record any pending native edit first
    const next = captionsRef.current.map((c, i) => (i === index ? { ...c, ...patch } : c));
    commitCaptionsOverlays(next, overlaysRef.current);
  }
  function removeCaption(index: number) {
    if (opLock.current) return;
    if (!flushNative()) return;
    const next = captionsRef.current.filter((_, i) => i !== index);
    commitCaptionsOverlays(next, overlaysRef.current);
  }
  function clearAllCaptions() {
    if (captionsRef.current.length === 0) return; // nothing to clear → no history entry
    if (opLock.current) return;
    if (!flushNative()) return;
    commitCaptionsOverlays([], overlaysRef.current);
  }
  // Add a default static text overlay → timeline.textOverlays[].
  function addOverlay() {
    if (opLock.current) return;
    if (!flushNative()) return;
    const next = [
      ...overlaysRef.current,
      { startMs: 0, lengthMs: 2000, text: "Text", position: "bottom" as const, style: { fontSize: 48, color: "#ffffff" } },
    ];
    commitCaptionsOverlays(captionsRef.current, next);
  }
  function patchOverlay(index: number, patch: Partial<UiOverlay>) {
    if (opLock.current) return;
    if (!flushNative()) return;
    const next = overlaysRef.current.map((o, i) => (i === index ? { ...o, ...patch } : o));
    commitCaptionsOverlays(captionsRef.current, next);
  }
  function patchOverlayStyle(index: number, patch: Partial<UiOverlay["style"]>) {
    if (opLock.current) return;
    if (!flushNative()) return;
    const next = overlaysRef.current.map((o, i) => (i === index ? { ...o, style: { ...o.style, ...patch } } : o));
    commitCaptionsOverlays(captionsRef.current, next);
  }
  function removeOverlay(index: number) {
    if (opLock.current) return;
    if (!flushNative()) return;
    const next = overlaysRef.current.filter((_, i) => i !== index);
    commitCaptionsOverlays(captionsRef.current, next);
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

  // EP4: pure client-side FCP7 XML export — snapshot the merged edit, run the pure
  // editToFcpXml transform, download as a Blob. NO render/generation/spend path.
  function exportXml() {
    const snap = snapshot();
    if (snap.error || !snap.edit) { setNotice({ tone: "warn", text: snap.error ?? "Fix the cut first." }); return; }
    const xml = editToFcpXml(snap.edit, { sequenceName: "Artlio cut" });
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "artlio-cut.xml";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setNotice({ tone: "ok", text: "Exported FCP7 XML — import into Premiere/Resolve, re-link media by filename." });
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
        <select value={output.aspectRatio} onChange={(e) => changeOutput({ aspectRatio: e.target.value as ArtlioEdit["output"]["aspectRatio"] })} aria-label="Aspect ratio" style={{ font: "var(--text-caption)" }}>
          <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option>
        </select>
        <select value={output.resolution} onChange={(e) => changeOutput({ resolution: e.target.value as ArtlioEdit["output"]["resolution"] })} aria-label="Resolution" style={{ font: "var(--text-caption)" }}>
          <option value="sd">SD</option><option value="hd">HD 720</option><option value="1080">1080 (renders at 720 — beta)</option>
        </select>
        <select value={output.fps} onChange={(e) => changeOutput({ fps: Number(e.target.value) as ArtlioEdit["output"]["fps"] })} aria-label="FPS" style={{ font: "var(--text-caption)" }}>
          <option value={25}>25fps</option><option value={30}>30fps</option>
        </select>
        <label style={{ font: "var(--text-caption)", color: "var(--fg-2)", display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={approxPreview} onChange={(e) => setApproxPreview(e.target.checked)} /> Approx preview (no effects)
        </label>
        <Button variant="glass" size="sm" onClick={exportXml} disabled={status !== "ready" || busy} title="Export FCP7 XML for Premiere/Resolve">Export XML</Button>
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
              {/* EP4: audio lives in the Sound aside; Assets shows only visual media. */}
              {media.filter((m) => m.kind !== "audio").length === 0 ? (
                <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>No media yet — generate in Gen space, then click a clip here to add it to the cut.</p>
              ) : media.filter((m) => m.kind !== "audio").map((m) => (
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
          {/* Sound tab — audio assets, upload, place on an audio track, ducking */}
          <aside style={{ width: 200, flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--line-2)", borderRadius: "var(--radius-lg)", overflow: "hidden", maxHeight: "100%" }}>
            <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "space-between", flex: "none" }}>
              <MonoLabel>Sound</MonoLabel>
              <label style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>
                {uploadingAudio ? "Uploading…" : "Upload"}
                <input type="file" accept="audio/*" multiple hidden disabled={uploadingAudio} onChange={(e) => uploadAudio(e.target.files)} />
              </label>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {media.filter((m) => m.kind === "audio").length === 0 ? (
                <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>No audio yet — upload a track, or generate audio in Gen space.</p>
              ) : (() => {
                // there's room for a SECOND audio track (so music can sit on its own
                // track for the voice+music ducking workflow) when an audio track
                // already exists AND the contract caps still allow another (≤2 audio,
                // ≤3 tracks total). When so, each asset offers an "＋ new track" action.
                const t = currentMergedEdit()?.timeline.tracks ?? [];
                const audioCount = t.filter((tr) => tr.clips.length > 0 && tr.clips.every((c) => c.asset.type === "audio")).length;
                const canAddTrack = audioCount >= 1 && audioCount < 2 && t.length < 3;
                return media.filter((m) => m.kind === "audio").map((m) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => appendAudioAsset(m)} disabled={status !== "ready"}
                      title="Add to the first audio track, or drag onto the timeline"
                      draggable onDragStart={(e) => setDnd(e.dataTransfer, { kind: "editor-clip", src: m.src, clipKind: "audio", seconds: m.seconds })}
                      style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, textAlign: "left", font: "var(--text-caption)", color: "var(--fg-1)", background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "7px 10px", cursor: "pointer", minWidth: 0 }}>
                      <span aria-hidden>♪</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{Math.round(m.seconds)}s clip</span>
                      <span aria-hidden style={{ color: "var(--fg-3)" }}>+</span>
                    </button>
                    {canAddTrack && (
                      <button onClick={() => appendAudioAsset(m, "new")} disabled={status !== "ready"}
                        title="Place on a NEW audio track (for separate voice + music)"
                        style={{ flex: "none", font: "var(--text-mono-meta)", color: "var(--fg-3)", background: "transparent", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "5px 6px", cursor: "pointer", whiteSpace: "nowrap" }}>
                        ＋ track
                      </button>
                    )}
                  </div>
                ));
              })()}
              {/* Ducking: list audio tracks with a music/voice toggle */}
              {(() => {
                const tracks = currentMergedEdit()?.timeline.tracks ?? [];
                const audioTracks = tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.clips.length > 0 && t.clips.every((c) => c.asset.type === "audio"));
                if (audioTracks.length === 0) return null;
                return (
                  <section style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    <MonoLabel>Ducking</MonoLabel>
                    {audioTracks.map(({ t, i }) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--text-caption)" }}>
                        <span style={{ flex: 1 }}>Track {i + 1}</span>
                        <select value={t.audioRole ?? ""} onChange={(e) => setAudioTrackRole(i, (e.target.value || undefined) as AudioRole | undefined)} aria-label={`Track ${i + 1} role`} style={{ font: "var(--text-caption)" }}>
                          <option value="">none</option><option value="voice">voice</option><option value="music">music (duck)</option>
                        </select>
                      </div>
                    ))}
                    <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>Mark the bed “music” to dip it under voice.</p>
                  </section>
                );
              })()}
            </div>
          </aside>
          {/* Captions + static text — Artlio state, merged into the timeline (one level
              up, never on a clip). Burn-in happens on the worker's $0 render path. */}
          <aside style={{ width: 210, flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--line-2)", borderRadius: "var(--radius-lg)", overflow: "hidden", maxHeight: "100%" }}>
            <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", justifyContent: "space-between", flex: "none" }}>
              <MonoLabel>Captions</MonoLabel>
              <button onClick={clearAllCaptions} disabled={captions.length === 0}
                style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", background: "none", border: "none", cursor: captions.length ? "pointer" : "default", textDecoration: "underline", textUnderlineOffset: 3 }}>
                Clear all
              </button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              <Button variant="glass" size="sm" onClick={generateCaptions} disabled={status !== "ready" || capBusy}>
                {capBusy ? "Generating…" : "Generate captions"}
              </Button>
              {capNote && <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>{capNote}</p>}
              {captions.length === 0 ? (
                <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>Transcribe the selected (or first) video clip into editable, burned-in captions.</p>
              ) : (
                captions.map((c, i) => (
                  <section key={i} style={{ display: "flex", flexDirection: "column", gap: 5, paddingBottom: 8, borderBottom: "1px solid var(--line-2)" }}>
                    <input value={c.text} onChange={(e) => patchCaption(i, { text: e.target.value })} aria-label={`Caption ${i + 1} text`}
                      style={{ font: "var(--text-caption)", color: "var(--fg-0)", background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "5px 7px" }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <label style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 3, flex: 1 }}>
                        start
                        <input type="number" min={0} step={0.1} value={(c.startMs / 1000).toFixed(1)} onChange={(e) => patchCaption(i, { startMs: Math.max(0, Math.round(Number(e.target.value) * 1000)) })}
                          aria-label={`Caption ${i + 1} start (s)`} style={{ width: 52, font: "var(--text-mono-meta)", color: "var(--fg-1)", background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "3px 4px" }} />s
                      </label>
                      <label style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 3, flex: 1 }}>
                        len
                        <input type="number" min={0.1} step={0.1} value={(c.lengthMs / 1000).toFixed(1)} onChange={(e) => patchCaption(i, { lengthMs: Math.max(1, Math.round(Number(e.target.value) * 1000)) })}
                          aria-label={`Caption ${i + 1} length (s)`} style={{ width: 52, font: "var(--text-mono-meta)", color: "var(--fg-1)", background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "3px 4px" }} />s
                      </label>
                      <button onClick={() => removeCaption(i)} title="Remove caption"
                        style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", background: "none", border: "none", cursor: "pointer" }}>✕</button>
                    </div>
                  </section>
                ))
              )}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                <MonoLabel>Text</MonoLabel>
                <button onClick={addOverlay} disabled={status !== "ready"}
                  style={{ font: "var(--text-mono-meta)", color: "var(--fg-2)", background: "none", border: "none", cursor: status === "ready" ? "pointer" : "default", textDecoration: "underline", textUnderlineOffset: 3 }}>
                  Add text
                </button>
              </div>
              {overlays.length === 0 ? (
                <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>Add a positioned, styled static text overlay.</p>
              ) : (
                overlays.map((o, i) => (
                  <section key={i} style={{ display: "flex", flexDirection: "column", gap: 5, paddingBottom: 8, borderBottom: "1px solid var(--line-2)" }}>
                    <input value={o.text} onChange={(e) => patchOverlay(i, { text: e.target.value })} aria-label={`Overlay ${i + 1} text`}
                      style={{ font: "var(--text-caption)", color: "var(--fg-0)", background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "5px 7px" }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <select value={o.position} onChange={(e) => patchOverlay(i, { position: e.target.value as UiOverlay["position"] })} aria-label={`Overlay ${i + 1} position`}
                        style={{ flex: 1, font: "var(--text-mono-meta)", color: "var(--fg-1)", background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "3px 4px" }}>
                        {OVERLAY_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <input type="color" value={o.style.color} onChange={(e) => patchOverlayStyle(i, { color: e.target.value })} aria-label={`Overlay ${i + 1} color`}
                        style={{ width: 28, height: 24, padding: 0, border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", background: "var(--glass-1)", cursor: "pointer" }} />
                      <button onClick={() => removeOverlay(i)} title="Remove overlay"
                        style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", background: "none", border: "none", cursor: "pointer" }}>✕</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <label style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 3, flex: 1 }}>
                        start
                        <input type="number" min={0} step={0.1} value={(o.startMs / 1000).toFixed(1)} onChange={(e) => patchOverlay(i, { startMs: Math.max(0, Math.round(Number(e.target.value) * 1000)) })}
                          aria-label={`Overlay ${i + 1} start (s)`} style={{ width: 48, font: "var(--text-mono-meta)", color: "var(--fg-1)", background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "3px 4px" }} />s
                      </label>
                      <label style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 3, flex: 1 }}>
                        len
                        <input type="number" min={0.1} step={0.1} value={(o.lengthMs / 1000).toFixed(1)} onChange={(e) => patchOverlay(i, { lengthMs: Math.max(1, Math.round(Number(e.target.value) * 1000)) })}
                          aria-label={`Overlay ${i + 1} length (s)`} style={{ width: 48, font: "var(--text-mono-meta)", color: "var(--fg-1)", background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "3px 4px" }} />s
                      </label>
                      <label style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 3 }}>
                        px
                        <input type="number" min={8} max={200} step={1} value={o.style.fontSize} onChange={(e) => patchOverlayStyle(i, { fontSize: Math.max(8, Math.min(200, Math.round(Number(e.target.value)))) })}
                          aria-label={`Overlay ${i + 1} font size`} style={{ width: 44, font: "var(--text-mono-meta)", color: "var(--fg-1)", background: "var(--glass-1)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", padding: "3px 4px" }} />
                      </label>
                    </div>
                  </section>
                ))
              )}
            </div>
          </aside>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {approxPreview && (() => {
            const vts = currentMergedEdit()?.timeline.tracks.find((t) => t.clips.some((c) => c.asset.type !== "audio"));
            const clips = vts ? [...vts.clips].sort((a, b) => a.start - b.start) : [];
            return <ApproxPreview clips={clips} />;
          })()}
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
                if (payload.clipKind === "audio") void appendAudioAsset({ id: "", src: payload.src, kind: "audio", seconds: payload.seconds });
                else void appendAsset({ id: "", src: payload.src, kind: payload.clipKind, seconds: payload.seconds });
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
            const hasAudio = type === "video" || type === "audio"; // EP4: audio-track clips expose volume too; images are silent
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

/** EP4 approximate preview: a sequential HTML5 <video> playthrough of the VISUAL
 *  track only. NO transitions, captions, overlays, or audio ducking are simulated
 *  (the label says so) — it's a cheap, $0, dependency-free "does my cut roughly
 *  play back-to-back" check. Read-only: it never touches the contract or Shotstack.
 *  Honors trim (as currentTime) + length, advancing on time and looping at the end. */
function ApproxPreview({ clips }: { clips: ArtlioClip[] }) {
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLVideoElement | null>(null);
  // Clamp during render (no reset effect) so a clip-list change can't index out of
  // range — avoids a setState-in-effect cascade and keeps the player honest.
  const safeIdx = clips.length > 0 ? idx % clips.length : 0;
  const cur = clips[safeIdx];
  const isImage = cur?.asset.type === "image";
  useEffect(() => {
    if (!cur) return;
    const advance = () => setIdx((i) => (i + 1) % Math.max(1, clips.length));
    // IMAGE clip: <img> has no playback — hold it for clip.length, then advance.
    if (isImage) {
      const timer = setTimeout(advance, Math.max(0, cur.length) * 1000);
      return () => clearTimeout(timer);
    }
    // VIDEO clip: seek to trim, play, advance when the used portion (trim+length)
    // is reached — and on natural 'ended' (a source shorter than trim+length).
    const v = ref.current; if (!v) return;
    const trim = cur.asset.trim ?? 0;
    const onMeta = () => { v.currentTime = trim; void v.play().catch(() => {}); };
    const onTime = () => { if (v.currentTime >= trim + cur.length) advance(); };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", advance);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", advance);
    };
  }, [cur, clips.length, isImage]);
  if (!cur) return <p style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>No visual clips to preview.</p>;
  return (
    <div style={{ marginBottom: 8 }}>
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cur.asset.src} alt="" style={{ width: "100%", borderRadius: "var(--radius-md)", background: "#000", display: "block" }} />
      ) : (
        <video ref={ref} src={cur.asset.src} playsInline controls style={{ width: "100%", borderRadius: "var(--radius-md)", background: "#000" }} />
      )}
      <p style={{ font: "var(--text-mono-meta)", color: "var(--fg-4)", margin: "4px 0 0" }}>Approx clip {safeIdx + 1}/{clips.length} — transitions, captions &amp; ducking not shown.</p>
    </div>
  );
}
