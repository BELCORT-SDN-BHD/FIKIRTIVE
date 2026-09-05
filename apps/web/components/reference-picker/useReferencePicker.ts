"use client";

import type React from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ENTITY_REFERENCE_TYPES,
  formatReferenceRef,
  type ReferenceRef,
  type ReferenceType,
} from "@fikirtive/core/reference-ref";

import { activeMentionQuery, resolveSentEntityIds } from "@/lib/otto-mentions";
import { searchReferencesAction } from "@/lib/reference-search-actions";
import {
  REFERENCE_PAGE_LIMIT,
  RECENT_REFERENCE_LIMIT,
  type ReferenceResult,
} from "@/lib/reference-search-model";
import type { ReferencePickerRow } from "./ReferencePickerMenu";

/**
 * The `@` reference picker's behaviour for a plain-textarea composer.
 *
 * One hook, two call sites. `components/otto/OttoFrontDoor.tsx` and
 * `components/otto/OttoChatStream.tsx` each carried a byte-for-byte duplicate of this state
 * machine — query detection, highlight, arrow/Enter/Tab/Escape, caret-local insertion, picked-id
 * tracking — and each filtered an in-memory `EntityDTO[]` prop. Spec
 * `docs/specs/frontend-baseline.md` §7.3③ replaces both with this hook over the one server search.
 *
 * WHICH TYPES A COMPOSER MAY OFFER, and why it is five category entries rather than the contract's
 * six. Generations and uploads are here NOW: slice ③ gave the message a typed reference column
 * (`ChatMessage.referenceRefs`), so a media row inserts a reference the server stores, owner-checks
 * and links back to — which is precisely what was missing when this hook first shipped without
 * them. They arrive behind ONE `Media` entry rather than two, because that is what the frozen
 * contract says in as many words (§2: "`Media` 继续覆盖具体的 `Uploads` 与 `Generations`,不创建
 * 第三份媒体对象"), and it is what the approved fixture draws
 * (`design-system/patterns/reference-picker/ReferencePickerReference.tsx`, one row,
 * `types: ["generation", "upload"]`).
 *
 * What a media reference still does NOT do is condition the picture the way an entity does: image
 * conditioning travels on `sourceGenerationIds` ("Add context"), a separate and separately priced
 * path, and routing an `@` into it would silently turn a text-to-image turn into an image-to-image
 * one. That asymmetry is registered in spec §5, not papered over.
 *
 * Clothes is the one contract entry with no category here: production has no clothes record at all
 * (`lib/reference-search.ts` returns nothing for it), so under Founder ruling 9 — a control with no
 * backend contract is not rendered — it stays out until the actor library's outfit presets exist.
 * `brandmark` stays searchable without a category of its own, pending the ruling already in §5.
 */

/**
 * Contract §2's category entries, minus `Clothes` — the one entry production has no record of.
 *
 * A category is a LABEL over a SET of types, not a single type: `Media` is one entry covering two.
 * Its label is the identity the menu and the state below carry, because two of these no longer map
 * one-to-one onto a `ReferenceType`.
 */
const CATEGORIES: readonly { label: string; types: readonly ReferenceType[] }[] = [
  { label: "Products", types: ["product"] },
  { label: "Characters", types: ["character"] },
  { label: "Official avatars", types: ["official-avatar"] },
  { label: "Locations", types: ["location"] },
  { label: "Media", types: ["generation", "upload"] },
];

/**
 * What a bare `@` searches: every category above plus `brandmark` (searchable, no category of its
 * own) — i.e. every contract type production can actually answer.
 */
const COMPOSER_TYPES: readonly ReferenceType[] = [
  ...ENTITY_REFERENCE_TYPES,
  "generation",
  "upload",
];
const SEARCH_DEBOUNCE_MS = 120;

export interface PickedReference {
  ref: ReferenceRef;
  name: string;
}

export interface UseReferencePickerOptions {
  text: string;
  setText: (next: string) => void;
  /** The composer element — a ref on one surface, `getElementById` on the other. */
  getTextarea: () => HTMLTextAreaElement | null;
}

