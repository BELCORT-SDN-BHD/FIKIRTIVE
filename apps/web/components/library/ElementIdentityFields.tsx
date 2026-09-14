"use client";

/**
 * Library 元素详情里的**身份两格** —— 名字与主图(规格 `docs/specs/brand-product-identity.md`
 * §1.2 / §1.4,验收 PRODID-A4:「在 Library 改名或换主图;再在 Brand 页改名或换主图 →
 * 另一边同步显示(同一行 Entity),无第二份名字或图」)。
 *
 * 规格 §5 的 2026-09-11 那一行把缺口写得很白:改名与换封面**两条动作层的路早就都在、都有真库
 * 测试**,缺的只是 Library 这一面的入口 —— `updateEntity` 今天的调用方只有 Otto 的改名技能
 * (`lib/otto-entities-port.ts:37`),`setBaseAsset` 只有 Cast 的变体弹层
 * (`components/otto/stuff/ElementVariantsDialog.tsx:352`)。所以这个文件**一条新动作都不建**,
 * 只把商家的手接到那两条已有的路上:
 *
 *   改名   → `lib/actions.ts:updateEntity`(Otto 改名技能走的同一个;身份是名字的唯一源,
 *            价签那列 `nameKey` 由它在同一个事务里追平)
 *   换封面 → `lib/refgen-actions.ts:setBaseAsset`(Brand 页看到的 `imageAssetId` 就是它写的
 *            `Entity.baseAssetId`;只接受这个元素**自己已有**的 live 参考图,不收任意 asset id)
 *
 * ── 只交真的在编辑的那一格(PRODID-R6 / R9)────────────────────────────────────
 * 身份的写路只认显式意图:递了哪一格才写哪一格。这一屏只编辑名字,所以 `updateEntity` 只收到
 * `{ name }` 一个键 —— `type`、`notes`、`negativeConstraints` 一个都不出现,否则这一屏手里那份
 * 可能过期的快照就会在一次改名里把别处刚改的东西静默写回去。封面同理:它只从下面那排图上按,
 * 不跟着改名一起走。(Brand 页那张产品表单的形状由 `lib/brand-product-form-identity.ts` 一处
 * 说了算;那是**那张表单**的唯一源,不是这一屏的 —— 这一屏编辑的是身份本身,走的也是另一条
 * 动作,所以它按同一条规矩自己交自己那一格,不去借用那个函数。)
 *
 * ── 价格、卖点、分类一格都没有(PRODID-A5)────────────────────────────────────
 * 那三样是价签(`BrandRecord`)上的事实,只在 Brand 页可改。这一屏不画它们。
 *
 * ── 只读的那一栏 ────────────────────────────────────────────────────────────
 * 判据是域层能力表(`packages/core/src/entity-policy.ts`),不是「哪一栏」:官方演员
 * `editIdentity` / `mutateBase` 两格都是 false,所以这两个控件**根本不画**,而不是画成禁用的
 * 假控件 —— 与这个弹层里 `Remove from Library` 那一颗同一条纪律。
 *
 * ── 失败就说失败 ────────────────────────────────────────────────────────────
 * 两条路都不做乐观写入:屏幕上的名字与封面只在服务端点头之后才变,所以一次被拒的改动不会
 * 留下任何要回滚的痕迹,商家看到的永远是库里那一份。被拒时原话照抄服务端;连不上时给一句
 * 与 `ElementVariantsDialog` 同口径的重试话。
 */

import * as React from "react";

import { Badge } from "@/design-system/primitives/badge";
import { Button } from "@/design-system/primitives/button";
import { Input } from "@/design-system/primitives/input";
import { Label } from "@/design-system/primitives/label";
import { Spinner } from "@/design-system/primitives/spinner";
import { updateEntity } from "@/lib/actions";
import type { LibraryElement } from "@/lib/library-elements-model";
import { setBaseAsset } from "@/lib/refgen-actions";

/** 一次成功写入之后,这张卡上跟着变的那几格。 */
export type ElementIdentityPatch = Partial<Pick<LibraryElement, "name" | "baseAssetId" | "coverUrl">>;

