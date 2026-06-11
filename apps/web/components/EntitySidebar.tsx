"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import type { EntityDTO, EntityTypeDTO } from "@/lib/types";
import { createEntity } from "@/lib/actions";

const TYPE_META: Record<EntityTypeDTO, { label: string; color: string }> = {
  CHARACTER: { label: "Characters", color: "var(--hue-character)" },
  LOCATION: { label: "Locations", color: "var(--hue-location)" },
  PRODUCT: { label: "Products", color: "var(--hue-product)" },
  BRAND: { label: "Brands", color: "var(--hue-brand)" },
};
const TYPE_ORDER: EntityTypeDTO[] = ["CHARACTER", "LOCATION", "PRODUCT", "BRAND"];

/**
 * Consumption panel: find an entity, check its refs at a glance, jump to the
 * Library to curate. Quick-create stays (fastest path to the first @mention);
 * everything heavier lives in /library. All outbound links pass confirmLeave —
 * the composer may hold unsaved edits.
 */
export function EntitySidebar({
  entities,
  confirmLeave,
}: {
  entities: EntityDTO[];
  confirmLeave: () => boolean;
}) {
  const guard = (e: React.MouseEvent) => {
    if (!confirmLeave()) e.preventDefault();
  };
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (e: EntityDTO) =>
    !q ||
    e.name.toLowerCase().includes(q) ||
    e.aliases.some((a) => a.toLowerCase().includes(q));

  return (
    <div className="p-3 flex flex-col gap-4">
      <div className="flex items-center">
        <h2 className="mono-label text-faint">
          Subjects
        </h2>
        <Link
          href="/library"
          onClick={guard}
          className="ml-auto text-xs text-dim hover:text-ink"
        >
          Manage in Library →
        </Link>
      </div>

      <NewEntityForm />

      {entities.length === 0 ? (
        <p className="text-sm text-dim leading-relaxed">
          Create your first entity above — characters, locations, products and
          brands become <span className="text-ink underline underline-offset-3">@mentionable</span> in
          your shot prompts.
        </p>
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search names & aliases…"
            aria-label="Search entities"
            className="bg-raised border border-edge rounded-[var(--radius-sm)] text-sm px-2.5 py-1.5"
          />
          {TYPE_ORDER.map((type) => {
            const group = entities.filter((e) => e.type === type).filter(matches);
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
                    <EntityRow key={e.id} entity={e} color={meta.color} guard={guard} />
                  ))}
                </ul>
              </section>
            );
          })}
          {q && entities.filter(matches).length === 0 && (
            <p className="text-xs text-faint">
              Nothing matches “{query}” —{" "}
              <Link href="/library" onClick={guard} className="text-ink underline underline-offset-3">
                create it in the Library
              </Link>
              .
            </p>
          )}
        </>
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
      try {
        const res = await createEntity(formData);
        if (res && "error" in res) setError(res.error ?? "Something went wrong.");
        else formRef.current?.reset();
      } catch {
        setError("Something went wrong — try again.");
      }
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="bg-raised border border-edge rounded-[var(--radius-lg)] p-3 flex flex-col gap-2"
    >
      <div className="flex gap-2">
        {/* @ hard-prefix: what you type at creation is exactly what you mention later */}
        <span className="flex-1 min-w-0 flex items-center bg-surface border border-edge rounded-[var(--radius-sm)] px-2 focus-within:border-edge-strong">
          <span className="text-faint text-sm" aria-hidden>@</span>
          <input
            name="name"
            required
            placeholder="NewEntityName"
            className="flex-1 min-w-0 bg-transparent text-sm px-1 py-1.5 outline-none"
            disabled={pending}
          />
        </span>
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
        <p className="text-xs text-danger" role="alert">
          {error} — adjust and try again.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn-primary text-sm py-1.5"
      >
        {pending ? "Creating…" : "Create entity"}
      </button>
    </form>
  );
}

function EntityRow({
  entity,
  color,
  guard,
}: {
  entity: EntityDTO;
  color: string;
  guard: (e: React.MouseEvent) => void;
}) {
  const cover = entity.refs.find((r) => r.kind === "image");

  return (
    <li>
      <Link
        href={`/library?e=${entity.id}`}
        onClick={guard}
        className="flex items-center gap-2 px-2 py-1.5 bg-raised border border-edge rounded-[var(--radius-sm)] hover:border-faint"
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
        {entity.refs.length === 0 && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-warning shrink-0"
            title="No reference images yet"
            aria-label="No reference images yet"
          />
        )}
        <span className="font-mono text-xs text-faint shrink-0">
          {entity.usageCount > 0
            ? `${entity.usageCount} shot${entity.usageCount > 1 ? "s" : ""}`
            : `${entity.refs.length} ref${entity.refs.length === 1 ? "" : "s"}`}
        </span>
      </Link>
    </li>
  );
}
