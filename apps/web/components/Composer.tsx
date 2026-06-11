"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
} from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extensions";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import type { EntityDTO, ShotDTO } from "@/lib/types";
import { saveShotPrompt } from "@/lib/actions";
import { Button, Chip } from "./ds";

/* ---------- mention dropdown ---------- */

interface MentionItem {
  id: string;
  name: string;
  type: EntityDTO["type"];
  /** alias the query matched, when it wasn't the name itself */
  aka?: string;
}
interface MentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const HUES: Record<EntityDTO["type"], string> = {
  CHARACTER: "var(--hue-character)",
  LOCATION: "var(--hue-location)",
  PRODUCT: "var(--hue-product)",
  BRAND: "var(--hue-brand)",
};

const MentionList = forwardRef<MentionListHandle, SuggestionProps<MentionItem>>(
  function MentionList(props, ref) {
    const [selected, setSelected] = useState(0);
    useEffect(() => setSelected(0), [props.items]);

    const pick = (index: number) => {
      const item = props.items[index];
      if (item) props.command({ id: item.id, label: item.name, entityType: item.type });
    };

    useImperativeHandle(ref, () => ({
      onKeyDown({ event }) {
        if (props.items.length === 0) return false;
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % props.items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelected((s) => (s + props.items.length - 1) % props.items.length);
          return true;
        }
        if (event.key === "Enter") {
          pick(selected);
          return true;
        }
        return false;
      },
    }));

    return (
      <div className="pop-menu" style={{ position: "static", minWidth: 220 }} role="listbox" aria-label="Entity suggestions">
        {props.items.length === 0 ? (
          <p style={{ font: "var(--text-small)", color: "var(--fg-3)", padding: "7px 11px", margin: 0 }}>
            No matching elements — create one in the Library.
          </p>
        ) : (
          props.items.map((item, i) => (
            <div
              key={item.id}
              role="option"
              aria-selected={i === selected}
              className={`pop-item${i === selected ? " active" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => pick(i)}
            >
              <span style={{ width: 8, height: 8, borderRadius: 99, background: HUES[item.type], flex: "none" }} aria-hidden />
              <span className="pop-item-main">
                <span className="pop-item-label">
                  {item.name}
                  {item.aka && <span style={{ color: "var(--fg-3)", fontWeight: 400 }}> · aka {item.aka}</span>}
                </span>
              </span>
              <span style={{ font: "var(--text-mono-label)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)" }}>
                {item.type.toLowerCase()}
              </span>
            </div>
          ))
        )}
      </div>
    );
  },
);

/* ---------- doc walking: chips store IDs; resolve against live entities ---------- */

interface DocNode {
  type?: string;
  text?: string;
  attrs?: { id?: string; label?: string };
  content?: DocNode[];
}

function resolveDoc(doc: DocNode, byId: Map<string, EntityDTO>) {
  const ids: string[] = [];
  let text = "";
  const walk = (node: DocNode) => {
    if (node.type === "text") text += node.text ?? "";
    if (node.type === "mention" && node.attrs?.id) {
      ids.push(node.attrs.id);
      text += byId.get(node.attrs.id)?.name ?? node.attrs.label ?? "";
    }
    node.content?.forEach(walk);
    if (node.type === "paragraph") text += "\n";
  };
  walk(doc);
  return { ids: [...new Set(ids)], text: text.trim() };
}

/** Top band of the prompt bar: who's in this shot, with reference health. */
function MentionBand({ ids, byId }: { ids: string[]; byId: Map<string, EntityDTO> }) {
  if (ids.length === 0) return null;
  return (
    <div className="al-promptbar-row" aria-label="Elements in this prompt">
      {ids.map((id) => {
        const e = byId.get(id);
        if (!e) {
          return (
            <span key={id} className="al-badge al-badge-danger" style={{ textDecoration: "line-through" }}>
              deleted element
            </span>
          );
        }
        const cover = e.refs.find((r) => r.kind === "image");
        return (
          <span
            key={id}
            className="al-badge"
            style={{ color: HUES[e.type], paddingLeft: cover ? 4 : 10 }}
            title={e.refs.length === 0 ? `${e.name} has no reference images yet` : `${e.name} · ${e.refs.length} refs`}
          >
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover.url} alt="" style={{ width: 18, height: 18, borderRadius: 99, objectFit: "cover" }} />
            ) : null}
            {e.name}
            {e.refs.length === 0 && (
              <span
                style={{ width: 5, height: 5, borderRadius: 99, background: "var(--warning)", display: "inline-block" }}
                title="No reference images"
                aria-label="No reference images"
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

/* ---------- composer (prototype prompt-bar dock) ---------- */

export function Composer({
  shot,
  entities,
  onDirtyChange,
}: {
  shot: ShotDTO;
  entities: EntityDTO[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [dirty, setDirtyState] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [copyBlocked, setCopyBlocked] = useState<string | null>(null);
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const setDirty = (d: boolean) => {
    setDirtyState(d);
    onDirtyChange(d);
  };

  // suggestion callbacks are created once at editor init — read entities via ref
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;

  const shotId = shot.id;
  const editor = useEditor({
    immediatelyRender: false, // SSR: render editor client-side only
    // one long-lived editor would share undo history across shots (P1 audit
    // fix): recreating per shot gives each its own history
    content: (shot.promptDoc as never) ?? "",
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Describe the shot — use @ to add elements, e.g. “@Maya walking in the park”",
      }),
      Mention.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            entityType: {
              default: null,
              parseHTML: (el: HTMLElement) => el.getAttribute("data-entity-type"),
              renderHTML: (attrs: Record<string, unknown>) =>
                attrs.entityType ? { "data-entity-type": attrs.entityType } : {},
            },
          };
        },
      }).configure({
        HTMLAttributes: { class: "mention" },
        suggestion: {
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase();
            return entitiesRef.current
              .map((e) => {
                if (e.name.toLowerCase().includes(q)) return { e, aka: undefined };
                const alias = e.aliases.find((a) => a.toLowerCase().includes(q));
                return alias ? { e, aka: alias } : null;
              })
              .filter((m): m is { e: EntityDTO; aka: string | undefined } => m !== null)
              .slice(0, 8)
              .map(({ e, aka }) => ({ id: e.id, name: e.name, type: e.type, aka }));
          },
          render: () => {
            let component: ReactRenderer<MentionListHandle> | null = null;
            let popup: HTMLDivElement | null = null;
            let dismissed = false; // Esc pressed — popup hidden, keys pass through
            const position = (clientRect?: (() => DOMRect | null) | null) => {
              const rect = clientRect?.();
              if (!popup || !rect) return;
              popup.style.left = `${rect.left}px`;
              // dock sits at the bottom — open the menu UPWARD above the caret
              popup.style.top = "auto";
              popup.style.bottom = `${window.innerHeight - rect.top + 8}px`;
            };
            return {
              onStart(props: SuggestionProps<MentionItem>) {
                dismissed = false;
                component = new ReactRenderer(MentionList, { props, editor: props.editor });
                popup = document.createElement("div");
                popup.style.position = "fixed";
                popup.style.zIndex = "60";
                popup.appendChild(component.element);
                document.body.appendChild(popup);
                position(props.clientRect);
              },
              onUpdate(props: SuggestionProps<MentionItem>) {
                component?.updateProps(props);
                position(props.clientRect);
              },
              onKeyDown(props: SuggestionKeyDownProps) {
                if (props.event.key === "Escape") {
                  dismissed = true;
                  if (popup) popup.style.display = "none";
                  return true;
                }
                if (dismissed) return false;
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit() {
                popup?.remove();
                component?.destroy();
                component = null;
                popup = null;
              },
            };
          },
        },
      }),
    ],
    onUpdate: ({ editor }) => {
      setDirty(true);
      setSaveError(false);
      setCopyBlocked(null);
      setMentionedIds(resolveDoc(editor.getJSON() as DocNode, new Map()).ids);
    },
  }, [shotId]);

  // recreated editor starts clean
  useEffect(() => {
    setDirty(false);
    setSaveError(false);
    setCopyBlocked(null);
    setMentionedIds(shot.entityIds ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotId]);

  // refresh/close with unsaved edits → browser-native confirm
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const byId = new Map(entities.map((e) => [e.id, e]));

  async function doSave(): Promise<boolean> {
    if (!editor) return false;
    const json = editor.getJSON() as DocNode;
    const { ids, text } = resolveDoc(json, byId);
    try {
      // stringified: React Flight drops ProseMirror's null-prototype attrs objects
      const res = await saveShotPrompt(shot.id, JSON.stringify(json), text, ids);
      if (res && "error" in res) {
        setSaveError(true);
        return false;
      }
      setDirty(false);
      return true;
    } catch {
      setSaveError(true);
      return false;
    }
  }

  function save() {
    startTransition(async () => {
      await doSave();
    });
  }

  function copyResolved() {
    if (!editor) return;
    // referential integrity, loudly: every mention must resolve to a live
    // entity with ≥1 reference (LTX's silent @tag breakage is its most hated bug)
    const { ids } = resolveDoc(editor.getJSON() as DocNode, byId);
    const deleted = ids.filter((id) => !byId.get(id));
    const refless = ids.map((id) => byId.get(id)).filter((e): e is EntityDTO => !!e && e.refs.length === 0);
    if (deleted.length > 0) {
      setCopyBlocked(
        "This prompt mentions an element that no longer exists (marked above the text) — delete that chip from the prompt, then copy again.",
      );
      return;
    }
    if (refless.length > 0) {
      setCopyBlocked(
        `${refless.map((e) => e.name).join(", ")} ${refless.length === 1 ? "has" : "have"} no reference images yet — add or generate some in the Library so the render stays on-model.`,
      );
      return;
    }
    startTransition(async () => {
      // copied prompt must match the provenance a later upload records — save first
      if (dirty) {
        const ok = await doSave();
        if (!ok) return;
      }
      const { text } = resolveDoc(editor.getJSON() as DocNode, byId);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  return (
    <div className="composer-dock">
      <div className="composer-wrap">
        {(saveError || copyBlocked) && (
          <p
            role="alert"
            style={{
              font: "var(--text-small)",
              color: saveError ? "var(--danger)" : "var(--warning)",
              margin: "0 4px 8px",
            }}
          >
            {saveError ? (
              <>
                Save failed — check your connection and{" "}
                <button onClick={save} style={{ background: "none", border: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}>
                  retry
                </button>
                .
              </>
            ) : (
              copyBlocked
            )}
          </p>
        )}
        <div className="al-promptbar">
          <MentionBand ids={mentionedIds} byId={byId} />
          <EditorContent editor={editor} />
          <div className="al-promptbar-row">
            <Chip mono interactive={false} title="Where this prompt gets rendered. Phase 2 adds your own templates and API targets here.">
              Target · ComfyUI manual
            </Chip>
            <span className="mono-label">
              Shot {String(shot.number).padStart(2, "0")}
              {dirty ? " · unsaved" : ""}
            </span>
            <span className="al-promptbar-spacer" />
            <Button variant="glass" size="sm" onClick={copyResolved}>
              {copied ? "Copied ✓" : "Copy resolved prompt"}
            </Button>
            <Button size="sm" onClick={save} disabled={pending || !dirty}>
              {pending ? "Saving…" : "Save prompt"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
