"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { EntityDTO, EntityTypeDTO } from "@/lib/types";
import {
  createEntity,
  updateEntity,
  addEntityAlias,
  removeEntityAlias,
  addReferenceImages,
  softDeleteReferenceImage,
  softDeleteEntity,
} from "@/lib/actions";

const TYPE_META: Record<EntityTypeDTO, { label: string; singular: string; color: string }> = {
  CHARACTER: { label: "Characters", singular: "Character", color: "var(--hue-character)" },
  LOCATION: { label: "Locations", singular: "Location", color: "var(--hue-location)" },
  PRODUCT: { label: "Products", singular: "Product", color: "var(--hue-product)" },
  BRAND: { label: "Brands", singular: "Brand", color: "var(--hue-brand)" },
};
const TYPE_ORDER: EntityTypeDTO[] = ["CHARACTER", "LOCATION", "PRODUCT", "BRAND"];

const EMPTY_HINTS: Record<EntityTypeDTO, string> = {
  CHARACTER: "The people in your videos. 3–12 reference images (front / side / ¾) keep faces on-model.",
  LOCATION: "Recurring places and sets. Wide establishing shots work best as references.",
  PRODUCT: "Hero objects your shots feature. Clean studio shots from several angles.",
  BRAND: "Logos, palettes, style frames — anything that keeps output on-brand.",
};

function useAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(
    fn: () => Promise<{ error?: string } | { ok: boolean } | { id: string } | void>,
    after?: (res: Awaited<ReturnType<typeof fn>>) => void,
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res && "error" in res && res.error) setError(res.error);
        else after?.(res);
      } catch {
        setError("Something went wrong — try again.");
      }
    });
  }
  return { pending, error, setError, run };
}

