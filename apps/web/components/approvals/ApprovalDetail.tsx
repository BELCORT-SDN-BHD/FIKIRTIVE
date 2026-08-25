"use client";

/**
 * ApprovalDetail.tsx —— ③ 审批卡的展开详情区,两个页签。
 *
 * · **Per-platform preview** —— 同一条内容在每个平台上的成品形态(比例、时段、可见的
 *   文案长度)。商家批的是「发出去之后长什么样」,不是一段草稿文本。
 * · **Source brief** —— Otto 依据什么做的:routine、Based on 的来源、要旨、这一步的成本;
 *   ⑦ 的审计时间线也在这一页,因为「依据」与「经过」是同一个问题的两半。
 *
 * v2 稿把卡面收干净之后,`Based on` 的那几枚来源芯片从卡上搬到了这里 —— 它是「Otto 凭
 * 什么这么写」的证据,不是做决定当下要读的字。展开仍然不离开收件箱:这一块长在卡里,
 * 不是弹窗、不是跳转。
 */

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

import { ApprovalThumb } from "./ApprovalThumb";
import { ApprovalTimeline } from "./ApprovalTimeline";
import { ratioClass, type ApprovalDetailTab, type ApprovalItem } from "./approvals-fixture";

export function approvalDetailId(id: string): string {
  return `r22-approval-detail-${id}`;
}

function PreviewPane({ item }: { item: ApprovalItem }) {
  if (!item.previews?.length) {
    return <p className="r22-approvals-brief-note">No per-platform preview exists for this item in this fixture.</p>;
  }
  return (
    <div className="r22-approvals-previews">
      {/* i2 的四条预览里有三条都是 Instagram —— key 只能用序号,平台名不是这里的身份。 */}
      {item.previews.map((preview, index) => (
        <article className="r22-approvals-preview" key={`${item.id}-preview-${index}`}>
          <header>
            <b>{preview.platform}</b>
            {preview.slot ? <><i className="r22-approvals-sep">·</i><time>{preview.slot}</time></> : null}
          </header>
          {preview.image
            ? <span className={`r22-approvals-preview-img ${ratioClass(preview.ratio ?? "4:5")}`}><ApprovalThumb src={preview.image} className="r22-approvals-frame-img" /></span>
            : <span className="r22-approvals-preview-img is-pending">Not made yet</span>}
          <p>{preview.caption}</p>
          <p className="r22-approvals-fit">{preview.fit}</p>
        </article>
      ))}
    </div>
  );
}

function BriefPane({ item }: { item: ApprovalItem }) {
  const brief = item.brief;
  return (
    <div className="r22-approvals-briefpane">
      {brief ? (
        <dl className="r22-approvals-brief">
          <div><dt>Routine</dt><dd>{brief.routine}</dd></div>
          <div>
            <dt>Based on</dt>
            <dd>{item.sources?.length
              ? <span className="r22-approvals-sources">{item.sources.map((source) => <Button unstyled type="button" key={source}>{source}</Button>)}</span>
              : "Nothing recorded in this fixture"}</dd>
          </div>
          <div><dt>Asked for</dt><dd>{brief.promptGist}</dd></div>
          <div><dt>What this costs</dt><dd>{brief.cost}</dd></div>
        </dl>
      ) : <p className="r22-approvals-brief-note">No source brief is recorded for this item in this fixture.</p>}
      <h4>History</h4>
      <ApprovalTimeline events={item.timeline} />
    </div>
  );
}

export function ApprovalDetail({
  item,
  tab,
  onTab,
}: {
  item: ApprovalItem;
  tab: ApprovalDetailTab;
  onTab: (tab: ApprovalDetailTab) => void;
}) {
  return (
    <div className="r22-approvals-detail" id={approvalDetailId(item.id)}>
      <Tabs unstyled value={tab} onValueChange={(value) => onTab(value as ApprovalDetailTab)}>
        <TabsList unstyled aria-label={`Details for ${item.title}`}>
          <TabsTrigger unstyled value="preview" className={tab === "preview" ? "is-active" : ""}>Per-platform preview</TabsTrigger>
          <TabsTrigger unstyled value="brief" className={tab === "brief" ? "is-active" : ""}>Source brief</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "preview" ? <PreviewPane item={item} /> : <BriefPane item={item} />}
    </div>
  );
}

export default ApprovalDetail;
