"use client";

import type React from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ENTITY_REFERENCE_TYPES, type ReferenceRef, type ReferenceType } from "@fikirtive/core";

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
 * WHICH TYPES A COMPOSER MAY OFFER, and why it is not all seven. Generations and uploads are
 * searchable server-side and appear in Library, but a chat turn has no column to carry a media
 * reference yet (§7.3③ slice ③ adds it), so a media row here would insert a token that silently
 * reaches no model — worse than an absent row, because the merchant would believe it landed.
 * Clothes has no production record at all. Both are registered, not faked (Founder ruling 9:
 * a control with no backend contract is not rendered).
 */

/** Contract §2's category entries, minus the ones production cannot answer. */
const CATEGORIES: readonly { label: string; type: ReferenceType }[] = [
  { label: "Products", type: "product" },
  { label: "Characters", type: "character" },
  { label: "Official avatars", type: "official-avatar" },
  { label: "Locations", type: "location" },
];

const COMPOSER_TYPES: readonly ReferenceType[] = ENTITY_REFERENCE_TYPES;
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
  const [category, setCategory] = useState<ReferenceType | null>(null);
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
    const timer = setTimeout(() => {
      void searchReferencesAction({
        query,
        types: category ? [category] : [...COMPOSER_TYPES],
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
        key: `category:${entry.type}`,
        kind: "category" as const,
        name: entry.label,
        type: entry.type,
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
        setCategory(row.type ?? null);
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
      if (rows.length === 0) return false;
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
    [category, clearCategory, dismiss, highlight, open, rows.length, select],
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
          .filter((entry) => COMPOSER_TYPES.includes(entry.ref.type))
          .map((entry) => ({ id: entry.ref.id, name: entry.name })),
      ),
    [picked],
  );

  const clearPicked = useCallback(() => setPicked([]), []);

  const categoryLabel = category ? CATEGORIES.find((entry) => entry.type === category)?.label : null;

  return {
    listId,
    open,
    rows,
    picked,
    handleTextChange,
    handleKeyDown,
    entityIdsForSend,
    clearPicked,
    menuProps: {
      open,
      listId,
      rows,
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
