import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/campaign-generation-confirm", () => ({
  confirmCampaignGeneration: vi.fn(),
  quoteCampaignGeneration: vi.fn(),
}));

import CampaignConfirmPage, {
  campaignGenerationResultTitle,
  reusedLabel,
  reusedSummaryPhrase,
} from "@/components/campaign/campaign-confirm-page";
import CampaignListPage from "@/components/campaign/campaign-list-page";

const CAMPAIGN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ENTRY_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";

type QuoteLine = NonNullable<
  Extract<ComponentProps<typeof CampaignConfirmPage>["quote"], { ok: true }>
>["quote"]["lines"][number];

function imageLine(over: Partial<QuoteLine> = {}): QuoteLine {
  return {
    entryId: ENTRY_ID,
    brief: "A festive product image",
    kind: "image",
    displayCredits: 1,
    fullDisplayCredits: 1,
    charge: "new",
    reuseState: null,
    aspectRatio: "1:1",
    promisedSpec: { aspectRatio: "1:1", count: 1 },
    specChips: [],
    ...over,
  };
}

function confirmProps(
  balanceDisplayCredits: number,
  totalDisplayCredits: number,
  over: {
    lines?: QuoteLine[];
    reusedCount?: number;
    blockedCount?: number;
    videoMenu?: Extract<ComponentProps<typeof CampaignConfirmPage>["quote"], { ok: true }>["videoMenu"];
  } = {},
): ComponentProps<typeof CampaignConfirmPage> {
  return {
    campaignId: CAMPAIGN_ID,
    detail: {
      ok: true,
      campaign: {
        id: CAMPAIGN_ID,
        name: "Raya launch",
        status: "DRAFT",
        goal: "Launch the Raya collection",
        startAt: "2026-07-24T00:00:00.000Z",
        endAt: "2026-07-31T00:00:00.000Z",
        plan: {
          theme: "Raya",
          rationale: null,
          entries: [{
            id: ENTRY_ID,
            date: "2026-07-25",
            platform: "instagram",
            format: "image",
            hook: "Celebrate together",
            brief: "A festive product image",
            estCredits: totalDisplayCredits,
            status: "approved",
          }],
          ideas: [],
        },
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:00.000Z",
        dispatchedEntryIds: [],
        grouped: {
          projects: [{ id: "project-1", name: "Raya project", createdAt: "2026-07-23T00:00:00.000Z" }],
          scheduledPosts: [],
          generations: [],
          broadcasts: [],
        },
        available: {
          projects: [],
          scheduledPosts: [],
          generations: [],
        },
        trendSnapshots: [],
      },
      nextEntryId: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
      nextEntryProof: "proof",
    },
    quote: {
      ok: true,
      balanceDisplayCredits,
      quote: {
        lines: over.lines ?? [imageLine({ displayCredits: totalDisplayCredits, fullDisplayCredits: totalDisplayCredits })],
        totalDisplayCredits,
        count: (over.lines ?? [null]).length,
        contentFingerprint: "a".repeat(64),
        deliveryFingerprint: "b".repeat(64),
        reusedCount: over.reusedCount ?? 0,
        blockedCount: over.blockedCount ?? 0,
      },
      videoMenu: over.videoMenu ?? {
        resolutions: ["720p", "480p"],
        durations: [4, 5, 10],
        selected: { resolution: "720p", durationSeconds: 5 },
      },
    },
  };
}

function renderConfirm(
  balanceDisplayCredits: number,
  totalDisplayCredits: number,
  over: Parameters<typeof confirmProps>[2] = {},
): string {
  return renderToStaticMarkup(
    createElement(CampaignConfirmPage, confirmProps(balanceDisplayCredits, totalDisplayCredits, over)),
  );
}

function confirmButtonOpeningTag(markup: string): string {
  const labelIndex = markup.indexOf("Confirm ·");
  const buttonStart = markup.lastIndexOf("<button", labelIndex);
  const buttonEnd = markup.indexOf(">", buttonStart);
  return markup.slice(buttonStart, buttonEnd + 1);
}

describe("CampaignConfirmPage credit honesty", () => {
  it("renders the server balance and leaves confirmation enabled when it is sufficient", () => {
    const markup = renderConfirm(5, 2);

    expect(markup).toContain("Current balance");
    expect(markup).toContain("5 credits");
    expect(markup).not.toContain("Not enough credits");
    expect(markup).not.toContain('href="/billing"');
    expect(confirmButtonOpeningTag(markup)).not.toContain(' disabled=""');
  });

  it("warns, links to billing, and disables confirmation when the balance is insufficient", () => {
    const markup = renderConfirm(1, 2);

    expect(markup).toContain("Not enough credits");
    expect(markup).toContain("you have 1 credit, this needs 2 credits");
    expect(markup).toContain('href="/billing"');
    expect(confirmButtonOpeningTag(markup)).toContain(' disabled=""');
  });

  it("treats a zero balance as insufficient", () => {
    const markup = renderConfirm(0, 2);

    expect(markup).toContain("you have 0 credits, this needs 2 credits");
    expect(markup).toContain('href="/billing"');
    expect(confirmButtonOpeningTag(markup)).toContain(' disabled=""');
  });

  it("uses singular credit copy for the line, total, balance, and confirmation", () => {
    const markup = renderConfirm(1, 1);

    expect(markup).toContain("1 credit");
    expect(markup).toContain("Confirm · 1 credit");
    expect(markup).not.toContain("1 credits");
  });
});

