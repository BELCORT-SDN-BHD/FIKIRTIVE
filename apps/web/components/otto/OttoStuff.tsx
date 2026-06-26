"use client";
import React, { useState } from "react";
import { Download, Users, Images, Pencil, Trash2, Check, X, Search, Film, ImageIcon } from "lucide-react";
import { Tabs, Button, Input } from "@/components/fk";
import type { EntityDTO } from "@/lib/types";
import type { AdJobItem } from "@/lib/data";
import { groupEntitiesByType } from "@/lib/entity-grouping";
import { updateEntity, softDeleteEntity } from "@/lib/actions";

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

  return (
    <div style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ aspectRatio: "1 / 1", background: "var(--surface-sunken)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6 }}>
        {baseUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={baseUrl} alt={e.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <>
            <Users size={28} color="var(--text-faint)" />
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>No image yet</span>
          </>
        )}
      </div>
      <div style={{ padding: "10px 12px" }}>
        {editing ? (
          <div>
            <Input
              value={editName}
              onChange={(ev) => setEditName(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter") saveRename(); if (ev.key === "Escape") cancelRename(); }}
              autoFocus
            />
            {editError && <div role="alert" style={{ fontSize: "var(--text-xs)", color: "var(--error-700)", marginBottom: 4 }}>{editError}</div>}
            <div style={{ display: "flex", gap: 4 }}>
              <Button variant="ghost" size="sm" onClick={saveRename} disabled={saving} aria-label="Save"><Check size={14} /></Button>
              <Button variant="ghost" size="sm" onClick={cancelRename} aria-label="Cancel"><X size={14} /></Button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ flex: 1, fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-sm)", color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.name}
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setEditName(e.name); setEditError(null); setEditing(true); }} aria-label="Rename"><Pencil size={13} /></Button>
              <Button variant="ghost" size="sm" onClick={() => onDelete(e.id)} aria-label="Delete"><Trash2 size={13} /></Button>
            </div>
            {editError && <div role="alert" style={{ fontSize: "var(--text-xs)", color: "var(--error-700)", marginTop: 2 }}>{editError}</div>}
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", marginTop: 2 }}>
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
  const pillBg = isProcessing ? "var(--warning-100, #fef3c7)" : "var(--error-100, #fee2e2)";
  const pillColor = isProcessing ? "var(--warning-700, #b45309)" : "var(--error-700, #b91c1c)";
  const pillLabel = isProcessing ? "Processing…" : "Didn't go through";
  const when = new Date(job.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div style={{ borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span style={{ color: "var(--text-faint)" }}>
          {job.kind === "video" ? <Film size={15} /> : <ImageIcon size={15} />}
        </span>
        <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-medium)" as React.CSSProperties["fontWeight"], padding: "2px 8px", borderRadius: 99, background: pillBg, color: pillColor }}>
          {pillLabel}
        </span>
      </div>
      {job.prompt && (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {job.prompt}
        </div>
      )}
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>{when}</div>
    </div>
  );
}

function AdMediaTile({ ad }: { ad: AdTile }) {
  const ext = ad.src.split("?")[0].split(".").pop() || (ad.kind === "video" ? "mp4" : "png");
  const filename = `fikirtive-${ad.id.slice(0, 8)}.${ext}`;
  const altText = ad.prompt?.slice(0, 60) || "Generated ad";
  return (
    <div style={{ position: "relative", borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      {ad.kind === "video" ? (
        <video src={ad.src} controls muted loop playsInline style={{ width: "100%", display: "block" }} aria-label={altText} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.src} alt={altText} style={{ width: "100%", display: "block" }} />
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
    <div style={{ flex: 1, overflow: "auto", padding: "var(--space-6)" }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-2xl)", color: "var(--text-strong)", margin: "0 0 var(--space-4)" }}>
          My stuff
        </h1>
        <div style={{ marginBottom: "var(--space-5)", maxWidth: 280 }}>
          <Tabs
            items={[
              { value: "cast", label: "Cast" },
              { value: "ads", label: "Ads" },
            ]}
            value={tab}
            onChange={(v) => setTab(v as "cast" | "ads")}
          />
        </div>

        {tab === "cast" ? (
          items.length === 0 ? (
            <Empty icon={<Users size={28} />} text="No cast yet. Otto saves the people and products you use, so they stay consistent." />
          ) : (
            <>
              {deleteError && (
                <div role="alert" style={{ fontSize: "var(--text-sm)", color: "var(--error-700)", marginBottom: "var(--space-3)", padding: "var(--space-2) var(--space-3)", background: "var(--error-50)", borderRadius: "var(--radius-md)" }}>
                  {deleteError}
                </div>
              )}
              {/* Search */}
              <div style={{ marginBottom: "var(--space-5)", maxWidth: 320, position: "relative" }}>
                <Input
                  value={search}
                  onChange={(ev) => setSearch(ev.target.value)}
                  placeholder="Search cast…"
                  aria-label="Search cast"
                  leftIcon={<Search size={15} />}
                />
              </div>

              {groups.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", padding: "var(--space-4) 0" }}>
                  No matches for &ldquo;{search}&rdquo;
                </div>
              ) : (
                groups.map((group) => (
                  <section key={group.type} style={{ marginBottom: "var(--space-7)" }}>
                    <h2 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 var(--space-3)" }}>
                      {group.label}
                    </h2>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "var(--space-4)" }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "var(--space-4)" }}>
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

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "var(--space-8) var(--space-4)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)" }}>
      <span style={{ color: "var(--text-faint)" }}>{icon}</span>
      <span style={{ fontSize: "var(--text-base)", maxWidth: 360 }}>{text}</span>
    </div>
  );
}

export default OttoStuff;
