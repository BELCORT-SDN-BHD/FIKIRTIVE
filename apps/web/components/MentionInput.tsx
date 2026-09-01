"use client";
/**
 * Reusable @mention prompt editor — the wedge. A Tiptap editor with the entity
 * Mention extension + suggestion dropdown, shared by the Storyboard shot cards
 * and the Gen space composer. Chips store entity IDs (not labels); on every
 * change it resolves the doc to { text, ids, doc } so callers can render with
 * real references and persist the doc. Self-contained (no old-Workbench chrome).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extensions";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { EntityDTO } from "@/lib/types";

// A suggestion row: either a bare entity (variantId undefined) or one of its named
// variants (variantId set, variantLabel = the variant's display name). Both carry the
// entity id; selecting a variant chips the entity AND binds the variant for conditioning.
interface MentionItem { id: string; name: string; type: EntityDTO["type"]; aka?: string; variantId?: string; variantLabel?: string }
interface MentionListHandle { onKeyDown: (props: SuggestionKeyDownProps) => boolean }
type MentionListProps = SuggestionProps<MentionItem> & { open: boolean };

const HUES: Record<EntityDTO["type"], string> = {
  CHARACTER: "var(--hue-character)", LOCATION: "var(--hue-location)", PRODUCT: "var(--hue-product)", BRANDMARK: "var(--hue-brand)",
};

const ENTITY_TYPE_LABELS: Record<EntityDTO["type"], string> = {
  CHARACTER: "Character",
  LOCATION: "Location",
  PRODUCT: "Product",
  BRANDMARK: "Brand mark",
};

const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList(props, ref) {
  const [selected, setSelected] = useState(0);
  const virtualRef = {
    current: {
      getBoundingClientRect: () => props.clientRect?.() ?? props.editor.view.dom.getBoundingClientRect(),
    },
  };
  // reset the highlight to the top whenever the suggestion list changes (intentional)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setSelected(0), [props.items]);
  const pick = (i: number) => {
    const item = props.items[i];
    if (item) props.command({
      id: item.id,
      label: item.variantLabel ? `${item.name}:${item.variantLabel}` : item.name,
      entityType: item.type,
      variantId: item.variantId,
    });
  };
  useImperativeHandle(ref, () => ({
    onKeyDown({ event }) {
      if (props.items.length === 0) return false;
      if (event.key === "ArrowDown") { setSelected((s) => (s + 1) % props.items.length); return true; }
      if (event.key === "ArrowUp") { setSelected((s) => (s + props.items.length - 1) % props.items.length); return true; }
      if (event.key === "Enter") { pick(selected); return true; }
      return false;
    },
  }));
  return (
    <Popover open={props.open} modal={false}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        role="listbox"
        aria-label="Entity suggestions"
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        sticky="always"
        hideWhenDetached
        motion="instant"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        className="max-h-[min(20rem,var(--radix-popover-content-available-height))] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto p-1"
      >
        {props.items.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No matching elements — create one in Elements.</p>
        ) : (
          props.items.map((item, i) => (
            <Button
              key={item.variantId ? `${item.id}:${item.variantId}` : item.id}
              type="button"
              variant="ghost"
              size="sm"
              motion="instant"
              role="option"
              aria-selected={i === selected}
              tabIndex={-1}
              onMouseEnter={() => setSelected(i)}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(i);
              }}
              className="h-auto min-h-9 w-full justify-start gap-2.5 px-2.5 py-2 text-left"
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: HUES[item.type] }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {item.name}
                {item.variantLabel && <span className="text-muted-foreground"> · {item.variantLabel}</span>}
                {item.aka && <span className="text-muted-foreground"> · aka {item.aka}</span>}
              </span>
              <Badge variant="outline">{item.variantId ? "Variant" : ENTITY_TYPE_LABELS[item.type]}</Badge>
            </Button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
});

interface DocNode { type?: string; text?: string; attrs?: { id?: string; label?: string; variantId?: string }; content?: DocNode[] }

/** Resolve the editor doc → { ids (deduped), variantSel, text }. Chips render as
 *  the live entity name; falls back to the stored label if an entity was deleted.
 *  variantSel maps entityId → the variant a chip bound (if any) — one variant per
 *  entity per prompt (last write wins). */