// ---------------------------------------------------------------------------
// #708 —— 门槛读的是「真会收的钱」，不是每个条目的全价之和
// ---------------------------------------------------------------------------
describe("#708 已生成的条目不再把商家挡在门外", () => {
  const reusedVideo = imageLine({
    entryId: "01ARZ3NDEKTSV4RRFFQ69G5FB1",
    kind: "video",
    charge: "reused",
    reuseState: "done",
    displayCredits: 0,
    fullDisplayCredits: 11,
    aspectRatio: null,
    promisedSpec: { aspectRatio: "9:16", count: 1, resolution: "720p", durationSeconds: 5, fps: 0, audio: true },
    specChips: ["9:16", "5s", "720p", "With sound"],
  });
  const freshImage = imageLine({ displayCredits: 1, fullDisplayCredits: 1 });

  it("余额 5、真会收 1 credit：确认按钮不再被禁用，也不再叫他去充值", () => {
    const markup = renderConfirm(5, 1, { lines: [reusedVideo, freshImage], reusedCount: 1 });

    expect(markup).toContain("Confirm · 1 credit");
    expect(markup).not.toContain("Not enough credits");
    expect(markup).not.toContain('href="/billing"');
    expect(confirmButtonOpeningTag(markup)).not.toContain(' disabled=""');
  });

  it("已生成的那一行如实写 0，并说清全价去哪了", () => {
    const markup = renderConfirm(5, 1, { lines: [reusedVideo, freshImage], reusedCount: 1 });

    expect(markup).toContain("Already generated");
    expect(markup).toContain("normally 11 credits");
    expect(markup).toContain("1 item is already generated, so this run only charges for the rest.");
  });

  it("整份计划都已生成时，卡面在按下去之前就说清不会收费", () => {
    const markup = renderConfirm(5, 0, { lines: [reusedVideo], reusedCount: 1 });

    expect(markup).toContain("Everything in this plan is already generated");
    expect(markup).toContain("Confirm · no charge");
    expect(confirmButtonOpeningTag(markup)).not.toContain(' disabled=""');
  });

  it("内容改过、这一趟不会被受理的条目：0 credits，并说明原因", () => {
    const blocked = imageLine({ charge: "blocked", displayCredits: 0, fullDisplayCredits: 1 });
    const markup = renderConfirm(5, 0, { lines: [blocked], blockedCount: 1 });

    expect(markup).toContain("Will not start");
    expect(markup).toContain("This entry changed since it was last generated");
  });
});

// ---------------------------------------------------------------------------
// #708 修复轮 P2-1 —— 复用不等于做完:还在跑的片子不许被写成已完成
// ---------------------------------------------------------------------------
describe("#708 修复轮 P2-1 在飞的复用条目说的是「还在做」", () => {
  const inFlight = imageLine({
    entryId: "01ARZ3NDEKTSV4RRFFQ69G5FB2",
    kind: "video",
    charge: "reused",
    reuseState: "in_progress",
    displayCredits: 0,
    fullDisplayCredits: 11,
    aspectRatio: null,
    promisedSpec: { aspectRatio: "9:16", count: 1, resolution: "720p", durationSeconds: 5, fps: 0, audio: true },
    specChips: ["9:16", "5s", "720p", "With sound"],
  });
  const done = imageLine({ charge: "reused", reuseState: "done", displayCredits: 0, fullDisplayCredits: 1 });

  it("行文案分档:做完了才叫 already generated,在跑的说 already being made", () => {
    expect(reusedLabel("done")).toBe("Already generated");
    expect(reusedLabel("in_progress")).toBe("Already being made");
    // 状态不明按「还在做」说 —— 不确定的时候不许宣称完成。
    expect(reusedLabel(null)).toBe("Already being made");
  });

  it("在飞的那一行:卡上写 already being made,不写 already generated", () => {
    const markup = renderConfirm(50, 0, { lines: [inFlight], reusedCount: 1 });

    expect(markup).toContain("Already being made");
    expect(markup).not.toContain("Already generated");
    expect(markup).not.toContain("Already done");
  });

  it("汇总也分档:只要还有一单在跑,整批就不许被说成已生成", () => {
    expect(reusedSummaryPhrase([done, done])).toBe("already generated");
    expect(reusedSummaryPhrase([done, inFlight])).toBe("already generated or still being made");

    const markup = renderConfirm(50, 0, { lines: [inFlight, done], reusedCount: 2 });
    expect(markup).toContain("Everything in this plan is already generated or still being made");
  });

  it("全部真做完时,原来那句话一个字不变", () => {
    const markup = renderConfirm(50, 0, { lines: [done], reusedCount: 1 });

    expect(markup).toContain("Everything in this plan is already generated. Confirming again will not charge you.");
    expect(markup).not.toContain("still being made");
  });
});

