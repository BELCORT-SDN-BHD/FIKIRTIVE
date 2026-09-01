/**
 * #711 (#433 same shape) — a trend conclusion filed under a campaign must be visible on both
 * sides. The campaign detail read already returns `campaign.trendSnapshots`; nothing rendered it,
 * and the archive card never named the campaign the merchant picked.
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/campaign-actions", () => ({
  approveCampaignEntry: vi.fn(),
  proposeCampaignEntry: vi.fn(),
  removeCampaignEntry: vi.fn(),
  setCampaignGrouping: vi.fn(),
  updateCampaignEntry: vi.fn(),
}));
vi.mock("@/lib/campaign-view-data", () => ({ getCampaign: vi.fn(), listCampaigns: vi.fn() }));
vi.mock("@/lib/trend-actions", () => ({ listTrendSnapshots: vi.fn(), saveTrendSnapshot: vi.fn() }));

import CampaignDetailPage, { CampaignTrendsCard } from "@/components/campaign/campaign-detail-page";
import CampaignTrendsPage from "@/components/campaign/campaign-trends-page";

const CAMPAIGN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const NOW = "2026-08-01T00:00:00.000Z";

const TREND = {
  id: "01KZEKR0MHM40SBFEF5D33SPJK",
  summary: "Locally rooted gift stories are gaining attention before Merdeka.",
  sources: [{ title: "Malaysia seasonal commerce brief", domain: "example.com" }],
  capturedAt: NOW,
  createdAt: NOW,
};

function detailMarkup(trendSnapshots: typeof TREND[]): string {
  const props = {
    initialState: {
      ok: true,
      campaign: {
        id: CAMPAIGN_ID,
        name: "Merdeka gift-box launch",
        status: "DRAFT",
        goal: "Drive pre-orders",
        startAt: NOW,
        endAt: "2026-08-31T15:59:59.999Z",
        plan: null,
        createdAt: NOW,
        updatedAt: NOW,
        grouped: { projects: [], scheduledPosts: [], generations: [], broadcasts: [] },
        available: { projects: [], scheduledPosts: [], generations: [] },
        trendSnapshots,
      },
      nextEntryId: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
      nextEntryProof: "proof",
    },
  } as unknown as ComponentProps<typeof CampaignDetailPage>;
  return renderToStaticMarkup(createElement(CampaignDetailPage, props));
}

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

describe("#711 campaign detail shows the conclusions filed under it", () => {
  it("renders the conclusion the merchant attached, with its source label", () => {
    const markup = detailMarkup([TREND]);

    expect(markup).toContain("Locally rooted gift stories are gaining attention before Merdeka.");
    expect(markup).toContain("Malaysia seasonal commerce brief");
    expect(markup).toContain('href="/campaign/trends"');
  });

  it("shows a visible empty state instead of nothing at all", () => {
    const markup = renderToStaticMarkup(createElement(CampaignTrendsCard, { trendSnapshots: [] }));

    expect(markup).toContain("Trend conclusions");
    expect(markup).toContain("No conclusions are filed under this campaign yet.");
  });
});

describe("#711 trend archive names the campaign each conclusion belongs to", () => {
  it("uses the shared shadcn form and evidence-card language", () => {
    const trendsPage = source("../../components/campaign/campaign-trends-page.tsx");

    expect(trendsPage).toContain("<FieldGroup");
    expect(trendsPage).toContain("<Field>");
    expect(trendsPage).toContain("<SelectGroup>");
    expect(trendsPage).toContain("<Empty");
    expect(trendsPage).not.toContain("text-brand-strong");
  });

  it("labels an attached conclusion with its campaign and links to it", () => {
    const props = {
      initialTrends: {
        ok: true,
        snapshots: [{ ...TREND, campaignId: CAMPAIGN_ID }],
        nextSnapshotId: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
        nextSnapshotProof: "proof",
      },
      initialCampaigns: {
        ok: true,
        campaigns: [{ id: CAMPAIGN_ID, name: "Merdeka gift-box launch" }],
        nextCampaignId: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
        nextCampaignProof: "proof",
      },
    } as unknown as ComponentProps<typeof CampaignTrendsPage>;
    const markup = renderToStaticMarkup(createElement(CampaignTrendsPage, props));

    expect(markup).toContain("Merdeka gift-box launch");
    expect(markup).toContain(`href="/campaign/${CAMPAIGN_ID}"`);
  });

  it("leaves an unattached conclusion unlabelled rather than guessing", () => {
    const props = {
      initialTrends: {
        ok: true,
        snapshots: [{ ...TREND, campaignId: null }],
        nextSnapshotId: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
        nextSnapshotProof: "proof",
      },
      initialCampaigns: {
        ok: true,
        campaigns: [{ id: CAMPAIGN_ID, name: "Merdeka gift-box launch" }],
        nextCampaignId: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
        nextCampaignProof: "proof",
      },
    } as unknown as ComponentProps<typeof CampaignTrendsPage>;
    const markup = renderToStaticMarkup(createElement(CampaignTrendsPage, props));

    expect(markup).not.toContain("Merdeka gift-box launch");
    expect(markup).not.toContain(`href="/campaign/${CAMPAIGN_ID}"`);
  });

  it("clears the campaign choice after a save so the next conclusion is not filed by accident", () => {
    const saveBody = source("../../components/campaign/campaign-trends-page.tsx")
      .split("async function save()")[1]
      ?.split("const ready")[0] ?? "";

    expect(saveBody).toContain('setCampaignId("none")');
  });
});
