import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/campaign-generation-confirm", () => ({
  confirmCampaignGeneration: vi.fn(),
}));

import CampaignConfirmPage, {
  campaignGenerationResultTitle,
} from "@/components/campaign/campaign-confirm-page";
import CampaignListPage from "@/components/campaign/campaign-list-page";

const CAMPAIGN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ENTRY_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";

function confirmProps(
  balanceDisplayCredits: number,
  totalDisplayCredits: number,
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
        lines: [{
          entryId: ENTRY_ID,
          brief: "A festive product image",
          kind: "image",
          model: "image-model",
          displayCredits: totalDisplayCredits,
        }],
        totalDisplayCredits,
        count: 1,
        contentFingerprint: "a".repeat(64),
      },
    },
  };
}

function renderConfirm(balanceDisplayCredits: number, totalDisplayCredits: number): string {
  return renderToStaticMarkup(
    createElement(CampaignConfirmPage, confirmProps(balanceDisplayCredits, totalDisplayCredits)),
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

describe("campaign generation result title", () => {
  it.each([
    [{ dispatched: 0, failed: 2 }, null, "Generation did not start"],
    [{ dispatched: 1, failed: 1 }, null, "Generation partly started"],
    [{ dispatched: 2, failed: 0 }, null, "Generation started"],
    [{ dispatched: 0, failed: 0 }, { current: "unknown" as const }, "Generation partly started"],
    [{ dispatched: 0, failed: 0 }, { current: "not_started" as const }, "Generation did not start"],
    [{ dispatched: 1, failed: 0 }, { current: "not_started" as const }, "Generation partly started"],
  ])("derives the title from the server-confirmed outcome", (result, interruption, expected) => {
    expect(campaignGenerationResultTitle(result, interruption)).toBe(expected);
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
