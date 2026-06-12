"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { REFGEN_PRICE_USD_PER_IMAGE } from "@artlio/core";
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
import { startRefGen, getRefGenJobs } from "@/lib/refgen-actions";
import { Badge, Button, Dialog, IcImage, IconButton, IcPlus, IcX, Input, MediaCard, MonoLabel, SegmentedControl } from "./ds";

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

const MAX_REF_BYTES = 10 * 1024 * 1024; // 10 MB per source image
const MAX_REF_FILES = 10;
/** Keep only image files within the size/count budget; report why any were dropped
 *  (shared by the click-picker and drag-drop on both the create dialog and drawer). */
function acceptImages(incoming: File[], existing: number): { files: File[]; error: string | null } {
  const room = Math.max(0, MAX_REF_FILES - existing);
  const images = incoming.filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.type));
  const sized = images.filter((f) => f.size <= MAX_REF_BYTES);
  const files = sized.slice(0, room);
  let error: string | null = null;
  if (images.length < incoming.length) error = "Only PNG, JPG or WebP images.";
  else if (sized.length < images.length) error = `Each image must be ≤ 10 MB — ${images.length - sized.length} too large.`;
  else if (files.length < images.length) error = `Up to ${MAX_REF_FILES} images per element.`;
  return { files, error };
}

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
  routeSync = true,
}: {
  entities: EntityDTO[];
  initialSelectedId: string | null;
  /** Sync selection to the /library URL. Off when embedded in the Studio
   *  shell (the route is /studio there — a /library replaceState would make a
   *  post-action revalidation navigate away). */
  routeSync?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [creating, setCreating] = useState(false);
  const [createType, setCreateType] = useState<EntityTypeDTO>("CHARACTER");
  const [query, setQuery] = useState("");
  const selected = entities.find((e) => e.id === selectedId) ?? null;

  function select(id: string | null) {
    setSelectedId(id);
    if (!routeSync) return;
    // keep the URL shareable without a server roundtrip
    window.history.replaceState(null, "", id ? `/library?e=${id}` : "/library");
  }

  function openCreate(type: EntityTypeDTO) {
    setCreateType(type);
    setCreating(true);
  }

  const q = query.trim().toLowerCase();
  const matches = (e: EntityDTO) =>
    !q || e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q));

  return (
    <div className="flex flex-1 min-h-0">
      <div className="screen">
        <div className="screen-pad">
          <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "10px 0 6px" }}>
            <div>
              <h1 style={{ font: "var(--text-display)", letterSpacing: "var(--tracking-display)", color: "var(--fg-1)", margin: 0 }}>
                Elements
              </h1>
              <p style={{ font: "var(--text-body)", color: "var(--fg-2)", margin: "6px 0 0", maxWidth: 480 }}>
                Lock a character, place or product once, then reference it in any prompt with @ — across every project.
              </p>
            </div>
            <span style={{ flex: 1 }} />
            <Button icon={<IcPlus />} onClick={() => openCreate("CHARACTER")}>
              New element
            </Button>
          </div>

          <div className="filters-row" style={{ marginTop: 20 }}>
            <span className="al-input-wrap" style={{ maxWidth: 280, flex: 1 }}>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search names & aliases…"
                aria-label="Search elements"
              />
            </span>
          </div>

          {TYPE_ORDER.map((type) => {
            const meta = TYPE_META[type];
            const group = entities.filter((e) => e.type === type).filter(matches);
            const total = entities.filter((e) => e.type === type).length;
            return (
              <section key={type} aria-label={meta.label} style={{ marginBottom: 30 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 99, background: meta.color, display: "inline-block" }} aria-hidden />
                  <MonoLabel>{meta.label}</MonoLabel>
                  <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>{total}</span>
                  <span style={{ flex: 1 }} />
                  <Button variant="ghost" size="sm" onClick={() => openCreate(type)}>
                    + New {meta.singular.toLowerCase()}
                  </Button>
                </div>

                {total === 0 ? (
                  <button className="drop-zone" onClick={() => openCreate(type)}>
                    <span className="drop-zone-tile">
                      <IcPlus size={18} />
                    </span>
                    <span>
                      {EMPTY_HINTS[type]}{" "}
                      <span style={{ color: "var(--fg-1)", textDecoration: "underline", textUnderlineOffset: 3 }}>
                        Create your first {meta.singular.toLowerCase()} →
                      </span>
                    </span>
                  </button>
                ) : group.length === 0 ? (
                  <p style={{ font: "var(--text-small)", color: "var(--fg-3)" }}>
                    No {meta.label.toLowerCase()} match “{query}”.
                  </p>
                ) : (
                  <div className="card-grid">
                    {group.map((e) => {
                      const cover = e.refs.find((r) => r.kind === "image");
                      return (
                        <div key={e.id} className="fade-rise">
                          <MediaCard
                            ratio="1:1"
                            src={cover?.url ?? null}
                            selected={e.id === selectedId}
                            onClick={() => select(e.id === selectedId ? null : e.id)}
                            title={`@${e.name}`}
                            meta={`${e.type} · ${e.refs.length} SOURCES${e.usageCount > 0 ? ` · ${e.usageCount} SHOTS` : ""}`}
                            footer={
                              e.refs.length === 0 ? (
                                <Badge mono tone="warning" dot>
                                  No refs yet
                                </Badge>
                              ) : (
                                <Badge mono>Locked</Badge>
                              )
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {selected && (
        <aside
          aria-label="Element detail"
          style={{ width: 384, flex: "none", borderLeft: "1px solid var(--line-2)", overflowY: "auto" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") select(null);
          }}
        >
          <EntityDetail key={selected.id} entity={selected} onClose={() => select(null)} />
        </aside>
      )}

      <CreateDialog
        open={creating}
        type={createType}
        onType={setCreateType}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          select(id);
        }}
      />
    </div>
  );
}

/* ---------- create dialog (prototype "Create element" + two doors) ---------- */

function CreateDialog({
  open,
  type,
  onType,
  onClose,
  onCreated,
}: {
  open: boolean;
  type: EntityTypeDTO;
  onType: (t: EntityTypeDTO) => void;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { pending, error, setError, run } = useAction();
  const [name, setName] = useState("");
  const [door, setDoor] = useState<"upload" | "generate">("upload");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setFiles([]);
      setDoor("upload");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function save() {
    const clean = name.trim().replace(/^@/, "");
    if (!clean) {
      setError("Name the element first.");
      return;
    }
    if (door === "upload" && files.length === 0) {
      setError("Add at least one source image, or switch to Generate.");
      return;
    }
    const fd = new FormData();
    fd.set("name", clean);
    fd.set("type", type);
    if (door === "upload") for (const f of files) fd.append("files", f);
    run(
      () => createEntity(fd),
      (res) => {
        if (res && "id" in res && res.id) onCreated(res.id);
      },
    );
  }

  return (
    <Dialog
      open={open}
      title="Create element"
      onClose={onClose}
      actions={[
        <Button key="c" variant="ghost" onClick={onClose}>Cancel</Button>,
        <Button key="s" onClick={save} disabled={pending}>
          {pending ? "Creating…" : door === "generate" ? "Create element →" : "Save element"}
        </Button>,
      ]}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <SegmentedControl
          full
          options={TYPE_ORDER.map((t) => ({ value: t, label: TYPE_META[t].singular }))}
          value={type}
          onChange={onType}
        />
        <Input
          label="Name"
          placeholder={type === "CHARACTER" ? "maya" : TYPE_META[type].singular.toLowerCase()}
          prefix="@"
          value={name}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          hint="Reference it in prompts as @name."
        />

        <SegmentedControl
          full
          options={[
            { value: "upload", label: "Upload images" },
            { value: "generate", label: "Generate refs" },
          ]}
          value={door}
          onChange={(d) => setDoor(d)}
        />

        {door === "upload" ? (
          <div>
            <div style={{ font: "var(--text-small)", fontWeight: 500, color: "var(--fg-2)", marginBottom: 7 }}>
              Source images
            </div>
            <button
              className="drop-zone"
              style={{ flexDirection: "column", alignItems: "center", gap: 10, padding: "22px 18px", textAlign: "center" }}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const r = acceptImages([...e.dataTransfer.files], files.length);
                setError(r.error);
                if (r.files.length) setFiles((f) => [...f, ...r.files].slice(0, MAX_REF_FILES));
              }}
              type="button"
            >
              <span className="drop-zone-tile">
                <IcImage size={18} />
              </span>
              <span>
                Drop or add up to 10 images from different angles —{" "}
                <span style={{ color: "var(--fg-1)", textDecoration: "underline", textUnderlineOffset: 3 }}>browse</span>
              </span>
              <span style={{ font: "var(--text-caption)", color: "var(--fg-4)" }}>JPG, PNG, WebP · ≤ 10 MB each</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              aria-label="Source images"
              onChange={(e) => {
                const list = e.target.files ? [...e.target.files] : [];
                const r = acceptImages(list, files.length);
                setError(r.error);
                if (r.files.length) setFiles((f) => [...f, ...r.files].slice(0, MAX_REF_FILES));
              }}
            />
            {files.length > 0 && (
              <div className="thumb-strip" style={{ marginTop: 10 }}>
                {files.map((f, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} className="ref-thumb" src={URL.createObjectURL(f)} alt="" />
                ))}
              </div>
            )}
          </div>
        ) : (
          <p style={{ font: "var(--text-small)", color: "var(--fg-2)", margin: 0 }}>
            After creating, you&apos;ll get a ready-made reference prompt (e.g. a product shot set
            with your logo). Generate the images right here, or copy the prompt into your own pipeline.
          </p>
        )}

        {error ? (
          <div role="alert" style={{ font: "var(--text-small)", color: "var(--danger)" }}>{error}</div>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- detail drawer ---------- */

function buildReferencePrompt(entity: EntityDTO): string {
  const subject = `${entity.name}${entity.notes ? `, ${entity.notes}` : ""}`;
  const negative = entity.negativeConstraints ? ` Avoid: ${entity.negativeConstraints}.` : "";
  switch (entity.type) {
    case "CHARACTER":
      return `Character reference sheet of ${subject}. Front view, side profile, and three-quarter view, neutral expression, plain studio background, soft even lighting, consistent identity across all views.${negative}`;
    case "LOCATION":
      return `Location reference set of ${subject}. Wide establishing shot, alternate angle, and close detail shot, consistent architecture, time of day and lighting across all views.${negative}`;
    case "PRODUCT":
      return `Product reference set of ${subject}. Clean studio shots from front, side and three-quarter angles on a neutral background, consistent materials, proportions and branding.${negative}`;
    case "BRAND":
      return `Brand style frames for ${subject}. Logo treatment on light and dark backgrounds, color palette swatch, and texture detail, consistent visual identity.${negative}`;
  }
}

function GenerateRefsBlock({ entity }: { entity: EntityDTO }) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  const [prompt, setPrompt] = useState(() => buildReferencePrompt(entity));
  const [count, setCount] = useState(4);
  const [job, setJob] = useState<{ status: string; error: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startMs = useRef(0);

  const conditioned = entity.refs.length > 0;
  const busy = pending || job?.status === "QUEUED" || job?.status === "GENERATING";

  // poll the active job; on DONE pull the new refs, on FAILED surface the error
  useEffect(() => {
    if (!job || (job.status !== "QUEUED" && job.status !== "GENERATING")) return;
    let alive = true;
    const tick = setInterval(async () => {
      const jobs = await getRefGenJobs(entity.id);
      const latest = jobs[0];
      if (!alive || !latest) return;
      if (latest.status === "DONE") {
        clearInterval(tick);
        setJob({ status: "DONE", error: "" });
        router.refresh(); // server re-fetches the entity with its new images
      } else if (latest.status === "FAILED") {
        clearInterval(tick);
        setJob({ status: "FAILED", error: latest.error });
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(tick);
    };
  }, [job, entity.id, router]);

  // fal has no sub-call progress signal (it returns all images at once), so
  // show a live elapsed timer instead of a frozen-looking 0%
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startMs.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // resume an in-flight refgen if the drawer was closed + reopened — job state is
  // local, so a remount would otherwise show no progress for a still-running gen
  useEffect(() => {
    let alive = true;
    getRefGenJobs(entity.id).then((jobs) => {
      const latest = jobs[0];
      if (alive && latest && (latest.status === "QUEUED" || latest.status === "GENERATING")) {
        startMs.current = Date.now();
        setJob({ status: latest.status, error: "" });
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [entity.id]);

  function generate() {
    startMs.current = Date.now();
    setElapsed(0);
    run(
      () => startRefGen({ entityId: entity.id, prompt, count, model: "seedream" }),
      (res) => {
        if (res && "id" in res) setJob({ status: "QUEUED", error: "" });
      },
    );
  }

  const cost = (count * REFGEN_PRICE_USD_PER_IMAGE).toFixed(2);
  return (
    <div className="al-panel al-panel-flat" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, borderRadius: "var(--radius-md)" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <MonoLabel>Generate references</MonoLabel>
        <span style={{ flex: 1 }} />
        {conditioned && (
          <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>
            using {entity.refs.length} image{entity.refs.length > 1 ? "s" : ""} as reference
          </span>
        )}
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={busy}
        rows={3}
        aria-label="Generation prompt"
        style={{
          width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid var(--line-2)",
          borderRadius: "var(--radius-md)", padding: "9px 12px", color: "var(--fg-1)",
          font: "var(--text-small)", resize: "vertical", outline: "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{ font: "var(--text-caption)", color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 6 }}>
          count
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            disabled={busy}
            aria-label="Number of images"
            style={{ background: "rgba(255,255,255,.05)", border: "1px solid var(--line-2)", borderRadius: 6, color: "var(--fg-1)", padding: "3px 6px", font: "var(--text-caption)" }}
          >
            {[1, 2, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <Button size="sm" onClick={generate} disabled={busy || prompt.trim().length === 0}>
          {busy ? `Generating ${count}… ${elapsed}s` : `Generate ${count} (~$${cost})`}
        </Button>
        <span style={{ flex: 1 }} />
        <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>Seedream</span>
      </div>
      {busy && (
        <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>
          Working with Seedream — {count} image{count > 1 ? "s" : ""} usually takes {count <= 2 ? "20–40s" : "about a minute"}. They appear here when ready.
        </p>
      )}
      {(error || job?.status === "FAILED") && (
        <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: 0 }}>
          {error ?? job?.error ?? "Generation failed."} — try again.
        </p>
      )}
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

  const textareaStyle: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid var(--line-2)",
    borderRadius: "var(--radius-md)", padding: "10px 14px", color: "var(--fg-1)",
    font: "var(--text-body)", resize: "vertical", outline: "none",
  };

  // shared by the click-picker and drag-drop: size/count-guard then upload.
  // Surface any reason files were dropped, but still upload the accepted subset.
  function uploadFiles(list: File[]) {
    const r = acceptImages(list, entity.refs.length);
    if (r.error) refAct.setError(r.error);
    if (!r.files.length) return;
    const fd = new FormData();
    for (const f of r.files) fd.append("files", f);
    refAct.run(async () => {
      const res = await addReferenceImages(entity.id, fd);
      if (fileRef.current) fileRef.current.value = "";
      return res;
    });
  }

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 99, background: meta.color, display: "inline-block" }} aria-hidden />
        <MonoLabel>{meta.singular}</MonoLabel>
        <span style={{ flex: 1 }} />
        <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>
          {entity.usageCount > 0
            ? `mentioned in ${entity.usageCount} shot${entity.usageCount > 1 ? "s" : ""}`
            : "not mentioned yet"}
        </span>
        {/* autoFocus: move focus into the drawer on open; Escape (on the aside) closes */}
        <IconButton label="Close" size="sm" onClick={onClose} autoFocus>
          <IcX />
        </IconButton>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (!name.trim()) return setName(entity.name); // empty would no-op server-side — revert
          if (name !== entity.name) fieldAct.run(() => updateEntity(entity.id, { name }));
        }}
        aria-label="Element name"
        style={{
          background: "none", border: "none", outline: "none", color: "var(--fg-1)",
          font: "var(--text-title)", letterSpacing: "var(--tracking-tight)", padding: 0,
        }}
      />

      {/* aliases — the @mention search matches these too */}
      <div>
        <MonoLabel style={{ display: "block", marginBottom: 7 }}>Aliases</MonoLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {entity.aliases.map((a) => (
            <span key={a} className="alias-chip" data-entity-type={entity.type}>
              {a}
              <button
                aria-label={`Remove alias ${a}`}
                disabled={aliasAct.pending}
                onClick={() => aliasAct.run(() => removeEntityAlias(entity.id, a))}
                style={{ background: "none", border: "none", color: "inherit", opacity: 0.6, cursor: "pointer", padding: "0 0 0 4px" }}
              >
                ×
              </button>
            </span>
          ))}
          <span className="al-input-wrap" style={{ width: 110 }}>
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
              disabled={aliasAct.pending}
              style={{ padding: "6px 0", fontSize: 12 }}
            />
          </span>
        </div>
        {aliasAct.error && (
          <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: "6px 0 0" }}>{aliasAct.error}</p>
        )}
        <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: "6px 0 0" }}>
          Nicknames the @ search should also match — e.g. “the girl”, “MAYA”.
        </p>
      </div>

      {/* reference images */}
      <div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 7 }}>
          <MonoLabel>References · {entity.refs.length}</MonoLabel>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" disabled={refAct.pending} onClick={() => fileRef.current?.click()}>
            {refAct.pending ? "Working…" : "+ Add"}
          </Button>
        </div>
        {entity.refs.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <GenerateRefsBlock entity={entity} />
            <button className="drop-zone" onClick={() => fileRef.current?.click()} type="button"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); uploadFiles([...e.dataTransfer.files]); }}>
              <span className="drop-zone-tile"><IcImage size={16} /></span>
              <span>
                Or drop / add 3–12 images you already have (front / side / ¾ angles).{" "}
                <span style={{ color: "var(--fg-1)", textDecoration: "underline", textUnderlineOffset: 3 }}>Upload →</span>
              </span>
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="thumb-strip">
              {entity.refs.map((r) => (
                <span key={r.id} style={{ position: "relative" }} className="group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="ref-thumb" src={r.url} alt="" />
                  <button
                    aria-label="Remove reference image"
                    disabled={refAct.pending}
                    onClick={() => refAct.run(() => softDeleteReferenceImage(r.id))}
                    style={{
                      position: "absolute", top: 2, right: 2, width: 18, height: 18,
                      borderRadius: 99, border: "none", cursor: "pointer",
                      background: "rgba(6,8,11,.75)", color: "var(--fg-2)", fontSize: 11,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            {/* generate MORE — conditioned on the images above (e.g. a logo → a garment) */}
            <GenerateRefsBlock entity={entity} />
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          aria-label="Add reference images"
          onChange={(e) => uploadFiles([...(e.target.files ?? [])])}
        />
        {refAct.error && (
          <p role="alert" style={{ font: "var(--text-caption)", color: "var(--danger)", margin: "6px 0 0" }}>{refAct.error}</p>
        )}
      </div>

      <label className="al-field">
        <span className="al-field-label">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== entity.notes) fieldAct.run(() => updateEntity(entity.id, { notes }));
          }}
          placeholder="Style cues, wardrobe, lighting, materials…"
          rows={3}
          style={textareaStyle}
        />
      </label>

      <label className="al-field">
        <span className="al-field-label">Negative constraints</span>
        <textarea
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
          onBlur={() => {
            if (negative !== entity.negativeConstraints)
              fieldAct.run(() => updateEntity(entity.id, { negativeConstraints: negative }));
          }}
          placeholder="What must never appear — e.g. glasses, beard, modern cars…"
          rows={2}
          style={textareaStyle}
        />
      </label>

      {fieldAct.error && (
        <p role="alert" style={{ font: "var(--text-small)", color: "var(--danger)", margin: 0 }}>
          {fieldAct.error} — your edit was not saved; change the field again to retry.
        </p>
      )}

      <div>
        <Button
          variant="danger"
          size="sm"
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
        </Button>
        {dangerAct.error && (
          <p role="alert" style={{ font: "var(--text-small)", color: "var(--danger)", margin: "8px 0 0" }}>{dangerAct.error}</p>
        )}
      </div>
    </div>
  );
}
