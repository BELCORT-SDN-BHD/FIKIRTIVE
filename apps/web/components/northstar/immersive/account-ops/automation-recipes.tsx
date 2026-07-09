"use client";

/**
 * [wave-c · Z9-settings-automation] 自动化配方库(真目录)—— EFFECTIVENESS gap2/5 的答卷。
 *
 * 把「3+3 预设死 + 空白表单」升级成一排按结果分类、可一键安装的配方卡。每张卡摆上台面的
 * 五件事:资格条件 / 真文案(它真会发的那句)/ 停发规则 / 守护栏(信任四件套)/ 成功指标。
 * 安装走一个确认向导(不是空白框):卡里预填好真文案,店主改一句、看清护栏,再装上。
 *
 * 双声部(§2):蓝 = 人手声部(Install 是人的动作 → .ns-human-fill;焦点环自动蓝);
 * coral 只属于 Otto(向导里挂一颗「Otto 帮我」§O7 帮改文案)。手感(§5a):可点即凸
 * (.ns-pressable),静态阅读卡片保持平。冷启动诚实:成功指标标明是同类店铺基准、非本账号真数。
 *
 * 铁律:纯 client、零后台 import;发/花永不由 Apply 触发(Apply 只填文案框,装/发仍要店主点)。
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Quote, ShieldCheck, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/northstar/_shared";
import { OttoAssist } from "../otto-assist";
import { installRecipe, recipeInstalled, uninstallRecipe, useStore } from "../_store";
import { NS_RECIPES, type NsRecipe } from "./data";
import { ACCOUNT_OPS_BASE as BASE, AutomationNav, Card, useSweep } from "./kit";

/** 一行守护栏 chip(信任四件套的范围声明)。 */
function ScopeChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-foreground">
      {children}
    </span>
  );
}

function GoalTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 font-mono text-[10px] leading-[14px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
      {children}
    </span>
  );
}