// ---------------------------------------------------------------------------
// #709 —— 11 credits 买的是哪一档，卡上得有字；半价档要选得到
// ---------------------------------------------------------------------------
describe("#709 战役确认卡写明片子规格并给得出档位", () => {
  const videoLine = imageLine({
    kind: "video",
    displayCredits: 11,
    fullDisplayCredits: 11,
    aspectRatio: "9:16",
    specChips: ["9:16", "5s", "720p", "With sound"],
  });

  it("视频行把服务端解析出来的规格逐条印在卡上", () => {
    const markup = renderConfirm(50, 11, { lines: [videoLine] });

    expect(markup).toContain("5s");
    expect(markup).toContain("720p");
    expect(markup).toContain("With sound");
    expect(markup).toContain("11 credits");
  });

  it("有片子时给出档位选择器(菜单本身由服务端送来,见 quote 侧的菜单来源断言)", () => {
    const markup = renderConfirm(50, 11, { lines: [videoLine] });

    expect(markup).toContain("Video resolution");
    expect(markup).toContain("Video length");
  });

  it("纯图片的计划不显示片子档位选择器", () => {
    const markup = renderConfirm(50, 1);

    expect(markup).not.toContain("Video resolution");
    expect(markup).not.toContain("Video length");
  });

  it("对客文案不出现任何引擎/供应商名", () => {
    const markup = renderConfirm(50, 11, { lines: [videoLine] });

    expect(markup).not.toMatch(/seedance|seedream|byteplus|volc|fal\.ai/i);
  });
});

describe("campaign generation result title", () => {
  it.each([
    [{ dispatched: 0, failed: 2, reused: 0 }, null, "Generation did not start"],
    [{ dispatched: 1, failed: 1, reused: 0 }, null, "Generation partly started"],
    [{ dispatched: 2, failed: 0, reused: 0 }, null, "Generation started"],
    [{ dispatched: 0, failed: 0, reused: 0 }, { current: "unknown" as const }, "Generation partly started"],
    [{ dispatched: 0, failed: 0, reused: 0 }, { current: "not_started" as const }, "Generation did not start"],
    [{ dispatched: 1, failed: 0, reused: 0 }, { current: "not_started" as const }, "Generation partly started"],
    // #708 同源症状 ①：全部复用不是「没开始」，是「早就做完了」。
    [{ dispatched: 0, failed: 0, reused: 2 }, null, "Everything was already generated"],
    [{ dispatched: 0, failed: 1, reused: 1 }, null, "Generation did not start"],
    [{ dispatched: 0, failed: 0, reused: 2 }, { current: "not_started" as const }, "Generation did not start"],
  ])("derives the title from the server-confirmed outcome", (result, interruption, expected) => {
    expect(campaignGenerationResultTitle(result, interruption)).toBe(expected);
  });

  it("#708 修复轮 P2-1:复用的那些还在跑时,标题说的是「还在做」而不是「已生成」", () => {
    const allReused = { dispatched: 0, failed: 0, reused: 2 };
    expect(campaignGenerationResultTitle(allReused, null, true)).toBe("Everything was already generated");
    expect(campaignGenerationResultTitle(allReused, null, false)).toBe("Everything is already being made");
  });
});

describe("CampaignListPage pluralization", () => {
  it("renders one plan entry in the singular", () => {
    const props: ComponentProps<typeof CampaignListPage> = {
      initialState: {
        ok: true,
        campaigns: [{
          id: CAMPAIGN_ID,
          name: "Raya launch",
          status: "DRAFT",
          goal: "Launch the Raya collection",
          startAt: "2026-07-24T00:00:00.000Z",
          endAt: "2026-07-31T00:00:00.000Z",
          plan: {
            theme: "Raya",
            rationale: null,
            entries: [{
              id: ENTRY_ID,
              date: "2026-07-25",
              platform: "instagram",
              format: "image",
              hook: "Celebrate together",
              brief: "A festive product image",
              estCredits: 1,
              status: "approved",
            }],
            ideas: [],
          },
          createdAt: "2026-07-23T00:00:00.000Z",
          updatedAt: "2026-07-23T00:00:00.000Z",
        }],
        nextCampaignId: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
        nextCampaignProof: "proof",
      },
    };

    const markup = renderToStaticMarkup(createElement(CampaignListPage, props));

    expect(markup).toContain("1 plan entry");
    expect(markup).not.toContain("1 plan entries");
  });
});