export function Library({
  entities,
  initialSelectedId,
}: {
  entities: EntityDTO[];
  initialSelectedId: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [creating, setCreating] = useState<EntityTypeDTO | null>(null);
  const [query, setQuery] = useState("");
  const selected = entities.find((e) => e.id === selectedId) ?? null;

  function select(id: string | null) {
    setSelectedId(id);
    setCreating(null);
    // keep the URL shareable without a server roundtrip
    window.history.replaceState(null, "", id ? `/library?e=${id}` : "/library");
  }

  function openCreate(type: EntityTypeDTO) {
    setSelectedId(null);
    setCreating(type);
    window.history.replaceState(null, "", "/library"); // drop stale ?e=
  }

  const q = query.trim().toLowerCase();
  const matches = (e: EntityDTO) =>
    !q ||
    e.name.toLowerCase().includes(q) ||
    e.aliases.some((a) => a.toLowerCase().includes(q));

  return (
    <div className="flex flex-1 min-h-0">
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6 flex flex-col gap-8">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <h1 className="font-display text-xl font-semibold">Subject Library</h1>
              <p className="text-sm text-dim mt-1">
                Everything @mentionable lives here — shared across all projects.
              </p>
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search names & aliases…"
              aria-label="Search entities"
              className="ml-auto bg-raised border border-edge rounded-[var(--radius-sm)] text-sm px-3 py-1.5 w-64"
            />
          </div>

          {TYPE_ORDER.map((type) => {
            const meta = TYPE_META[type];
            const group = entities.filter((e) => e.type === type).filter(matches);
            const total = entities.filter((e) => e.type === type).length;
            return (
              <section key={type} aria-label={meta.label}>
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ background: meta.color }}
                    aria-hidden
                  />
                  <h2 className="font-display text-sm font-semibold uppercase tracking-wider">
                    {meta.label}
                  </h2>
                  <span className="font-mono text-xs text-faint">{total}</span>
                  <button
                    className="ml-auto text-sm text-dim hover:text-accent"
                    onClick={() => openCreate(type)}
                  >
                    + New {meta.singular.toLowerCase()}
                  </button>
                </div>

                {total === 0 ? (
                  <button
                    className="w-full border border-dashed border-edge rounded-[var(--radius-lg)] p-5 text-left text-sm text-dim hover:border-faint"
                    onClick={() => openCreate(type)}
                  >
                    {EMPTY_HINTS[type]}{" "}
                    <span className="text-accent">Create your first {meta.singular.toLowerCase()} →</span>
                  </button>
                ) : group.length === 0 ? (
                  <p className="text-xs text-faint">No {meta.label.toLowerCase()} match “{query}”.</p>
                ) : (
                  <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
                    {group.map((e) => (
                      <EntityCard
                        key={e.id}
                        entity={e}
                        color={meta.color}
                        selected={e.id === selectedId}
                        onClick={() => select(e.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>

      {(selected || creating) && (
        <aside
          aria-label={selected ? "Entity detail" : "New entity"}
          className="w-96 shrink-0 border-l border-edge bg-surface overflow-y-auto"
          onKeyDown={(e) => {
            if (e.key === "Escape") select(null);
          }}
        >
          {selected ? (
            <EntityDetail key={selected.id} entity={selected} onClose={() => select(null)} />
          ) : creating ? (
            <CreatePanel
              type={creating}
              onClose={() => setCreating(null)}
              onCreated={(id) => select(id)}
            />
          ) : null}
        </aside>
      )}
    </div>
  );
}

function EntityCard({
  entity,
  color,
  selected,
  onClick,
}: {
  entity: EntityDTO;
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  const cover = entity.refs.find((r) => r.kind === "image");
  return (
    <button
      onClick={onClick}
      className={`bg-raised border rounded-[var(--radius-lg)] overflow-hidden text-left transition-colors ${
        selected ? "border-accent" : "border-edge hover:border-faint"
      }`}
      aria-pressed={selected}
    >
      <div className="aspect-square bg-surface flex items-center justify-center overflow-hidden">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span
            className="text-2xl font-display font-semibold"
            style={{ color }}
            aria-hidden
          >
            {entity.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="text-sm font-medium truncate">{entity.name}</p>
        <p className="font-mono text-[10px] text-faint mt-0.5">
          {entity.refs.length} ref{entity.refs.length === 1 ? "" : "s"} ·{" "}
          {entity.usageCount > 0 ? `${entity.usageCount} shot${entity.usageCount > 1 ? "s" : ""}` : "unused"}
        </p>
      </div>
    </button>
  );
}

function CreatePanel({
  type,
  onClose,
  onCreated,
}: {
  type: EntityTypeDTO;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const meta = TYPE_META[type];
  const { pending, error, run } = useAction();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} aria-hidden />
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider">
          New {meta.singular}
        </h2>
        <button className="ml-auto text-dim hover:text-ink text-sm" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <form
        ref={formRef}
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("type", type);
          run(
            () => createEntity(fd),
            (res) => {
              formRef.current?.reset();
              if (res && "id" in res) onCreated(res.id);
            },
          );
        }}
      >
        <input
          name="name"
          required
          autoFocus
          placeholder={`${meta.singular} name`}
          className="bg-raised border border-edge rounded-[var(--radius-sm)] text-sm px-3 py-2"
          disabled={pending}
        />
        <label className="text-xs text-dim">
          Reference images
          <input
            type="file"
            name="files"
            multiple
            accept="image/*"
            className="block mt-1 text-xs text-dim file:mr-2 file:text-xs file:bg-raised file:border file:border-edge file:rounded-[var(--radius-sm)] file:px-2 file:py-1 file:text-dim"
            disabled={pending}
          />
        </label>
        {error && (
          <p className="text-xs text-accent" role="alert">
            {error} — adjust and try again.
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-[#1a0e06] font-semibold text-sm rounded-[var(--radius-sm)] py-2 disabled:opacity-50"
        >
          {pending ? "Creating…" : `Create ${meta.singular.toLowerCase()}`}
        </button>
      </form>
    </div>
  );
}

function EntityDetail({ entity, onClose }: { entity: EntityDTO; onClose: () => void }) {
  const meta = TYPE_META[entity.type];
  // separate action scopes: an alias save must not disable ref buttons, and
  // each section's error renders next to the control that failed
  const fieldAct = useAction();
  const aliasAct = useAction();
  const refAct = useAction();
  const dangerAct = useAction();
  const [name, setName] = useState(entity.name);
  const [notes, setNotes] = useState(entity.notes);
  const [negative, setNegative] = useState(entity.negativeConstraints);
  const [aliasInput, setAliasInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // move focus into the drawer on open; Escape (handled on the aside) closes
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} aria-hidden />
        <span className="font-mono text-[10px] text-faint uppercase">{meta.singular}</span>
        <span className="font-mono text-[10px] text-faint ml-auto">
          {entity.usageCount > 0
            ? `mentioned in ${entity.usageCount} shot${entity.usageCount > 1 ? "s" : ""}`
            : "not mentioned yet"}
        </span>
        <button
          ref={closeRef}
          className="text-dim hover:text-ink text-sm"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (!name.trim()) return setName(entity.name); // empty would no-op server-side — revert
          if (name !== entity.name) fieldAct.run(() => updateEntity(entity.id, { name }));
        }}
        aria-label="Entity name"
        className="bg-transparent font-display text-lg font-semibold outline-none border-b border-transparent focus:border-edge pb-1"
      />

      {/* aliases — the @mention search matches these too */}
      <div>
        <h3 className="text-xs font-mono text-faint uppercase mb-1.5">Aliases</h3>
        <div className="flex flex-wrap gap-1.5">
          {entity.aliases.map((a) => (
            <span key={a} className="alias-chip" data-entity-type={entity.type}>
              {a}
              <button
                className="ml-1 opacity-60 hover:opacity-100"
                aria-label={`Remove alias ${a}`}
                disabled={aliasAct.pending}
                onClick={() => aliasAct.run(() => removeEntityAlias(entity.id, a))}
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const alias = aliasInput.trim();
                if (!alias) return;
                setAliasInput("");
                aliasAct.run(() => addEntityAlias(entity.id, alias));
              }
            }}
            placeholder="+ alias ⏎"
            aria-label="Add alias (press Enter)"
            className="bg-raised border border-edge rounded-[var(--radius-sm)] text-xs px-2 py-1 w-24"
            disabled={aliasAct.pending}
          />
        </div>
        {aliasAct.error && (
          <p className="text-xs text-accent mt-1" role="alert">
            {aliasAct.error}
          </p>
        )}
        <p className="text-[11px] text-faint mt-1">
          Nicknames the @ search should also match — e.g. “the girl”, “MAYA”.
        </p>
      </div>

      {/* reference images */}
      <div>
        <div className="flex items-center mb-1.5">
          <h3 className="text-xs font-mono text-faint uppercase">
            References · {entity.refs.length}
          </h3>
          <button
            className="ml-auto text-xs text-dim hover:text-accent disabled:opacity-50"
            disabled={refAct.pending}
            onClick={() => fileRef.current?.click()}
          >
            {refAct.pending ? "Working…" : "+ Add"}
          </button>
        </div>
        {entity.refs.length === 0 ? (
          <button
            className="w-full border border-dashed border-edge rounded-[var(--radius-lg)] p-4 text-xs text-dim hover:border-faint text-left"
            onClick={() => fileRef.current?.click()}
          >
            No references yet — add 3–12 images (front / side / ¾ angles) so
            generations stay on-model. <span className="text-accent">Upload →</span>
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {entity.refs.map((r) => (
              <div key={r.id} className="relative group aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt="" className="w-full h-full object-cover rounded-[var(--radius-sm)]" />
                <button
                  className="absolute top-1 right-1 bg-bg/80 rounded-full w-5 h-5 text-xs opacity-0 group-hover:opacity-100 focus:opacity-100"
                  aria-label="Remove reference image"
                  disabled={refAct.pending}
                  onClick={() => refAct.run(() => softDeleteReferenceImage(r.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (!files?.length) return;
            const fd = new FormData();
            for (const f of files) fd.append("files", f);
            refAct.run(async () => {
              const res = await addReferenceImages(entity.id, fd);
              if (fileRef.current) fileRef.current.value = "";
              return res;
            });
          }}
        />
        {refAct.error && (
          <p className="text-xs text-accent mt-1" role="alert">
            {refAct.error}
          </p>
        )}
      </div>

      <label className="text-xs font-mono text-faint uppercase">
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== entity.notes) fieldAct.run(() => updateEntity(entity.id, { notes }));
          }}
          placeholder="Style cues, wardrobe, lighting, materials…"
          rows={3}
          className="mt-1 w-full bg-raised border border-edge rounded-[var(--radius-sm)] text-sm px-2 py-1.5 resize-y font-sans normal-case"
        />
      </label>

      <label className="text-xs font-mono text-faint uppercase">
        Negative constraints
        <textarea
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
          onBlur={() => {
            if (negative !== entity.negativeConstraints)
              fieldAct.run(() => updateEntity(entity.id, { negativeConstraints: negative }));
          }}
          placeholder="What must never appear — e.g. glasses, beard, modern cars…"
          rows={2}
          className="mt-1 w-full bg-raised border border-edge rounded-[var(--radius-sm)] text-sm px-2 py-1.5 resize-y font-sans normal-case"
        />
      </label>

      {fieldAct.error && (
        <p className="text-xs text-accent" role="alert">
          {fieldAct.error} — your edit was not saved; change the field again to retry.
        </p>
      )}

      <button
        className="self-start text-xs text-faint hover:text-accent disabled:opacity-50"
        disabled={dangerAct.pending}
        onClick={() => {
          if (
            entity.usageCount > 0 &&
            !confirm(
              `"${entity.name}" is mentioned in ${entity.usageCount} shot(s). ` +
                "History snapshots stay intact, but prompt chips will go stale. Delete anyway?",
            )
          )
            return;
          dangerAct.run(
            () => softDeleteEntity(entity.id),
            () => onClose(),
          );
        }}
      >
        Delete {meta.singular.toLowerCase()}
      </button>
      {dangerAct.error && (
        <p className="text-xs text-accent" role="alert">
          {dangerAct.error}
        </p>
      )}
    </div>
  );
}
