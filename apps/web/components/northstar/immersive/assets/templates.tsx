"use client";

/**
 * 沉浸式 · Templates —— 官方起点 + 私有「我的模板」(全真图)。原生重建。
 * 卡 → 详情 → Use template → canvas(?from=<id>,连接器 1)。
 * [wave-b] B-09 品牌锁定模板:成稿「存为我的模板」+ Locked 标记(编辑态只许改文案/图片位)。
 * [wave-b] B-11 私有模板库:仅「存为我的模板」半边(私有,不公开分享/不做分成),浏览限自己。
 */

import * as React from "react";
import Link from "next/link";
import { Lock, LayoutTemplate, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchField, SegChips } from "@/components/northstar/assets/_zone";
import { TEMPLATE_CATEGORIES, TEMPLATE_ITEMS, type TemplateItem } from "@/components/northstar/assets/_data";
import { PageHeader, EmptyState, AssetsNav, ASSETS_BASE } from "./kit";

interface MyTemplate {
  id: string;
  name: string;
  from: string; // 源官方模板名
  preview: string;
  surface: string;
}

export function AssetsTemplates() {
  const [tab, setTab] = React.useState<"official" | "mine">("official");
  const [category, setCategory] = React.useState("All");
  const [query, setQuery] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [saveFor, setSaveFor] = React.useState<TemplateItem | null>(null);
  const [saveName, setSaveName] = React.useState("");
  // [wave-b] B-11:私有模板存进本地列表(不跨商家分享;页级 UI 状态,非跨区事实)。
  const [mine, setMine] = React.useState<MyTemplate[]>([]);

  const visible = TEMPLATE_ITEMS.filter(
    (t) =>
      (category === "All" || t.category === category) &&
      (query.trim() === "" || t.name.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const open = TEMPLATE_ITEMS.find((t) => t.id === openId) ?? null;

  const saveAsTemplate = () => {
    if (!saveFor || saveName.trim() === "") return;
    setMine((prev) => [
      { id: `my-${saveFor.id}-${prev.length}`, name: saveName.trim(), from: saveFor.name, preview: saveFor.preview, surface: saveFor.surface },
      ...prev,
    ]);
    setSaveFor(null);
    setSaveName("");
    setOpenId(null);
    setTab("mine");
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1280px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Templates"
        subtitle="Official starting points, tuned for food and drink shops. Pick one and make it yours."
        actions={<AssetsNav />}
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SegChips
          options={[
            { key: "official", label: "Official" },
            { key: "mine", label: `My templates${mine.length ? ` · ${mine.length}` : ""}` },
          ]}
          value={tab}
          onChange={(k) => setTab(k as "official" | "mine")}
          ariaLabel="Template source"
        />
        {tab === "official" && (
          <>
            <SearchField value={query} onChange={setQuery} placeholder="Search templates" className="max-w-[240px]" />
            <SegChips
              options={TEMPLATE_CATEGORIES.map((c) => ({ key: c, label: c }))}
              value={category}
              onChange={setCategory}
              ariaLabel="Filter templates by category"
            />
          </>
        )}
      </div>

      <div className="mt-6 flex flex-1 flex-col">
        {tab === "official" ? (
          visible.length === 0 ? (
            <EmptyState icon={LayoutTemplate} title="Nothing matches this filter." />
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
              {visible.map((t) => (
                <TemplateCard key={t.id} template={t} onOpen={() => setOpenId(t.id)} />
              ))}
            </div>
          )
        ) : mine.length === 0 ? (
          <EmptyState
            icon={LayoutTemplate}
            title="No saved templates yet"
            body="Open an official template and save your version. It stays private to your shop — layout locked, only text and photos change."
            action={
              <Button variant="secondary" size="sm" onClick={() => setTab("official")}>
                Browse official
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {mine.map((t) => (
              <MyTemplateCard key={t.id} template={t} />
            ))}
          </div>
        )}
      </div>

      {/* 模板详情 — Use template → canvas;+ Save as my template(B-09/B-11) */}
      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="max-w-[min(560px,calc(100vw-2rem))]">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.name}</DialogTitle>
                <DialogDescription>
                  {open.category} · {open.surface}
                </DialogDescription>
              </DialogHeader>
              <div className="flex max-h-[260px] items-center justify-center overflow-hidden rounded-[14px] border border-border bg-secondary">
                {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img> 热链 NS_IMAGES */}
                <img src={open.preview} alt={open.name} className="max-h-[260px] w-auto object-contain" />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm leading-[20px] text-foreground">{open.blurb}</p>
                <div className="rounded-[14px] bg-secondary/70 p-3">
                  <p className="text-xs font-medium text-muted-foreground">{"What's inside"}</p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {open.includes.map((inc) => (
                      <li key={inc} className="flex items-baseline gap-2 text-sm leading-[20px] text-foreground">
                        <span aria-hidden className="size-1 shrink-0 translate-y-[-2px] rounded-full bg-muted-foreground" />
                        {inc}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSaveFor(open);
                    setSaveName(`My ${open.name}`);
                  }}
                >
                  <Plus strokeWidth={2} />
                  Save as my template
                </Button>
                <Button asChild>
                  <Link href={`${ASSETS_BASE}/create/canvas?from=${open.id}`}>Use template</Link>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* [wave-b] B-09:存为品牌模板 — 命名 + 说明「版式锁定,只改文案/图片位」 */}
      <Dialog open={saveFor !== null} onOpenChange={(v) => !v && setSaveFor(null)}>
        <DialogContent className="max-w-[min(480px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Save as my template</DialogTitle>
            <DialogDescription>
              Stays private to your shop. The layout is locked — you or your team can only change the text and photos.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveAsTemplate();
            }}
          >
            <div className="flex flex-col gap-2">
              <label htmlFor="tpl-save-name" className="text-[13px] font-semibold text-foreground">
                Template name
              </label>
              <Input id="tpl-save-name" value={saveName} onChange={(e) => setSaveName(e.target.value)} autoFocus />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" strokeWidth={2} />
                Layout locked · text and photos stay editable
              </p>
            </div>
            <DialogFooter className="mt-5">
              <Button type="button" variant="secondary" onClick={() => setSaveFor(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveName.trim() === ""}>
                Save template
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateCard({ template, onOpen }: { template: TemplateItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-2 rounded-[var(--radius-card)] text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img> 热链 NS_IMAGES */}
        <img
          src={template.preview}
          alt={template.name}
          className="aspect-[4/5] w-full object-cover transition-transform duration-150 group-hover:scale-[1.02]"
        />
        <span className="absolute top-2 left-2 inline-flex h-6 items-center rounded-full border border-border bg-card px-2 text-[11px] leading-none font-semibold text-muted-foreground">
          {template.surface}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <p className="truncate text-sm font-semibold text-foreground">{template.name}</p>
        <p className="line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">{template.blurb}</p>
      </div>
    </button>
  );
}

function MyTemplateCard({ template }: { template: MyTemplate }) {
  return (
    <div className="group flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- 原型层用 <img> 热链 NS_IMAGES */}
        <img src={template.preview} alt={template.name} className="aspect-[4/5] w-full object-cover" />
        <span className="absolute top-2 left-2 inline-flex h-6 items-center gap-1 rounded-full border border-border bg-card px-2 text-[11px] leading-none font-semibold text-muted-foreground">
          <Lock className="size-3" strokeWidth={2} />
          Locked
        </span>
        <div className="absolute inset-x-2 bottom-2 flex justify-end opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <Button size="sm" asChild>
            <Link href={`${ASSETS_BASE}/create/canvas?from=${template.id.replace(/^my-/, "").replace(/-\d+$/, "")}`}>
              Use
            </Link>
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{template.name}</p>
          <Badge variant="outline">Private</Badge>
        </div>
        <p className="truncate text-[13px] leading-[18px] text-muted-foreground">From {template.from}</p>
      </div>
    </div>
  );
}
