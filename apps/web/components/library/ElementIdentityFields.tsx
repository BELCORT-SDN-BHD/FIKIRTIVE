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
  onBusyChange,
}: {
  element: LibraryElement;
  onChanged: (elementId: string, patch: ElementIdentityPatch) => void;
  /** 有写入在飞 —— 弹层据此不许被关掉(与 `ElementVariantsDialog` 的 `writeLocked` 同一条)。 */
  onBusyChange: (busy: boolean) => void;
}) {
  const nameFieldId = React.useId();
  const [draft, setDraft] = React.useState(element.name);
  const [savingName, setSavingName] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [coverPending, setCoverPending] = React.useState<string | null>(null);
  const [coverError, setCoverError] = React.useState<string | null>(null);

  // 关掉弹层 = 卸载这个组件,而写入还在飞 —— 被拒的那句话就再也没有地方可说。所以「在飞」
  // 要报上去,由弹层拦住关闭(`ElementVariantsDialog.tsx:136` 的 `writeLocked` 同一条纪律)。
  const busy = savingName || coverPending !== null;
  React.useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

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

  async function pickCover(assetId: string, url: string) {
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

  // 封面 = 身份上**真的钉着**的那一张(`Entity.baseAssetId`)。没钉过 = **没有封面**,不拿
  // 「排在最前的那一张」冒充:Brand 页那一边的判据逐字如此 —— `withProductIdentity`
  // (`packages/core/src/brand-records.ts`)在 `baseAssetId` 为空时把 `imageAssetId` 删掉,
  // 产品卡上一张图都不画。这里若把第一张当封面,同时坏两件事:那枚 `Cover` 标签在说谎
  // (它指的那张,Brand 页根本没画),而且它底下那颗「Use as cover」还会被吃掉 —— 商家恰恰
  // 在这个状态下最需要把一张钉上去。这个状态走正常的路就到得了:Brand 页只填名字与价格建的
  // 产品,`baseAssetId` 就是 null(`packages/db/src/create-product.ts:195`);Otto 的参考图
  // 默认走 REFSHEET(`lib/otto-refgen-port.ts:86`),而 worker 只有 BASE 那一档才钉
  // (`apps/worker/src/jobs/refgen.ts:634`)。
  const coverAssetId = element.images.some((image) => image.assetId === element.baseAssetId)
    ? element.baseAssetId
    : null;
  // 画这一排的条件 = 商家真的有得挑:已经钉了封面,要有第二张才值得画;身份上那一格还空着时,
  // 哪怕只有一张也要画 —— 那一张正是她要钉上去的。
  const canPickCover = element.images.length > (coverAssetId ? 1 : 0);

  // 本票的范围是 PRODID-A4,而 A4 说的是**产品**。别的分栏各有自己的归属:已冻结的 Library
  // pattern README §3.5 写的是「Character、Clothes、Location 使用 child page 管理 identity」,
  // 而 `brandmarks` 那一栏根本不在已批准设计里(它是 `library-elements-model.ts` 按「设计里没有
  // ≠ 商家没有」补出来的一栏,等 Founder 过目)。把这两颗键铺到那几栏上等于替设计做主,所以
  // 这里按分栏收口。要放开别的分栏:先在 Library pattern README §9 变更登记补一行、由 Founder
  // 裁,再动这个判据。
  const isProduct = element.kind === "products";

  return (
    <>
      {isProduct && element.capabilities.editIdentity ? (
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

      {isProduct && element.capabilities.mutateBase && canPickCover ? (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-medium">Cover</h3>
          <div className="flex flex-wrap gap-2">
            {element.images.map((image, index) => {
              const isCover = image.assetId === coverAssetId;
              // 每张图要有自己的名字:一排读音完全相同的「Use as cover」对读屏的人等于没有名字,
              // 她听不出按下去的是哪一张。编号跟着这一排的顺序走(商家眼里的第几张)。
              const position = index + 1;
              return (
                <div
                  key={image.assetId}
                  role="group"
                  aria-label={`Photo ${position}`}
                  className="flex w-[104px] flex-col gap-1"
                >
                  <div className="relative aspect-square overflow-hidden rounded-[var(--radius-card)] border border-border bg-muted">
                    {/* 同 MediaTile:商家自家 /files 素材。 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.url}
                      alt={`${element.name} — photo ${position}`}
                      className="size-full object-cover"
                      loading="lazy"
                    />
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
                      onClick={() => void pickCover(image.assetId, image.url)}
                    >
                      {coverPending === image.assetId ? <Spinner aria-label={`Changing cover to photo ${position}`} /> : null}
                      {coverPending === image.assetId ? "Changing…" : `Use photo ${position} as cover`}
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
