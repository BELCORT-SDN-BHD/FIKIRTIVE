"use client";

/**
 * Customize home 面板(验收 FRONT-A4;设计权威
 * `design-system/patterns/founder-home/FounderHomeReference.tsx` 的 `CustomizeHomePanel`)。
 *
 * 与设计的**唯一**差别在数据,不在形状:面板只列今天在生产上有真实数据源的组件
 * (`lib/home-layout.ts` 的 `availableHomeComponents`)。设计夹具用 fixture 画满 8 块;
 * 生产上没有生产者的那几块不出现 —— 摆一格点了没反应的勾选,就是一个假控件
 * (Founder 2026-09-03 规则①/裁决九)。哪几块、为什么不出现,在 `HOME_COMPONENT_PRODUCER`。
 *
 * 这一层不认识数据库:它只把商家排好的顺序交出去,落库与能力闸在 `lib/home-layout-actions.ts`。
 */

import * as React from "react";
import { ArrowUp, GripVertical, X } from "lucide-react";

import { Button } from "@/design-system/primitives/button";
import { Checkbox } from "@/design-system/primitives/checkbox";
import { Separator } from "@/design-system/primitives/separator";
import { cn } from "@/lib/utils";
import {
  HOME_COMPONENTS,
  HOME_COMPONENT_FAMILIES,
  homeComponent,
  type HomeComponentId,
} from "@/design-system/patterns/founder-home/model";

export function CustomizeHomePanel({
  selected,
  offered,
  saving,
  onToggle,
  onMove,
  onReorder,
  onCancel,
  onReset,
  onSave,
}: {
  selected: readonly HomeComponentId[];
  /** 面板列得出来的全部组件 —— 有真实生产者的那些。 */
  offered: readonly HomeComponentId[];
  saving: boolean;
  onToggle: (id: HomeComponentId, checked: boolean) => void;
  onMove: (id: HomeComponentId, direction: -1 | 1) => void;
  onReorder: (fromId: HomeComponentId, toId: HomeComponentId) => void;
  onCancel: () => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const [draggedId, setDraggedId] = React.useState<HomeComponentId | null>(null);
  const offeredSet = React.useMemo(() => new Set(offered), [offered]);

  return (
    <aside
      aria-label="Customize home"
      className="sticky top-0 z-[46] flex h-[calc(100dvh-2.75rem)] w-[340px] shrink-0 flex-col border-l border-border bg-card"
    >
      <div className="border-b border-border p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Customize home</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Choose what matters, then put it in the right order.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon-xs" onClick={onCancel} aria-label="Close customize home">
            <X aria-hidden />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Home order</h3>
        <div className="mt-3 space-y-2">
          {selected.map((id, index) => {
            const item = homeComponent(id);
            return (
              <div
                key={id}
                draggable
                onDragStart={(event) => {
                  setDraggedId(id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedId && draggedId !== id) onReorder(draggedId, id);
                  setDraggedId(null);
                }}
                onDragEnd={() => setDraggedId(null)}
                className={cn(
                  "flex cursor-grab items-center gap-2 rounded-lg border border-border bg-background p-2 active:cursor-grabbing",
                  draggedId === id && "opacity-50",
                )}
              >
                <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={index === 0}
                  onClick={() => onMove(id, -1)}
                  aria-label={`Move ${item.label} up`}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={index === selected.length - 1}
                  onClick={() => onMove(id, 1)}
                  aria-label={`Move ${item.label} down`}
                >
                  <ArrowUp className="rotate-180" aria-hidden />
                </Button>
              </div>
            );
          })}
        </div>

        <Separator className="my-5" />

        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Component library</h3>
        <div className="mt-4 space-y-5">
          {HOME_COMPONENT_FAMILIES.map((family) => {
            const items = HOME_COMPONENTS.filter(
              (item) => item.family === family && offeredSet.has(item.id),
            );
            if (!items.length) return null;
            return (
              <div key={family}>
                <p className="mb-2 text-xs font-semibold">{family}</p>
                <div className="space-y-1">
                  {items.map((item) => (
                    <label
                      key={item.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-accent"
                    >
                      <Checkbox
                        checked={selected.includes(item.id)}
                        onCheckedChange={(value) => onToggle(item.id, value === true)}
                        aria-label={item.label}
                      />
                      <span>
                        <span className="block text-xs font-semibold">{item.label}</span>
                        <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-t border-border p-4">
        <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={onReset} disabled={saving}>
          Reset
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={saving}>
          Save
        </Button>
      </div>
    </aside>
  );
}
