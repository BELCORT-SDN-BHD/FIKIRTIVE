"use client";
import React, { useState } from "react";
import { Download, Users, Images, AlertCircle } from "lucide-react";
import { Tabs } from "@/components/fk";
import type { EntityDTO } from "@/lib/types";
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

function EntityTile({ e }: { e: EntityDTO }) {
  const baseUrl = e.refs.find((r) => r.assetId === e.baseAssetId)?.url ?? e.refs[0]?.url ?? null;
  const [imgAttempt, setImgAttempt] = useState(0);
  const [imgErrored, setImgErrored] = useState(false);
  const imgSrc = baseUrl ? (imgAttempt === 0 ? baseUrl : bustUrl(baseUrl, imgAttempt)) : null;

  function handleEntityImgError() {
    if (imgAttempt < 2) setImgAttempt((a) => a + 1);
    else setImgErrored(true);
  }

  return (
    <div style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ aspectRatio: "1 / 1", background: "var(--surface-sunken)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {imgSrc && !imgErrored ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={imgSrc} src={imgSrc} alt={e.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={handleEntityImgError} />
        ) : (
          <Users size={28} color="var(--text-faint)" />
        )}
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-sm)", color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {e.name}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", marginTop: 2 }}>
          {e.type.toLowerCase()} · used {e.usageCount} {e.usageCount === 1 ? "time" : "times"}
        </div>
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
          entities.length === 0 ? (
            <Empty icon={<Users size={28} />} text="No cast yet. Otto saves the people and products you use, so they stay consistent." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "var(--space-4)" }}>
              {entities.map((e) => (
                <EntityTile key={e.id} e={e} />
              ))}
            </div>
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

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "var(--space-8) var(--space-4)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)" }}>
      <span style={{ color: "var(--text-faint)" }}>{icon}</span>
      <span style={{ fontSize: "var(--text-base)", maxWidth: 360 }}>{text}</span>
    </div>
  );
}

export default OttoStuff;
