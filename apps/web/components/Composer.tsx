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
import { saveShotPrompt, createShot } from "@/lib/actions";

/* ---------- mention dropdown ---------- */

interface MentionItem {
  id: string;
  name: string;
  type: EntityDTO["type"];
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
      <div
        className="bg-raised border border-edge rounded-[var(--radius-sm)] shadow-xl py-1 min-w-52 text-sm"
        role="listbox"
        aria-label="Entity suggestions"
      >
        {props.items.length === 0 ? (
          <p className="px-3 py-1.5 text-dim text-xs">
            No matching entities — create one in the library.
          </p>
        ) : (
          props.items.map((item, i) => (
            <button
              key={item.id}
              role="option"
              aria-selected={i === selected}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${
                i === selected ? "bg-accent-soft" : ""
              }`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => pick(i)}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: HUES[item.type] }}
                aria-hidden
              />
              <span className="truncate">{item.name}</span>
              <span className="ml-auto font-mono text-[10px] text-faint uppercase">
                {item.type.toLowerCase()}
              </span>
            </button>
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

/* ---------- composer ---------- */

export function Composer({
  shot,
  shots,
  entities,
  projectId,
  onSelectShot,
  onDirtyChange,
}: {
  shot: ShotDTO | null;
  shots: ShotDTO[];
  entities: EntityDTO[];
  projectId: string;
  onSelectShot: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [dirty, setDirtyState] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const setDirty = (d: boolean) => {
    setDirtyState(d);
    onDirtyChange(d);
  };

  // suggestion callbacks are created once at editor init — read entities via ref
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;

  const shotId = shot?.id ?? null;
  const editor = useEditor({
    immediatelyRender: false, // SSR: render editor client-side only
    // P1 audit fix: one long-lived editor shares undo history across shots —
    // Ctrl+Z after switching restores shot A's doc into shot B. Recreating the
    // editor per shot (deps below) gives each shot its own history.
    content: (shot?.promptDoc as never) ?? "",
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Type @ to mention an entity… e.g. @Maya in @NeonAlley holding @AuroraBottle",
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
          items: ({ query }: { query: string }) =>
            entitiesRef.current
              .filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 8)
              .map((e) => ({ id: e.id, name: e.name, type: e.type })),
          render: () => {
            let component: ReactRenderer<MentionListHandle> | null = null;
            let popup: HTMLDivElement | null = null;
            let dismissed = false; // Esc pressed — popup hidden, keys pass through
            const position = (clientRect?: (() => DOMRect | null) | null) => {
              const rect = clientRect?.();
              if (!popup || !rect) return;
              popup.style.left = `${rect.left}px`;
              popup.style.top = `${rect.bottom + 6}px`;
            };
            return {
              onStart(props: SuggestionProps<MentionItem>) {
                dismissed = false;
                component = new ReactRenderer(MentionList, {
                  props,
                  editor: props.editor,
                });
                popup = document.createElement("div");
                popup.style.position = "fixed";
                popup.style.zIndex = "50";
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
                // after Esc, stop intercepting — Enter etc. behave like normal typing
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
    onUpdate: () => {
      setDirty(true);
      setSaveError(false);
    },
  }, [shotId]); // fresh editor (and undo history) per shot

  // recreated editor starts clean
  useEffect(() => {
    setDirty(false);
    setSaveError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotId]);

  const byId = new Map(entities.map((e) => [e.id, e]));

  async function doSave(): Promise<boolean> {
    if (!editor || !shot) return false;
    const json = editor.getJSON() as DocNode;
    const { ids, text } = resolveDoc(json, byId);
    try {
      const res = await saveShotPrompt(shot.id, json, text, ids);
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
    startTransition(async () => {
      // copied prompt must match the provenance a later upload records — save first
      if (dirty && shot) {
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
    <section className="p-4 border-b border-edge" aria-label="Prompt composer">
      <div className="flex items-center gap-3 mb-2">
        <h2 className="font-display text-sm font-semibold text-dim uppercase tracking-wider">
          Prompt
        </h2>
        {shot && (
          <span className="font-mono text-xs text-faint">
            Shot {String(shot.number).padStart(2, "0")}
            {shot.title ? ` · ${shot.title}` : ""}
          </span>
        )}
        {dirty && <span className="font-mono text-[10px] text-accent">unsaved</span>}
      </div>

      {!shot ? (
        <div className="composer bg-raised border border-edge rounded-[var(--radius-lg)] p-4 text-sm text-dim">
          {shots.length === 0 ? (
            <>
              Every prompt belongs to a shot.{" "}
              <button
                className="text-accent font-semibold"
                onClick={() =>
                  startTransition(async () => {
                    const res = await createShot(projectId);
                    if ("id" in res && res.id) onSelectShot(res.id);
                  })
                }
                disabled={pending}
              >
                Add Shot 01
              </button>{" "}
              to start writing.
            </>
          ) : (
            <>Select a shot on the board below to edit its prompt.</>
          )}
        </div>
      ) : (
        <>
          <div className="composer bg-raised border border-edge rounded-[var(--radius-lg)] px-4 py-3 focus-within:border-accent">
            <EditorContent editor={editor} />
          </div>
          {saveError && (
            <p className="text-xs text-accent mt-2" role="alert">
              Save failed — check your connection and{" "}
              <button className="underline" onClick={save}>
                retry
              </button>
              .
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={save}
              disabled={pending || !dirty}
              className="bg-accent text-[#1a0e06] font-semibold text-sm rounded-[var(--radius-sm)] px-3 py-1.5 disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save prompt"}
            </button>
            <button
              onClick={copyResolved}
              className="border border-edge text-sm rounded-[var(--radius-sm)] px-3 py-1.5 text-dim hover:text-ink"
            >
              {copied ? "Copied ✓" : "Copy resolved prompt"}
            </button>
            <span className="ml-auto text-xs text-faint">
              @ mentions stay linked when entities are renamed
            </span>
          </div>
        </>
      )}
    </section>
  );
}
