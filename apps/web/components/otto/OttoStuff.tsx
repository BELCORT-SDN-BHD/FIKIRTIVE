"use client";
import React, { useState } from "react";
import { Download, Users, Images, Pencil, Trash2, Check, X, Search, AlertCircle } from "lucide-react";
import { Tabs, Button, Input } from "@/components/fk";
import type { EntityDTO } from "@/lib/types";
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
    <div style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ aspectRatio: "1 / 1", background: "var(--surface-sunken)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-2)" }}>
        {imgErrored ? (
          <>
            <AlertCircle size={20} color="var(--text-faint)" />
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Couldn&apos;t load this</span>
            <button
              type="button"
              onClick={() => { setImgErrored(false); setImgAttempt((a) => a + 1); }}
              style={{ fontSize: "var(--text-xs)", color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
            >
              Reload
            </button>
          </>
        ) : imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={imgSrc} src={imgSrc} alt={e.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={handleEntityImgError} />
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
    <div style={{ position: "relative", borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      {errored ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-2)",
            padding: "var(--space-6)",
            minHeight: 120,
          }}
        >
          <AlertCircle size={20} color="var(--text-faint)" />
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Couldn&apos;t load this</span>
          <button
            type="button"
            onClick={() => { setErrored(false); setAttempt((a) => a + 1); }}
            style={{ fontSize: "var(--text-xs)", color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
          >
            Reload
          </button>
        </div>
      ) : ad.kind === "video" ? (
        <video key={src} src={src} controls muted loop playsInline style={{ width: "100%", display: "block" }} onError={handleMediaError} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt={mediaAlt} style={{ width: "100%", display: "block" }} onError={handleMediaError} />
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

export function OttoStuff({ entities, ads }: OttoStuffProps) {
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
    <div className="otto-stuff-scroll" style={{ flex: 1, overflow: "auto", padding: "var(--space-6)" }}>
      <style>{`
        @media (max-width: 680px) {
          .otto-stuff-scroll { padding: var(--space-4) var(--space-3) !important; }
        }
      `}</style>
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
            <EmptyCast />
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
        ) : ads.length === 0 ? (
          <Empty icon={<Images size={28} />} text="No ads yet. When Otto makes something, it lands here — newest first." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "var(--space-4)" }}>
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "var(--space-10) var(--space-4)",
        gap: "var(--space-3)",
        color: "var(--text-muted)",
      }}
    >
      <span style={{ color: "var(--text-faint)" }}>
        <Users size={32} />
      </span>
      <div>
        <div
          style={{
            fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"],
            fontSize: "var(--text-base)",
            color: "var(--text-strong)",
            marginBottom: 4,
          }}
        >
          Your cast lives here
        </div>
        <div style={{ fontSize: "var(--text-sm)", maxWidth: 340, lineHeight: "var(--leading-relaxed)" }}>
          When you describe a person or product in a campaign, Otto saves it here so it stays consistent every time you use it.
        </div>
      </div>
      <div
        style={{
          marginTop: "var(--space-2)",
          fontSize: "var(--text-xs)",
          color: "var(--text-faint)",
          background: "var(--surface-sunken)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-2) var(--space-3)",
        }}
      >
        Just start a campaign — Otto will fill this in automatically.
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