export function resolveDoc(doc: DocNode, byId: Map<string, EntityDTO>): { ids: string[]; variantSel: Record<string, string>; text: string } {
  const ids: string[] = [];
  const variantSel: Record<string, string> = {};
  let text = "";
  const walk = (node: DocNode) => {
    if (node.type === "text") text += node.text ?? "";
    if (node.type === "mention" && node.attrs?.id) {
      ids.push(node.attrs.id);
      // last write wins (one variant per entity per prompt): a variant mention binds it,
      // a later bare mention of the same entity clears it back to base refs.
      if (node.attrs.variantId) variantSel[node.attrs.id] = node.attrs.variantId;
      else delete variantSel[node.attrs.id];
      text += byId.get(node.attrs.id)?.name ?? node.attrs.label ?? "";
    }
    node.content?.forEach(walk);
    if (node.type === "paragraph") text += "\n";
  };
  walk(doc);
  return { ids: [...new Set(ids)], variantSel, text: text.trim() };
}

/** Build a Tiptap doc from plain text, converting the first occurrence of each
 *  given entity's name into a mention chip — lets "✨ Enhance" rewrite the prompt
 *  text while keeping the @-bindings (the wedge). Case-insensitive; longest names
 *  first so "Maya Lin" wins over "Maya". */
