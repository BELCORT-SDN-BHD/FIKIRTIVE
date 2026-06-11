"use client";
/** Elements surface (Artlio Studio design) — entity library (= current Library,
 *  cleaner). Mock cards; real data wires from the existing Library actions. */
import { Badge, Button, IcPlus } from "@/components/ds";

const ELEMENTS = [
  { handle: "@mara", kind: "CHARACTER", sources: 8, tint: "linear-gradient(135deg,#241d2e,#3a2f4f)" },
  { handle: "@vessel", kind: "OBJECT", sources: 4, tint: "linear-gradient(135deg,#1e2a28,#32504a)" },
];

export function Elements() {
  return (
    <div className="screen">
      <div className="screen-pad">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, margin: "10px 0 6px" }}>
          <div>
            <h1 style={{ font: "var(--text-display)", letterSpacing: "var(--tracking-display)", color: "var(--fg-1)", margin: 0 }}>
              Elements
            </h1>
            <p style={{ font: "var(--text-body)", color: "var(--fg-2)", margin: "6px 0 0", maxWidth: 480 }}>
              Lock a character or object once, then reference it in any prompt with @.
            </p>
          </div>
          <span style={{ flex: 1 }} />
          <Button icon={<IcPlus />}>New element</Button>
        </div>

        <div className="card-grid" style={{ marginTop: 22 }}>
          {ELEMENTS.map((e) => (
            <button key={e.handle} className="al-mediacard" style={{ textAlign: "left" }}>
              <span style={{ display: "block", aspectRatio: "1 / 1", background: e.tint }} />
              <span style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ font: "var(--text-body)", color: "var(--fg-1)" }}>{e.handle}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>{e.kind} · {e.sources} SOURCES</span>
                  <span style={{ flex: 1 }} />
                  <Badge>● Locked</Badge>
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
