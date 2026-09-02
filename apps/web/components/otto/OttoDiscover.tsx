"use client";
import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { INSPIRATIONS, inspirationCategories, type Inspiration } from "@/lib/inspirations";

/**
 * `onUseInOtto` 是**可选**的(W2-5):这块内容从 `/otto?view=discover` 收编成 `/create` 页面
 * 下方的 `#ideas` 区段。全局 Otto 面板已经存在,但当前还没有一条把这段 prompt 预填进
 * composer 的共享接口,所以 `/create` 暂时**不给**这个回调 —— 按钮随之不画。
 *
 * 为什么不留一颗按了没反应的按钮:一颗承诺了却做不到的控件,比没有这颗按钮更糟。商家在
 * `/create` 上仍然可以 Copy prompt,贴进这一页顶上那个唯一的开工框。共享预填接口接通时,
 * 把回调传进来即可,这里不用复制另一套卡片或弹窗。
 */
export default function OttoDiscover({ onUseInOtto }: { onUseInOtto?: (prompt: string) => void }) {
  const [cat, setCat] = useState<string>("All");
  const [active, setActive] = useState<Inspiration | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const cats = ["All", ...inspirationCategories(INSPIRATIONS)];
  const shown = cat === "All" ? INSPIRATIONS : INSPIRATIONS.filter((i) => i.category === cat);

  async function copy(prompt: string) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(prompt);
      ok = true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = prompt;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        ok = document.execCommand("copy");
        textarea.remove();
      } catch {
        ok = false;
      }
    }
    setCopyStatus(ok ? "copied" : "failed");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyStatus("idle"), 1500);
  }

  return (
    <div className="gb mx-auto flex w-full max-w-[1120px] flex-col px-6 py-12 leading-[1.5]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold tracking-[-0.012em] text-foreground">Ideas</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Browse useful starting points, then adjust the prompt to fit your product.
          </p>
        </div>
        <Badge variant="outline" className="font-mono tabular-nums">
          {shown.length} shown
        </Badge>
      </div>

      <ToggleGroup
        type="single"
        value={cat}
        onValueChange={(value) => value && setCat(value)}
        variant="outline"
        size="sm"
        spacing={1}
        className="mt-5 max-w-full flex-wrap"
        aria-label="Idea category"
      >
        {cats.map((c) => (
          <ToggleGroupItem
            key={c}
            value={c}
            className="rounded-lg px-3"
          >
            {c}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
        {shown.map((i) => (
          <Card
            key={i.id}
            size="sm"
            className="relative h-full gap-3 shadow-none transition-[border-color,box-shadow] duration-[var(--dur-1)] hover:border-line-strong hover:shadow-[var(--shadow-sm)]"
          >
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <Badge variant="outline">{i.category}</Badge>
                <Lightbulb aria-hidden="true" className="text-muted-foreground" />
              </div>
              <CardTitle className="mt-1">{i.title}</CardTitle>
              <CardDescription className="line-clamp-2 leading-5">{i.description}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto text-xs leading-5 text-muted-foreground">
              Opens a reusable prompt you can copy and adapt.
            </CardContent>
            <CardFooter className="justify-end text-xs font-medium text-foreground">
              View prompt
              <ArrowUpRight aria-hidden="true" />
            </CardFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setActive(i)}
              className="absolute inset-0 h-full w-full rounded-[var(--radius-card)] bg-transparent p-0 hover:bg-transparent active:scale-[0.99]"
              aria-label={`Open ${i.title} idea`}
            >
              <span className="sr-only">Open {i.title} idea</span>
            </Button>
          </Card>
        ))}
      </div>

      {active && (
        <Dialog open onOpenChange={(open) => { if (!open) setActive(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{active.title}</DialogTitle>
              <DialogDescription>{active.category}</DialogDescription>
            </DialogHeader>
            <p className="text-sm leading-6 text-foreground">{active.description}</p>
            <Card size="sm" className="shadow-none">
              <CardHeader>
                <CardTitle>Prompt</CardTitle>
                <CardDescription>Replace the bracketed text before using it.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-[13px] leading-5 text-foreground">{active.prompt}</p>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">
              Tip: replace [your product] with your product name.
            </p>
            <DialogFooter>
              <Button variant="secondary" size="sm" onClick={() => copy(active.prompt)}>
                {copyStatus === "copied" ? (
                  <Check data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <Copy data-icon="inline-start" aria-hidden="true" />
                )}
                {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy prompt"}
              </Button>
              {onUseInOtto && (
                <Button variant="otto" size="sm" onClick={() => { onUseInOtto(active.prompt); setActive(null); }}>
                  Use in Otto
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
