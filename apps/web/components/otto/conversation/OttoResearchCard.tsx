"use client";

/**
 * OttoResearchCard.tsx —— 一件研究托付在线程里长什么样(五步全在这一张里)。
 *
 * Founder 2026-08-26 裁决第 3 条:商家给一个网址 → Otto 去读、分类整理 → **在那个线程里**
 * 呈上来请他 approve → 批准的落进 Otto IQ 对应的格子。所以它没有自己的一层弹窗、没有自己
 * 的一页 —— 整件事从头到尾是这条线程里的几张卡,商家关掉面板去做别的,回来接着读、接着答。
 *
 * 状态与样例内容住在 `otto-research.ts`(纯函数);这里只负责把那份状态画出来,并且把
 * 商家的每一下判断交回给上层去落盘。卡片零件全部来自 `ConversationParts` —— 画布的 Ask 卡、
 * Create 弹窗的问题卡与这里的分类卡是同一批零件(裁决第 2/4 条)。
 */

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { AssistantProse, ProgressCard, WaitingCard, WorkedLine } from "./ConversationParts";
import {
  OTTO_RESEARCH_ACCEPT_LINE,
  OTTO_RESEARCH_SAMPLE_NOTE,
  OTTO_RESEARCH_STEPS,
  ottoResearchApprovedCount,
  type OttoResearchCategory,
  type OttoResearchState,
} from "./otto-research";

/** Otto IQ 那扇门的地址 —— 样张这一支带上 `fixture=r22`,否则点过去落在真实那一支上。 */
export function ottoIQHref(fixture: boolean): string {
  return fixture ? "/brand?fixture=r22" : "/brand";
}

function CategoryCard({
  category,
  onApprove,
  onSkip,
}: {
  category: OttoResearchCategory;
  onApprove: () => void;
  onSkip: () => void;
}) {
  const settled = category.decision !== "pending";
  return (
    <div className="r22-research-category" data-otto-research-category={category.id} data-decision={category.decision}>
      <div className="r22-research-category-head">
        <b>{category.title}</b>
        {settled ? (
          <Badge variant={category.decision === "approved" ? "success" : "outline"} data-otto-research-decision={category.decision}>
            {category.decision === "approved" ? `Kept in ${category.slotTitle}` : "Skipped"}
          </Badge>
        ) : (
          <span className="r22-research-category-slot">Goes to {category.slotTitle}</span>
        )}
      </div>
      <ul>
        {category.excerpts.map((excerpt) => <li key={excerpt}>{excerpt}</li>)}
      </ul>
      {settled ? null : (
        <div className="r22-research-category-acts">
          <Button unstyled type="button" data-otto-research-skip={category.id} onClick={onSkip}>Skip</Button>
          <Button unstyled type="button" className="is-primary" data-otto-research-approve={category.id} onClick={onApprove}>
            Keep this
          </Button>
        </div>
      )}
    </div>
  );
}

export function OttoResearchCard({
  state,
  fixture,
  onDecide,
}: {
  state: OttoResearchState;
  fixture: boolean;
  onDecide: (categoryId: string, decision: "approved" | "skipped") => void;
}) {
  if (state.stage === "accepted" || state.stage === "working") {
    return (
      <div data-otto-research={state.stage} className="r22-research">
        <AssistantProse>{OTTO_RESEARCH_ACCEPT_LINE}</AssistantProse>
        <ProgressCard
          title={`Reading ${state.site}`}
          steps={OTTO_RESEARCH_STEPS}
          current={state.stage === "accepted" ? 0 : state.step}
          note="Takes a few minutes. Everything lands back in this conversation."
        />
      </div>
    );
  }

  if (state.stage === "waiting") {
    return (
      <div data-otto-research="waiting" className="r22-research">
        <WaitingCard
          title="Three groups are ready for you"
          detail={`Keep the ones you want Otto to use. ${OTTO_RESEARCH_SAMPLE_NOTE}`}
        >
          <div className="r22-research-categories">
            {state.categories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                onApprove={() => onDecide(category.id, "approved")}
                onSkip={() => onDecide(category.id, "skipped")}
              />
            ))}
          </div>
        </WaitingCard>
      </div>
    );
  }

  const kept = ottoResearchApprovedCount(state);
  const keptTitles = state.categories.filter((category) => category.decision === "approved").map((category) => category.slotTitle);
  return (
    <div data-otto-research="done" className="r22-research">
      {/* 回执说的是**商家自己刚做的事**,不是系统术语:留了几组、留进哪几格、去哪儿看。
          一组都没留也照样有回执 —— 「什么都没存」同样是一个他需要确认的结果。 */}
      <AssistantProse>
        {kept
          ? `Kept ${kept} of ${state.categories.length} groups. They are in ${keptTitles.join(" and ")} now.`
          : "Nothing was kept, so Otto IQ is unchanged."}
      </AssistantProse>
      <div className="r22-research-done-acts">
        <Link data-otto-research-open-iq="" href={ottoIQHref(fixture)}>Open Otto IQ</Link>
      </div>
      <WorkedLine seconds={state.workedSeconds} steps={OTTO_RESEARCH_STEPS} />
    </div>
  );
}
