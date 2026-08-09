import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const metadata = { title: "Kitchensink · Grok-bright" };

// Phase 0 proof: renders the new shadcn components + OTTO, themed by globals.css
// (scoped to `.gb`). Throwaway — delete once the rework is underway.
export default function Kitchensink() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="gb" style={{ minHeight: "100dvh", padding: 40 }}>
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <svg width="48" height="44" viewBox="0 0 120 110" aria-hidden="true">
            <g fill="#EC5828">
              <ellipse cx="60" cy="64" rx="43" ry="22" />
              <circle cx="37" cy="52" r="18" />
              <circle cx="61" cy="40" r="24" />
              <circle cx="85" cy="53" r="17" />
            </g>
            <rect x="51" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
            <rect x="66" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
          </svg>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
              Grok-bright kitchensink
            </h1>
            <p className="text-muted-foreground" style={{ margin: 0, fontSize: 14 }}>
              shadcn components, themed by globals.css, scoped to .gb
            </p>
          </div>
        </div>

        <section style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button>Make my campaign</Button>
          <Button variant="brand">Make 3 more</Button>
          <Button variant="soft">Soft</Button>
          <Button variant="secondary">Review</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Delete</Button>
        </section>

        <section style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge>Default</Badge>
          <Badge variant="brand">Otto</Badge>
          <Badge variant="success">Live</Badge>
          <Badge variant="info">Scheduled</Badge>
          <Badge variant="warning">In review</Badge>
          <Badge variant="destructive">Failed</Badge>
        </section>

        <section style={{ maxWidth: 360 }}>
          <Input aria-label="Email" placeholder="you@studio.com" />
        </section>

        <Card style={{ maxWidth: 360 }}>
          <CardHeader>
            <CardTitle>Autumn menu launch</CardTitle>
            <CardDescription>Cozy and warm. 6 assets, built with Otto.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
