"use client";
import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EntityDTO } from "@/lib/types";
import { TEMPLATES, filterTemplates, templateCategories, type Template } from "@/lib/templates";
import TemplateModal from "./TemplateModal";

const ALL = "All";

export default function OttoTemplates({ projectId, entities = [] }: { projectId: string; entities?: EntityDTO[] }) {
  const [active, setActive] = useState<Template | null>(null);
  const [category, setCategory] = useState<string>(ALL);
  const [search, setSearch] = useState("");

  const categories = useMemo(() => [ALL, ...templateCategories(TEMPLATES)], []);
  const shown = useMemo(() => filterTemplates(TEMPLATES, { category, search }), [category, search]);

  // leading-[1.5] — design-baseline body line-height (Analytics standard)
  return (
    <div className="gb leading-[1.5] flex flex-1 flex-col overflow-auto p-5">
      <div className="mb-4">
        <h2 className="m-0 text-lg text-foreground">Templates</h2>
        <p className="mt-1 mb-0 text-sm text-muted-foreground">
          Pick a scene, add your product photo, get a polished image. Every one is written for Malaysian shops.
        </p>
      </div>

      <div className="mb-3 max-w-sm">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search — Raya, delivery, Shopee, before and after…"
          aria-label="Search templates"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {categories.map((c) => (
          <Button
            key={c}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className={category === c ? "bg-card" : ""}
          >
            {c}
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing matches that. Try a shorter word, or clear the search.
        </p>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
          {shown.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t)}
              className="min-w-0 cursor-pointer rounded-[var(--radius-card)] border border-border bg-card p-4 text-left text-foreground transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
            >
              <div className="text-[0.9375rem] font-semibold">{t.name}</div>
              <div className="mt-1 text-[0.8125rem] text-muted-foreground">{t.description}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="outline">{t.category}</Badge>
                {t.rendersHeadline && <Badge variant="soft">Your headline on it</Badge>}
              </div>
            </button>
          ))}
        </div>
      )}

      {active && (
        <TemplateModal template={active} projectId={projectId} entities={entities} onClose={() => setActive(null)} />
      )}
    </div>
  );
}
