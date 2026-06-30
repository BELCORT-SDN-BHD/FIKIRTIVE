"use client";
import React, { useState } from "react";
import { Download, Users, Images, Pencil, Trash2, Check, X, Search, AlertCircle, Film, ImageIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EntityDTO } from "@/lib/types";
import type { AdJobItem } from "@/lib/data";
import { groupEntitiesByType } from "@/lib/entity-grouping";
import { updateEntity, softDeleteEntity } from "@/lib/actions";
import { bustUrl } from "@/lib/media-retry";

export interface AdTile {
  id: string;
  src: string;
  kind: "image" | "video";
  prompt: string;
  createdAt: string;
}

export interface OttoStuffProps {
  entities: EntityDTO[];
  ads: AdTile[];
  adJobs: AdJobItem[];
}

function EntityTile({
  e,
  onRename,
  onDelete,
}: {
  e: EntityDTO;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => void;
}) {
  const baseUrl = e.refs.find((r) => r.assetId === e.baseAssetId)?.url ?? e.refs[0]?.url ?? null;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(e.name);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [imgAttempt, setImgAttempt] = useState(0);
  const [imgErrored, setImgErrored] = useState(false);
  const imgSrc = baseUrl ? (imgAttempt === 0 ? baseUrl : bustUrl(baseUrl, imgAttempt)) : null;

  async function saveRename() {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === e.name) { setEditing(false); return; }
    setSaving(true);
    setEditError(null);
    const res = await updateEntity(e.id, { name: trimmed });
    if ("error" in res) {
      setEditError(res.error);
      setSaving(false);
    } else {
      onRename(e.id, trimmed);
      setEditing(false);
      setSaving(false);
    }
  }

  function cancelRename() {
    setEditName(e.name);
    setEditError(null);
    setEditing(false);
  }

  function handleEntityImgError() {
    if (imgAttempt < 2) setImgAttempt((a) => a + 1);
    else setImgErrored(true);
  }

  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-card shadow-sm">
      <div className="flex aspect-square flex-col items-center justify-center gap-2 bg-muted">
        {imgErrored ? (
          <>
            <AlertCircle size={20} className="text-muted-foreground/70" />
            <span className="text-[0.75rem] text-muted-foreground">Couldn&apos;t load this</span>
            <button
              type="button"
              onClick={() => { setImgErrored(false); setImgAttempt((a) => a + 1); }}
              className="cursor-pointer border-none bg-none p-0 text-[0.75rem] text-brand underline"
            >
              Reload
            </button>
          </>
        ) : imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={imgSrc} src={imgSrc} alt={e.name} className="h-full w-full object-cover" onError={handleEntityImgError} />
        ) : (
          <>
            <Users size={28} className="text-muted-foreground/70" />
            <span className="text-[0.75rem] text-muted-foreground/70">No image yet</span>
          </>
        )}
      </div>
      <div className="px-3 py-2.5">
        {editing ? (
          <div>
            <Input
              value={editName}
              onChange={(ev) => setEditName(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter") saveRename(); if (ev.key === "Escape") cancelRename(); }}
              autoFocus
            />
            {editError && <div role="alert" className="mb-1 text-[0.75rem] text-[var(--error-soft-foreground)]">{editError}</div>}
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={saveRename} disabled={saving} aria-label="Save"><Check size={14} /></Button>
              <Button variant="ghost" size="sm" onClick={cancelRename} aria-label="Cancel"><X size={14} /></Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-1">
              <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.875rem] font-semibold text-foreground">
                {e.name}
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setEditName(e.name); setEditError(null); setEditing(true); }} aria-label="Rename"><Pencil size={13} /></Button>
              <Button variant="ghost" size="sm" onClick={() => onDelete(e.id)} aria-label="Delete"><Trash2 size={13} /></Button>
            </div>
            {editError && <div role="alert" className="mt-0.5 text-[0.75rem] text-[var(--error-soft-foreground)]">{editError}</div>}
            <div className="mt-0.5 text-[0.75rem] text-muted-foreground/70">
              {e.type.toLowerCase()} · used {e.usageCount} {e.usageCount === 1 ? "time" : "times"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AdJobCard({ job }: { job: AdJobItem }) {
  const isProcessing = job.status === "processing";
  const pillClass = isProcessing
    ? "bg-warning-soft text-warning-soft-foreground"
    : "bg-error-soft text-[var(--error-soft-foreground)]";
  const pillLabel = isProcessing ? "Processing…" : "Didn't go through";
  const when = new Date(job.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="flex flex-col gap-2 rounded-[20px] border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground/70">
          {job.kind === "video" ? <Film size={15} /> : <ImageIcon size={15} />}
        </span>
        <span className={`rounded-[99px] px-2 py-0.5 text-[0.75rem] font-medium ${pillClass}`}>
          {pillLabel}
        </span>
      </div>
      {job.prompt && (
        <div className="overflow-hidden text-[0.75rem] text-muted-foreground [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">
          {job.prompt}
        </div>
      )}
      <div className="text-[0.75rem] text-muted-foreground/70">{when}</div>
    </div>
  );
}

function AdMediaTile({ ad }: { ad: AdTile }) {
  const ext = ad.src.split("?")[0].split(".").pop() || (ad.kind === "video" ? "mp4" : "png");
  const filename = `fikirtive-${ad.id.slice(0, 8)}.${ext}`;
  const [attempt, setAttempt] = useState(0);
  const [errored, setErrored] = useState(false);
  const src = attempt === 0 ? ad.src : bustUrl(ad.src, attempt);

  function handleMediaError() {
    if (attempt < 2) setAttempt((a) => a + 1);
    else setErrored(true);
  }

  const mediaAlt = ad.prompt ? `Generated image: ${ad.prompt}` : "Generated image";

  return (
    <div className="relative overflow-hidden rounded-[20px] border border-border bg-muted">
      {errored ? (
        <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 p-6">
          <AlertCircle size={20} className="text-muted-foreground/70" />
          <span className="text-[0.75rem] text-muted-foreground">Couldn&apos;t load this</span>
          <button
            type="button"
            onClick={() => { setErrored(false); setAttempt((a) => a + 1); }}
            className="cursor-pointer border-none bg-none p-0 text-[0.75rem] text-brand underline"
          >
            Reload
          </button>
        </div>
      ) : ad.kind === "video" ? (
        <video key={src} src={src} controls muted loop playsInline className="block w-full" onError={handleMediaError} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt={mediaAlt} className="block w-full" onError={handleMediaError} />
      )}
      <a
        href={ad.src}
        download={filename}
        aria-label="Download"
        title="Download"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          borderRadius: 10,
          background: "rgba(20,20,20,.6)",
          color: "#fff",
        }}
      >
        <Download size={16} />
      </a>
    </div>
  );
}

