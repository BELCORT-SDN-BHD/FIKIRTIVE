"use client";
/** Assets surface (Artlio Studio design) — cross-project media library. Mock. */
import { Button, Chip, IcFolder, IcImage, MonoLabel } from "@/components/ds";

export function Assets() {
  return (
    <div className="screen">
      <div className="screen-pad">
        <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "10px 0 6px" }}>
          <h1 style={{ font: "var(--text-display)", letterSpacing: "var(--tracking-display)", color: "var(--fg-1)", margin: 0 }}>
            Assets
          </h1>
        </div>

        <div className="filters-row" style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 8 }}>
          <Chip icon={<IcFolder size={14} />}>All projects</Chip>
          <Chip icon={<IcImage size={14} />}>All media</Chip>
          <Chip>Favorites</Chip>
          <span style={{ flex: 1 }} />
          <Chip>Date modified ▾</Chip>
        </div>

        <div style={{ display: "grid", placeItems: "center", minHeight: "52vh", textAlign: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span aria-hidden style={{ width: 200, height: 120, borderRadius: "var(--radius-lg)", background: "var(--glass-1)", border: "1px solid var(--line-2)", marginBottom: 18 }} />
            <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Your library is empty</h2>
            <p style={{ font: "var(--text-body)", color: "var(--fg-2)", margin: "4px 0 18px", maxWidth: 420 }}>
              Everything you generate is stored here for easy access, in any project.
            </p>
            <Button>Create new asset</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
