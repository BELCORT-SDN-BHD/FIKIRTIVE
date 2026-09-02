"use client";
import React, { useMemo, useState } from "react";
import { ArrowUpRight, Search, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

  return (
    <div className="gb mx-auto flex w-full max-w-[1120px] flex-col px-6 py-12 leading-[1.5]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold tracking-[-0.012em] text-foreground">Templates</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Start with a proven scene, add your product photo, and adapt it to your shop.
          </p>
        </div>
        <Badge variant="outline" className="font-mono tabular-nums">
          {shown.length} shown
        </Badge>
      </div>

      <div className="mt-5 max-w-md">
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search — Raya, delivery, Shopee, before and after…"
            aria-label="Search templates"
          />
        </InputGroup>
      </div>

      <ToggleGroup
        type="single"
        value={category}
        onValueChange={(value) => value && setCategory(value)}
        variant="outline"
        size="sm"
        spacing={1}
        className="mt-3 max-w-full flex-wrap"
        aria-label="Template category"
      >
        {categories.map((c) => (
          <ToggleGroupItem
            key={c}
            value={c}
            className="rounded-lg px-3"
          >
            {c}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {shown.length === 0 ? (
        <Empty className="mt-5 min-h-48 border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle className="text-base">No matching templates</EmptyTitle>
            <EmptyDescription>Try a shorter search or choose another category.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
          {shown.map((t) => (
            <Card
              key={t.id}
              size="sm"
              className="relative h-full gap-3 shadow-none transition-[border-color,box-shadow] duration-[var(--dur-1)] hover:border-line-strong hover:shadow-[var(--shadow-sm)]"
            >
              <CardHeader>
                <Badge variant="outline">{t.category}</Badge>
                <CardTitle className="mt-1">{t.name}</CardTitle>
                <CardDescription className="line-clamp-2 leading-5">{t.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t.needsImage ? "Product photo" : "No photo needed"}</span>
                <span aria-hidden="true">·</span>
                <span>{t.aspectRatio ?? "Source ratio"}</span>
              </CardContent>
              <CardFooter className="justify-between">
                {t.rendersHeadline ? <Badge>Adds your headline</Badge> : <span />}
                <span className="flex items-center gap-1 text-xs font-medium text-foreground">
                  Open
                  <ArrowUpRight aria-hidden="true" />
                </span>
              </CardFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setActive(t)}
                className="absolute inset-0 h-full w-full rounded-[var(--radius-card)] bg-transparent p-0 hover:bg-transparent active:scale-[0.99]"
                aria-label={`Open ${t.name} template`}
              >
                <span className="sr-only">Open {t.name} template</span>
              </Button>
            </Card>
          ))}
        </div>
      )}

      {active && (
        <TemplateModal template={active} projectId={projectId} entities={entities} onClose={() => setActive(null)} />
      )}
    </div>
  );
}