export function ElementIdentityFields({
  element,
  onChanged,
}: {
  element: LibraryElement;
  onChanged: (elementId: string, patch: ElementIdentityPatch) => void;
}) {
  const nameFieldId = React.useId();
  const [draft, setDraft] = React.useState(element.name);
  const [savingName, setSavingName] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [coverPending, setCoverPending] = React.useState<string | null>(null);
  const [coverError, setCoverError] = React.useState<string | null>(null);

  const trimmed = draft.trim();
  const canSaveName = Boolean(trimmed) && trimmed !== element.name && !savingName;

  async function saveName() {
    if (!canSaveName) return;
    setSavingName(true);
    setNameError(null);
    try {
      // 只这一格(PRODID-R6 / R9)。
      const result = await updateEntity(element.id, { name: trimmed });
      if ("error" in result) {
        setNameError(result.error);
        return;
      }
      onChanged(element.id, { name: trimmed });
    } catch {
      setNameError("The new name couldn't be saved. Check your connection and try again.");
    } finally {
      setSavingName(false);
    }
  }

  async function useAsCover(assetId: string, url: string) {
    if (coverPending) return;
    setCoverPending(assetId);
    setCoverError(null);
    try {
      const result = await setBaseAsset(element.id, assetId);
      if ("error" in result) {
        setCoverError(result.error);
        return;
      }
      onChanged(element.id, { baseAssetId: assetId, coverUrl: url });
    } catch {
      setCoverError("The cover couldn't be changed. Check your connection and try again.");
    } finally {
      setCoverPending(null);
    }
  }

  // 封面 = 身份上钉的那一张;没钉过就是排在最前的那一张(与 `lib/library-elements.ts` 同一条
  // 规则,所以这一排上那枚 `Cover` 标签与上面那张大图永远指着同一个 asset)。
  const coverAssetId = element.images.some((image) => image.assetId === element.baseAssetId)
    ? element.baseAssetId
    : element.images[0]?.assetId ?? null;

  return (
    <>
      {element.capabilities.editIdentity ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={nameFieldId}>Name</Label>
          <div className="flex items-start gap-2">
            <Input
              id={nameFieldId}
              value={draft}
              disabled={savingName}
              onChange={(event) => { setDraft(event.target.value); setNameError(null); }}
              onKeyDown={(event) => {
                // Enter 在这一格就是「保存」—— 弹层里没有 form,不按一下就以为存上了。
                if (event.key === "Enter") { event.preventDefault(); void saveName(); }
              }}
            />
            <Button variant="secondary" disabled={!canSaveName} onClick={() => void saveName()}>
              {savingName ? <Spinner aria-label="Saving name" /> : null}
              {savingName ? "Saving…" : "Save name"}
            </Button>
          </div>
          {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
        </div>
      ) : null}

      {element.capabilities.mutateBase && element.images.length > 1 ? (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-medium">Cover</h3>
          <div className="flex flex-wrap gap-2">
            {element.images.map((image) => {
              const isCover = image.assetId === coverAssetId;
              return (
                <div key={image.assetId} className="flex w-[104px] flex-col gap-1">
                  <div className="relative aspect-square overflow-hidden rounded-[var(--radius-card)] border border-border bg-muted">
                    {/* 同 MediaTile:商家自家 /files 素材。 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.url} alt="" className="size-full object-cover" loading="lazy" />
                    {isCover ? (
                      <Badge variant="outline" className="absolute left-1.5 top-1.5 bg-card/90">
                        Cover
                      </Badge>
                    ) : null}
                  </div>
                  {isCover ? null : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(coverPending)}
                      onClick={() => void useAsCover(image.assetId, image.url)}
                    >
                      {coverPending === image.assetId ? <Spinner aria-label="Changing cover" /> : null}
                      {coverPending === image.assetId ? "Changing…" : "Use as cover"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {coverError ? <p className="text-xs text-destructive">{coverError}</p> : null}
        </div>
      ) : null}
    </>
  );
}