export function OttoStuff({ entities, ads, adJobs }: OttoStuffProps) {
  const [tab, setTab] = useState<"cast" | "ads">("cast");
  const [items, setItems] = useState<EntityDTO[]>(entities);
  const [search, setSearch] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleRename(id: string, newName: string) {
    setItems((cur) => cur.map((e) => (e.id === id ? { ...e, name: newName } : e)));
  }

  async function handleDelete(id: string) {
    const snapshot = items.find((e) => e.id === id);
    setItems((cur) => cur.filter((e) => e.id !== id));
    setDeleteError(null);
    const res = await softDeleteEntity(id);
    if ("error" in res) {
      setItems((cur) => (snapshot ? [...cur, snapshot] : cur));
      setDeleteError(res.error);
    }
  }

  const groups = groupEntitiesByType(items, search);

  return (
    // leading-[1.65] pins the line-height this subtree currently INHERITS from the .fk
    // ancestor (--leading-relaxed); it survives S4 teardown (when .fk/otto-theme.css is
    // removed and .gb — which sets no line-height — applies at the root). Value-identical
    // today → zero visual change; without it the text compacts post-teardown.
    <div className="otto-stuff-scroll gb flex-1 overflow-auto p-6 leading-[1.65]">
      <style>{`
        @media (max-width: 680px) {
          .otto-stuff-scroll { padding: var(--space-4) var(--space-3) !important; }
        }
      `}</style>
      <div className="mx-auto max-w-[880px]">
        <h1 className="m-0 mb-4 text-[1.75rem] font-bold text-foreground">
          My stuff
        </h1>
        <div className="mb-5 max-w-[280px]">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "cast" | "ads")}>
            <TabsList className="w-full justify-start h-auto! gap-1 rounded-[14px] bg-muted p-1">
              <TabsTrigger
                value="cast"
                className="flex-none h-auto border-0 rounded-[10px] px-3.5 py-1.5 text-[0.875rem] font-medium text-muted-foreground data-[state=active]:bg-card data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-xs"
              >
                Cast
              </TabsTrigger>
              <TabsTrigger
                value="ads"
                className="flex-none h-auto border-0 rounded-[10px] px-3.5 py-1.5 text-[0.875rem] font-medium text-muted-foreground data-[state=active]:bg-card data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-xs"
              >
                Ads
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {tab === "cast" ? (
          items.length === 0 ? (
            <EmptyCast />
          ) : (
            <>
              {deleteError && (
                <div role="alert" className="mb-3 rounded-[14px] bg-error-soft px-3 py-2 text-[0.875rem] text-[var(--error-soft-foreground)]">
                  {deleteError}
                </div>
              )}
              {/* Search */}
              <div className="relative mb-5 max-w-[320px]">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  value={search}
                  onChange={(ev) => setSearch(ev.target.value)}
                  placeholder="Search cast…"
                  aria-label="Search cast"
                  className="pl-10"
                />
              </div>

              {groups.length === 0 ? (
                <div className="py-4 text-[0.875rem] text-muted-foreground">
                  No matches for &ldquo;{search}&rdquo;
                </div>
              ) : (
                groups.map((group) => (
                  <section key={group.type} className="mb-7">
                    <h2 className="m-0 mb-3 text-[0.875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {group.label}
                    </h2>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
                      {group.items.map((e) => (
                        <EntityTile key={e.id} e={e} onRename={handleRename} onDelete={handleDelete} />
                      ))}
                    </div>
                  </section>
                ))
              )}
            </>
          )
        ) : adJobs.length === 0 && ads.length === 0 ? (
          <Empty icon={<Images size={28} />} text="No ads yet. When Otto makes something, it lands here — newest first." />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {adJobs.map((job) => (
              <AdJobCard key={job.id} job={job} />
            ))}
            {ads.map((ad) => (
              <AdMediaTile key={ad.id} ad={ad} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyCast() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-muted-foreground">
      <span className="text-muted-foreground/70">
        <Users size={32} />
      </span>
      <div>
        <div className="mb-1 text-[1rem] font-semibold text-foreground">
          Your cast lives here
        </div>
        <div className="max-w-[340px] text-[0.875rem] leading-relaxed">
          When you describe a person or product in a campaign, Otto saves it here so it stays consistent every time you use it.
        </div>
      </div>
      <div className="mt-2 rounded-[14px] bg-muted px-3 py-2 text-[0.75rem] text-muted-foreground/70">
        Just start a campaign — Otto will fill this in automatically.
      </div>
    </div>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center text-muted-foreground">
      <span className="text-muted-foreground/70">{icon}</span>
      <span className="max-w-[360px] text-[1rem]">{text}</span>
    </div>
  );
}

export default OttoStuff;