export function buildMentionDoc(
  text: string,
  mentioned: { id: string; name: string; type: EntityDTO["type"]; variantId?: string }[],
): { type: "doc"; content: unknown[] } {
  type Tok = { kind: "text"; text: string } | { kind: "mention"; attrs: { id: string; label: string; entityType: string; variantId?: string } };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let toks: Tok[] = [{ kind: "text", text }];
  for (const e of [...mentioned].sort((a, b) => b.name.length - a.name.length)) {
    // word-boundary match so a short name doesn't chip inside a larger word ("Ann" in "annular")
    let re: RegExp;
    try { re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(e.name)}(?![\\p{L}\\p{N}])`, "iu"); }
    catch { re = new RegExp(esc(e.name), "i"); }
    const out: Tok[] = [];
    let placed = false;
    for (const t of toks) {
      if (placed || t.kind !== "text") { out.push(t); continue; }
      const m = re.exec(t.text);
      if (!m) { out.push(t); continue; }
      const i = m.index, len = m[0].length;
      const before = t.text.slice(0, i), hit = t.text.slice(i, i + len), after = t.text.slice(i + len);
      if (before) out.push({ kind: "text", text: before });
      out.push({ kind: "mention", attrs: { id: e.id, label: hit, entityType: e.type, variantId: e.variantId } });
      if (after) out.push({ kind: "text", text: after });
      placed = true;
    }
    toks = out;
  }
  const content = toks
    .filter((t) => t.kind !== "text" || t.text.length > 0)
    .map((t) => (t.kind === "text" ? { type: "text", text: t.text } : { type: "mention", attrs: t.attrs }));
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

export function MentionInput({ entities, initialDoc, docKey, placeholder, disabled, onChange, onSubmit, onBlur }: {
  entities: EntityDTO[];
  initialDoc?: unknown;       // Tiptap JSON to seed (e.g. a shot's saved promptDoc)
  docKey?: string;            // change to force a re-seed (server resync) — e.g. shot id + a content hash
  placeholder?: string;
  disabled?: boolean;         // lock the editor (e.g. while ✨ Enhance is in flight)
  onChange: (text: string, ids: string[], variantSel: Record<string, string>, doc: unknown) => void;
  onSubmit?: () => void;      // Cmd/Ctrl+Enter
  onBlur?: () => void;        // editor lost focus (e.g. save the prompt)
}) {
  const entitiesRef = useRef(entities);
  const onSubmitRef = useRef(onSubmit);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  // keep latest props in refs so the Tiptap editor's stable callbacks read fresh
  // values without being recreated — written in an effect, not during render
  useEffect(() => {
    entitiesRef.current = entities;
    onSubmitRef.current = onSubmit;
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
  });

  const editor = useEditor({
    immediatelyRender: false,
    content: (initialDoc as never) ?? "",
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder ?? "Describe the shot — use @ to add elements" }),
      Mention.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            entityType: {
              default: null,
              // legacy promptDocs stored "BRAND"; the EntityType is now BRANDMARK — normalize in and out
              parseHTML: (el: HTMLElement) => { const t = el.getAttribute("data-entity-type"); return t === "BRAND" ? "BRANDMARK" : t; },
              renderHTML: (attrs: Record<string, unknown>) => { const t = attrs.entityType === "BRAND" ? "BRANDMARK" : attrs.entityType; return t ? { "data-entity-type": t } : {}; },
            },
            variantId: {
              default: null,
              parseHTML: (el: HTMLElement) => el.getAttribute("data-variant-id"),
              renderHTML: (attrs: Record<string, unknown>) => (attrs.variantId ? { "data-variant-id": attrs.variantId } : {}),
            },
          };
        },
      // eslint-disable-next-line react-hooks/refs -- the suggestion/keydown/update callbacks read latest-value refs; they fire on user interaction (post-render), never during render
      }).configure({
        HTMLAttributes: { class: "mention" },
        suggestion: {
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase();
            const out: MentionItem[] = [];
            for (const e of entitiesRef.current) {
              if (out.length >= 8) break;
              const nameHit = e.name.toLowerCase().includes(q);
              const alias = nameHit ? undefined : e.aliases.find((a) => a.toLowerCase().includes(q));
              // only image-bearing variants are mentionable — a variant with no ref
              // would only condition on nothing and get blocked at generate
              const liveVariants = e.variants.filter((v) => v.refs.length > 0);
              if (nameHit || alias) {
                // entity matches → offer the base entity + all its image-bearing variants
                out.push({ id: e.id, name: e.name, type: e.type, aka: alias });
                for (const v of liveVariants) out.push({ id: e.id, name: e.name, type: e.type, variantId: v.id, variantLabel: v.name });
              } else {
                // entity name doesn't match, but a variant name/handle might
                for (const v of liveVariants) {
                  if (v.name.toLowerCase().includes(q) || v.handle.toLowerCase().includes(q)) {
                    out.push({ id: e.id, name: e.name, type: e.type, variantId: v.id, variantLabel: v.name });
                  }
                }
              }
            }
            return out.slice(0, 8);
          },
          render: () => {
            let component: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
            let currentProps: SuggestionProps<MentionItem> | null = null;
            let dismissed = false;
            return {
              onStart(props: SuggestionProps<MentionItem>) {
                dismissed = false;
                currentProps = props;
                component = new ReactRenderer(MentionList, { props: { ...props, open: true }, editor: props.editor });
                document.body.appendChild(component.element);
              },
              onUpdate(props: SuggestionProps<MentionItem>) {
                currentProps = props;
                component?.updateProps({ ...props, open: !dismissed });
              },
              onKeyDown(props: SuggestionKeyDownProps) {
                if (props.event.key === "Escape") {
                  dismissed = true;
                  if (currentProps) component?.updateProps({ ...currentProps, open: false });
                  return true;
                }
                if (dismissed) return false;
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit() {
                component?.destroy();
                component = null;
                currentProps = null;
              },
            };
          },
        },
      }),
    ],
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (onSubmitRef.current && (event.shiftKey || event.metaKey || event.ctrlKey) && event.key === "Enter") { onSubmitRef.current(); return true; }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as DocNode;
      const { ids, variantSel, text } = resolveDoc(json, new Map(entitiesRef.current.map((e) => [e.id, e])));
      onChangeRef.current(text, ids, variantSel, json);
    },
    onBlur: () => onBlurRef.current?.(),
    // recreate (and re-seed) when the shot changes OR the server doc changes —
    // a stale editor must never silently overwrite a newer server prompt.
  }, [docKey]);

  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);

  return <EditorContent editor={editor} className="mention-input" />;
}