function RecipeCard({ recipe, onOpen }: { recipe: NsRecipe; onOpen: () => void }) {
  const installed = recipeInstalled(recipe.id, !!recipe.defaultInstalled);
  const budget = recipe.budgetCapCredits;

  return (
    <Card className="flex flex-col p-4">
      {/* 头:名称 + 结果分类 + Recommended */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{recipe.title}</h3>
        {recipe.recommended && (
          <span className="inline-flex items-center rounded-full bg-[var(--human-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--human-soft-foreground)]">
            Recommended
          </span>
        )}
        <GoalTag>{recipe.goal}</GoalTag>
        {installed && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-success-soft-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            Active
          </span>
        )}
      </div>

      <p className="mt-2 text-[13px] leading-[18px] text-foreground">{recipe.whatItDoes}</p>

      {/* 资格条件:适合谁 */}
      <p className="mt-2 text-[13px] leading-[18px] text-muted-foreground">
        <span className="font-medium text-foreground">Who it fits · </span>
        {recipe.eligibility}
      </p>

      {/* 成功指标(冷启动诚实:同类店铺基准) */}
      <div className="mt-3 flex items-start gap-2 rounded-[12px] bg-secondary/60 px-3 py-2">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
        <p className="text-[12px] leading-[16px] text-muted-foreground">{recipe.successMetric}</p>
      </div>

      {/* 成本 + 节律(mono 数据面) */}
      <p className="mt-3 font-mono text-[11px] leading-[14px] font-medium tracking-[0.04em] text-muted-foreground">
        {recipe.estCostPerRun} · {recipe.cadence}
      </p>

      {/* 安装态 / 未装态 */}
      <div className="mt-3 border-t border-border pt-3">
        {installed ? (
          <div className="flex flex-col gap-2">
            {recipe.lastRun ? (
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
                  Last run · {recipe.lastRun.at}
                </span>
                <span className="text-[13px] leading-[18px] text-foreground">
                  {recipe.lastRun.outcome}
                  {recipe.lastRun.spent > 0 ? ` · ${recipe.lastRun.spent} credits` : " · no spend"}
                </span>
              </div>
            ) : (
              <p className="text-[13px] leading-[18px] text-muted-foreground">
                Running with your leash. Its first results show up here after it runs.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="-ml-2" onClick={onOpen}>
                See guardrails
              </Button>
              <button
                type="button"
                onClick={() => uninstallRecipe(recipe.id, recipe.title)}
                className="ns-pressable ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                <X className="size-3.5" strokeWidth={2} />
                Turn off
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {budget > 0 ? `Capped at ${budget} credits a month` : "No credits — replies only"}
            </span>
            {/* 蓝声部:Install 是人手主动作 → .ns-human-fill(§2) */}
            <button
              type="button"
              onClick={onOpen}
              className="ns-pressable ns-human-fill ml-auto inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              Install
              <ArrowRight className="size-4" strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** 安装向导:预填真文案(可改)+ 停发规则 + 四件护栏,再一键装上。挂一颗「Otto 帮我」§O7。 */
function InstallWizard({
  recipe,
  onClose,
}: {
  recipe: NsRecipe;
  onClose: () => void;
}) {
  const installed = recipeInstalled(recipe.id, !!recipe.defaultInstalled);
  const [copy, setCopy] = React.useState(recipe.sampleCopy);
  const copySweep = useSweep();

  const doInstall = () => {
    installRecipe(recipe.id, recipe.title);
    toast("Recipe installed", {
      description: `“${recipe.title}” is running with your leash — spend cap, kill switch, scope and a full history.`,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(560px,calc(100vw-2rem))]">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{recipe.title}</DialogTitle>
            {recipe.recommended && (
              <span className="inline-flex items-center rounded-full bg-[var(--human-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--human-soft-foreground)]">
                Recommended
              </span>
            )}
          </div>
          <DialogDescription>{recipe.whatItDoes}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* 真文案(可改)+ Otto 帮我 §O7 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">The message it sends</span>
              {/* §O7:挂一颗「Otto 帮我」——意图 chip 改写文案,Apply 回填这个框(发仍要店主点) */}
              <span className="ml-auto">
                <OttoAssist
                  zone="Settings"
                  entityId={recipe.id}
                  entityLabel={recipe.title}
                  formState={{ recipe: recipe.title, message: copy }}
                  label="Ask Otto"
                  intents={[
                    {
                      id: "rcp-warmer",
                      label: "Make it warmer",
                      prompt: `Rewrite the ${recipe.title} message to sound warmer and more personal.`,
                      reply: "Here's a warmer take — keep the placeholders so real names and dates fill in:",
                      apply: {
                        summary: "Fill in a warmer version of the message",
                        patch: { copy: `${recipe.sampleCopy} Thanks for being a regular, {name} — really appreciate you 🙏` },
                      },
                    },
                    {
                      id: "rcp-shorter",
                      label: "Make it shorter",
                      prompt: `Rewrite the ${recipe.title} message shorter, for a quick WhatsApp reply.`,
                      reply: "Trimmed to one line — still keeps the ask and the placeholder:",
                      apply: {
                        summary: "Fill in a shorter version of the message",
                        patch: { copy: recipe.sampleCopy.split(". ")[0].split(" — ")[0] + " — reply YES and I'll sort it, {name} 🙌" },
                      },
                    },
                  ]}
                  onApply={(a) => {
                    const patched = (a.patch as { copy?: string }).copy;
                    if (typeof patched === "string") {
                      setCopy(patched);
                      copySweep.fire();
                    }
                  }}
                />
              </span>
            </div>
            <div
              style={copySweep.style}
              className="rounded-[12px] border border-border bg-secondary/50 p-3"
            >
              <Quote className="mb-1 size-3.5 text-muted-foreground" strokeWidth={2} aria-hidden />
              <textarea
                value={copy}
                onChange={(e) => setCopy(e.target.value)}
                rows={3}
                aria-label="The message this recipe sends"
                className="w-full resize-none bg-transparent text-[13px] leading-[18px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              <p className="mt-1 text-[11px] leading-[14px] text-muted-foreground">
                {"{name}, {product}, {date}"} and the rest fill in from the real customer. Nothing sends without your tap.
              </p>
            </div>
          </div>

          {/* 停发规则(防骚扰 / 防误发) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">When it stops</span>
            <ul className="flex flex-col gap-1">
              {recipe.stopRules.map((rule, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] leading-[18px] text-muted-foreground">
                  <Check className="mt-[3px] size-3.5 shrink-0 text-success" strokeWidth={2.5} />
                  {rule}
                </li>
              ))}
            </ul>
          </div>

          {/* 守护栏:信任四件套(范围 + 花费闸) */}
          <div className="flex flex-col gap-2 rounded-[12px] border border-border bg-secondary/40 p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
              <span className="text-xs font-semibold text-foreground">Its leash</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recipe.scope.map((s, i) => (
                <ScopeChip key={i}>{s}</ScopeChip>
              ))}
            </div>
            <p className="text-[12px] leading-[16px] text-muted-foreground">
              {recipe.budgetCapCredits > 0
                ? `Spend cap ${recipe.budgetCapCredits} credits/month · `
                : "Never spends credits · "}
              kill switch any time · full run history · scope above is all it can touch.
            </p>
          </div>

          {/* 成功指标(冷启动诚实) */}
          <p className="text-[12px] leading-[16px] text-muted-foreground">{recipe.successMetric}</p>
        </div>

        <DialogFooter className="flex-row justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {installed ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                uninstallRecipe(recipe.id, recipe.title);
                onClose();
              }}
            >
              Turn off
            </Button>
          ) : (
            <button
              type="button"
              onClick={doInstall}
              className="ns-pressable ns-human-fill inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <Sparkles className="size-4" strokeWidth={2} />
              Install recipe
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AutomationRecipes() {
  useStore();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const openRecipe = openId ? NS_RECIPES.find((r) => r.id === openId) ?? null : null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 pt-6 pb-16">
      <PageHeader
        title="Recipes"
        subtitle="Proven plays for shops like yours. Install one and Otto runs it on a leash — you always hold the kill switch."
        actions={<AutomationNav />}
      />

      {/* 四件套一句话解释(与 routines 对齐的信任地基) */}
      <div className="mt-6 flex items-start gap-2.5 rounded-[14px] border border-border bg-secondary/50 px-4 py-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          Every recipe runs with the same four guardrails as your routines — a spend cap, a kill switch, a plain-English
          scope, and a full run history. Success figures are benchmarks from similar KL bakeries until a recipe has run
          enough on your own account.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {NS_RECIPES.map((r) => (
          <RecipeCard key={r.id} recipe={r} onOpen={() => setOpenId(r.id)} />
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Want a single trigger or a fixed rhythm instead? Set up a{" "}
        <Link href={`${BASE}/automation/rules`} className="font-semibold text-foreground hover:underline">
          rule
        </Link>{" "}
        or a{" "}
        <Link href={`${BASE}/automation/routines`} className="font-semibold text-foreground hover:underline">
          routine
        </Link>
        .
      </p>

      {openRecipe && <InstallWizard recipe={openRecipe} onClose={() => setOpenId(null)} />}
    </div>
  );
}
