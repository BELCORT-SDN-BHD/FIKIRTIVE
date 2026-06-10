"use client";

import { useRef, useState, useTransition } from "react";
import type { EntityDTO, EntityTypeDTO } from "@/lib/types";
import {
  createEntity,
  addReferenceImages,
  updateEntity,
  softDeleteEntity,
} from "@/lib/actions";

const TYPE_META: Record<EntityTypeDTO, { label: string; color: string }> = {
  CHARACTER: { label: "Characters", color: "var(--hue-character)" },
  LOCATION: { label: "Locations", color: "var(--hue-location)" },
  PRODUCT: { label: "Products", color: "var(--hue-product)" },
  BRAND: { label: "Brands", color: "var(--hue-brand)" },
};
const TYPE_ORDER: EntityTypeDTO[] = ["CHARACTER", "LOCATION", "PRODUCT", "BRAND"];

export function EntitySidebar({ entities }: { entities: EntityDTO[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="p-3 flex flex-col gap-4">
      <h2 className="font-display text-sm font-semibold text-dim uppercase tracking-wider">
        Entity Library
      </h2>

      <NewEntityForm />

      {entities.length === 0 ? (
        <p className="text-sm text-dim leading-relaxed">
          Create your first entity above — characters, locations, products and
          brands become <span className="text-accent">@mentionable</span> in
          your shot prompts.
        </p>
      ) : (
        TYPE_ORDER.map((type) => {
          const group = entities.filter((e) => e.type === type);
          if (group.length === 0) return null;
          const meta = TYPE_META[type];
          return (
            <section key={type}>
              <h3 className="text-xs font-mono text-faint uppercase mb-1.5 flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: meta.color }}
                  aria-hidden
                />
                {meta.label} · {group.length}
              </h3>
              <ul className="flex flex-col gap-1">
                {group.map((e) => (
                  <EntityRow
                    key={e.id}
                    entity={e}
                    color={meta.color}
                    open={openId === e.id}
                    onToggle={() => setOpenId(openId === e.id ? null : e.id)}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

function NewEntityForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await createEntity(formData);
      if (res && "error" in res) setError(res.error ?? "Something went wrong.");
      else formRef.current?.reset();
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="bg-raised border border-edge rounded-[var(--radius-lg)] p-3 flex flex-col gap-2"
    >
      <div className="flex gap-2">
        <input
          name="name"
          required
          placeholder="New entity name"
          className="flex-1 min-w-0 bg-surface border border-edge rounded-[var(--radius-sm)] text-sm px-2 py-1.5"
          disabled={pending}
        />
        <select
          name="type"
          aria-label="Entity type"
          className="bg-surface border border-edge rounded-[var(--radius-sm)] text-sm px-1.5 py-1.5"
          disabled={pending}
        >
          <option value="CHARACTER">Character</option>
          <option value="LOCATION">Location</option>
          <option value="PRODUCT">Product</option>
          <option value="BRAND">Brand</option>
        </select>
      </div>
      <input
        type="file"
        name="files"
        multiple
        accept="image/*"
        aria-label="Reference images"
        className="text-xs text-dim file:mr-2 file:text-xs file:bg-surface file:border file:border-edge file:rounded-[var(--radius-sm)] file:px-2 file:py-1 file:text-dim"
        disabled={pending}
      />
      {error && (
        <p className="text-xs text-accent" role="alert">
          {error} — adjust and try again.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-[#1a0e06] font-semibold text-sm rounded-[var(--radius-sm)] py-1.5 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create entity"}
      </button>
    </form>
  );
}

function EntityRow({
  entity,
  color,
  open,
  onToggle,
}: {
  entity: EntityDTO;
  color: string;
  open: boolean;
  onToggle: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState(entity.notes);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cover = entity.refs.find((r) => r.kind === "image");

  function run(fn: () => Promise<{ error?: string } | { ok: boolean } | void>) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res && "error" in res && res.error) setError(res.error);
      } catch {
        setError("Something went wrong — try again.");
      }
    });
  }

  return (
    <li className="bg-raised border border-edge rounded-[var(--radius-sm)] overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-surface"
        onClick={onToggle}
        aria-expanded={open}
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover.url}
            alt=""
            className="w-7 h-7 rounded-[var(--radius-sm)] object-cover shrink-0"
          />
        ) : (
          <span
            className="w-7 h-7 rounded-[var(--radius-sm)] shrink-0 flex items-center justify-center text-xs font-semibold"
            style={{ background: `color-mix(in srgb, ${color} 20%, transparent)`, color }}
            aria-hidden
          >
            {entity.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="flex-1 min-w-0 truncate text-sm">{entity.name}</span>
        <span className="font-mono text-xs text-faint shrink-0">
          {entity.usageCount > 0 ? `${entity.usageCount} shot${entity.usageCount > 1 ? "s" : ""}` : "unused"}
        </span>
      </button>

      {open && (
        <div className="px-2 pb-2 flex flex-col gap-2 border-t border-edge pt-2">
          {entity.refs.length === 0 ? (
            <p className="text-xs text-dim">
              No reference images yet — add some so generations stay on-model.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {entity.refs.map((r) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={r.id}
                  src={r.url}
                  alt=""
                  className="aspect-square object-cover rounded-[var(--radius-sm)]"
                />
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
              run(async () => {
                const res = await addReferenceImages(entity.id, fd);
                if (fileRef.current) fileRef.current.value = "";
                return res;
              });
            }}
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== entity.notes) run(() => updateEntity(entity.id, { notes }));
            }}
            placeholder="Notes (style cues, wardrobe, lighting…)"
            rows={2}
            className="bg-surface border border-edge rounded-[var(--radius-sm)] text-xs px-2 py-1.5 resize-y"
          />
          {error && (
            <p className="text-xs text-accent" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              className="text-xs text-dim hover:text-ink disabled:opacity-50"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            >
              + Add refs
            </button>
            <button
              className="ml-auto text-xs text-faint hover:text-accent disabled:opacity-50"
              disabled={pending}
              onClick={() => {
                if (
                  entity.usageCount > 0 &&
                  !confirm(
                    `"${entity.name}" is mentioned in ${entity.usageCount} shot(s). ` +
                      "History snapshots stay intact, but prompt chips will go stale. Delete anyway?",
                  )
                )
                  return;
                run(() => softDeleteEntity(entity.id));
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