export function useReferencePicker({ text, setText, getTextarea }: UseReferencePickerOptions) {
  const listId = useId();
  const [query, setQuery] = useState<string | null>(null);
  /** The category entry stepped into, BY LABEL — `Media` is one entry over two types. */
  const [category, setCategory] = useState<string | null>(null);
  /**
   * The last answer AND the request it answers, in one value. Keeping them together is what lets
   * the menu know whether its rows are about the query on screen: two separate states could not
   * be updated atomically, and the gap is exactly where a stale row gets picked.
   */
  const [answer, setAnswer] = useState<{ key: string; items: ReferenceResult[] } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [picked, setPicked] = useState<PickedReference[]>([]);
  const requestSeq = useRef(0);
  /** The caret position the open query was detected at — see `insertReference`. */
  const queryCaret = useRef(0);

  const open = query !== null;
  /** The identity of the request the menu currently needs answered. */
  const requestKey = query === null ? null : `${category ?? ""}\u0000${query}`;

  // One search per settled keystroke. `requestSeq` drops a slow answer a newer query has already
  // replaced — without it the menu flickers back to stale rows.
  useEffect(() => {
    if (requestKey === null) return;
    const seq = ++requestSeq.current;
    const entry = category ? CATEGORIES.find((item) => item.label === category) : undefined;
    const timer = setTimeout(() => {
      void searchReferencesAction({
        query,
        types: entry ? [...entry.types] : [...COMPOSER_TYPES],
        limit: query === "" && !category ? RECENT_REFERENCE_LIMIT : REFERENCE_PAGE_LIMIT,
      })
        .then((page) => {
          if (seq !== requestSeq.current) return;
          setAnswer({ key: requestKey, items: page.items });
        })
        .catch(() => {
          // A failed search is "no rows I can vouch for", never a stale list presented as current.
          if (seq !== requestSeq.current) return;
          setAnswer({ key: requestKey, items: [] });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [requestKey, query, category]);

  const results = answer && answer.key === requestKey ? answer.items : null;
  /**
   * No answer for the query on screen yet — the debounce is still counting, or the round trip is
   * still open. The menu MUST be told: "no rows" and "no rows YET" are indistinguishable from
   * `rows.length`, and an empty state drawn on the second one tells the merchant `No references
   * found` about a search that is still running. That fires on every keystroke (120ms debounce
   * plus one server round trip each), so the whole time they are typing a name they are being told
   * it does not exist — the exact opposite of what FRONT-A10 exists to prove.
   */
  const pending = open && results === null;
  const showCategories = query === "" && category === null;

  const rows = useMemo<ReferencePickerRow[]>(() => {
    // Until the answer for THIS query lands, show nothing rather than the previous query's rows —
    // picking one of those would reference an object the merchant is no longer looking at.
    const referenceRows: ReferencePickerRow[] = (results ?? []).map((result) => ({
      key: `${result.type}:${result.id}`,
      kind: "reference" as const,
      name: result.name,
      source: result.source,
      thumbUrl: result.thumbUrl,
      type: result.type,
    }));
    if (!showCategories) return referenceRows;
    return [
      ...referenceRows,
      ...CATEGORIES.map((entry) => ({
        key: `category:${entry.label}`,
        kind: "category" as const,
        name: entry.label,
        // A one-type entry carries its own type icon; `Media` covers two, so it passes none and
        // the menu draws the multi-media icon the fixture uses for that row.
        type: entry.types.length === 1 ? entry.types[0] : null,
      })),
    ];
  }, [results, showCategories]);

  const dismiss = useCallback(() => {
    setQuery(null);
    setCategory(null);
    setHighlight(0);
  }, []);

  const focusComposer = useCallback(() => {
    const textarea = getTextarea();
    setTimeout(() => textarea?.focus(), 0);
  }, [getTextarea]);

  const clearCategory = useCallback(() => {
    setCategory(null);
    setHighlight(0);
    focusComposer();
  }, [focusComposer]);

  /**
   * Replace only the `@query` at the caret and keep everything after it — a reference inserted in
   * the middle of a sentence must not eat the rest of the line (Phase 5 spec §9).
   *
   * WHY A PLAIN `@Name`, NOT THE FIXTURE'S CHIP. The approved fixture
   * (`design-system/patterns/reference-picker/ReferencePickerReference.tsx`, `selectItem`) DELETES
   * the `@query` from the draft and carries the object as a removable chip above the composer.
   * Production cannot do that yet, and the reason is not cosmetic: today the only thing that
   * carries a reference to the model is the name in the text — `entityIdsForSend` below keeps an
   * id only while `@Name` still appears in what was sent. Strip the name and BOTH halves vanish:
   * the model reads a message that never mentions the object, and every entity id is filtered out.
   * The chip becomes the honest representation once the message itself stores typed reference ids
   * (spec §7.3③ slice ③); until then it is registered in the PR's "设计有、生产暂不显示" table,
   * not faked. The removal action still exists in production form: deleting `@Name` from the draft
   * drops the reference, which is the same rule stated in `resolveSentEntityIds`.
   */
  const insertReference = useCallback(
    (result: ReferenceResult) => {
      const textarea = getTextarea();
      // Prefer the live DOM caret, but fall back to the caret the query was detected at when the
      // DOM one no longer sits inside a mention. Both are real cases: a merchant can click a row
      // (which never moves the caret), and a programmatic value change can leave the caret at the
      // end of the field. Trusting the DOM caret blindly is what eats the rest of the line — the
      // approved fixture takes the same fallback (Phase 5 spec, 2026-09-02 browser re-check).
      const domCaret = textarea?.selectionStart ?? null;
      const caret =
        domCaret !== null && activeMentionQuery(text, domCaret) !== null ? domCaret : queryCaret.current;
      const before = text.slice(0, caret);
      const atIdx = before.lastIndexOf("@");
      if (atIdx < 0) return;
      setText(`${text.slice(0, atIdx)}@${result.name} ${text.slice(caret)}`);
      setPicked((prev) =>
        prev.some((entry) => entry.ref.type === result.type && entry.ref.id === result.id)
          ? prev
          : [...prev, { ref: { type: result.type, id: result.id }, name: result.name }],
      );
      dismiss();
      focusComposer();
    },
    [dismiss, focusComposer, getTextarea, setText, text],
  );

  const select = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return;
      if (row.kind === "category") {
        setCategory(row.name);
        setHighlight(0);
        focusComposer();
        return;
      }
      const result = results?.find((item) => `${item.type}:${item.id}` === row.key);
      if (result) insertReference(result);
    },
    [focusComposer, insertReference, results, rows],
  );

  const handleTextChange = useCallback((value: string, caret: number) => {
    const next = activeMentionQuery(value, caret);
    if (next !== null) queryCaret.current = caret;
    setQuery(next);
    setHighlight(0);
    if (next === null) setCategory(null);
  }, []);

  /** Returns true when the picker consumed the key — the composer must then stop. */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) return false;
      // Mid-composition (IME) keystrokes belong to the input method, never to the menu.
      if (event.nativeEvent.isComposing) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        // inside a category, Escape steps back to the unfiltered menu before closing it
        if (category) clearCategory();
        else dismiss();
        return true;
      }
      if (rows.length === 0) {
        /**
         * There are no rows because the answer for this query has not landed yet — NOT because the
         * merchant has finished with the menu. Handing Enter back to the composer here is the
         * costly half of the "no rows YET" defect: `OttoChatStream`/`OttoFrontDoor` take Enter as
         * submit, so the draft is cleared and a billed Otto turn starts on a message whose
         * reference the merchant was still halfway through picking — and the reference never
         * attaches, because nothing was selected. Swallow Enter/Tab while the search is in flight
         * and let the answer arrive; every other key still reaches the composer.
         */
        if (pending && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
          event.preventDefault();
          return true;
        }
        return false;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
        return true;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((h) => Math.min(rows.length - 1, h + 1));
        return true;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault();
        select(highlight);
        return true;
      }
      return false;
    },
    [category, clearCategory, dismiss, highlight, open, pending, rows.length, select],
  );

  /**
   * The entity ids to send with this turn. `resolveSentEntityIds` drops any reference whose
   * `@name` the merchant has since deleted from the draft, so a removed token stops conditioning
   * the generation — the rule both composers already applied, kept verbatim.
   */
  const entityIdsForSend = useCallback(
    (sentText: string) =>
      resolveSentEntityIds(
        sentText,
        picked
          // ENTITY types ONLY, deliberately. This list is generation CONDITIONING (the worker loads
          // each id's reference images). A generation or upload id here would be looked up in the
          // wrong table and — worse — would read as "this object shaped the picture" when it did
          // not. What the merchant pointed at is `referencesForSend` below; the two are not the
          // same list and must not be merged.
          .filter((entry) => (ENTITY_REFERENCE_TYPES as readonly ReferenceType[]).includes(entry.ref.type))
          .map((entry) => ({ id: entry.ref.id, name: entry.name })),
      ),
    [picked],
  );

  /**
   * FRONT-A10 — the typed references this turn is about, in wire form (`"<type>:<id>"`), destined
   * for `ChatMessage.referenceRefs`. Same survival rule as `entityIdsForSend`, and deliberately the
   * same function: a reference whose `@name` is no longer in the sent text was removed by the
   * merchant, so it is not part of this message.
   *
   * All seven offered types travel here (`COMPOSER_TYPES` — the five entity types plus `generation`
   * and `upload`), entities included — this is "what the merchant pointed at",
   * not "what conditioned the picture". The server trusts none of it: every id is re-resolved
   * against the authenticated owner before the row is written (`apps/web/lib/reference-refs.ts`).
   */
  const referencesForSend = useCallback(
    (sentText: string) =>
      resolveSentEntityIds(
        sentText,
        picked.map((entry) => ({ id: formatReferenceRef(entry.ref), name: entry.name })),
      ),
    [picked],
  );

  const clearPicked = useCallback(() => setPicked([]), []);

  /** The state IS the label (see `CATEGORIES`) — nothing to look up. */
  const categoryLabel = category;

  return {
    listId,
    open,
    rows,
    picked,
    handleTextChange,
    handleKeyDown,
    entityIdsForSend,
    referencesForSend,
    clearPicked,
    menuProps: {
      open,
      listId,
      rows,
      pending,
      highlightedIndex: highlight,
      title: categoryLabel ?? (query ? "References" : "Recent"),
      subtitle: categoryLabel
        ? "Choose one exact object"
        : query
          ? `Results for "${query}"`
          : "Recently updated in your workspace",
      onClearCategory: category ? clearCategory : null,
      onHighlightChange: setHighlight,
      onSelect: select,
      onDismiss: dismiss,
    },
    ariaProps: {
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? listId : undefined,
      "aria-expanded": open,
      "aria-activedescendant": open && rows.length > 0 ? `${listId}-option-${highlight}` : undefined,
    },
  };
}
