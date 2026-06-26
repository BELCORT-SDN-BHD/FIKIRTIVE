"use client";
import React, { useState } from "react";
import { Download, Users, Images } from "lucide-react";
import { Tabs } from "@/components/fk";
import type { EntityDTO } from "@/lib/types";

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
  return (
    <div style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ aspectRatio: "1 / 1", background: "var(--surface-sunken)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {baseUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={baseUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
  return (
    <div style={{ position: "relative", borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)" }}>
      {ad.kind === "video" ? (
        <video src={ad.src} controls muted loop playsInline style={{ width: "100%", display: "block" }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.src} alt="" style={{ width: "100%", display: "block" }} />
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
            <EmptyCast />
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
