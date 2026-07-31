// @vitest-environment jsdom
/**
 * otto-plan-card-detail.test.ts — #580 (detail card T1) + #591 (parked-run honesty).
 *
 * Three things are nailed down here:
 *  1. TYPE ALIGNMENT (the machine gate). The card's local payload type used to declare
 *     7 of the server's fields and silently drop the rest — every spec the merchant was
 *     paying for. The gate below fails at BOTH tsc time and test time if the server
 *     contract grows a field the card doesn't know about.
 *  2. The card shows the full spec and NEVER the engine name, and a downgrade is
 *     disclosed in words rather than swallowed.
 *  3. A run parked on approval renders as "waiting for you", not as work in progress.
 *
 * Display only — nothing here touches the reserve/settle path.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardPayload as ServerCardPayload } from "@fikirtive/otto";

// React refuses act() outside a configured act environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(),
  ottoTurn: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  setAdsAutonomy: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: vi.fn(),
  coworkVaryCard: vi.fn(),
  cancelGenJob: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => new URLSearchParams(),
}));

import {
  OttoPlanCard,
  specChipsOf,
  DOWNGRADE_FALLBACK_NOTE,
  type OttoPlanCardPayload,
} from "@/components/otto/OttoPlanCard";
import {
  OttoTrace,
  TRACE_WAITING_TITLE,
  TRACE_WAITING_HINT,
  notifyPlanApproved,
} from "@/components/otto/OttoTrace";

// ---------------------------------------------------------------------------
// 1. Type alignment — server payload keys ⊆ card payload keys
// ---------------------------------------------------------------------------

// `Record<keyof Required<T>, true>` is exhaustive in BOTH directions: a missing key is a
// tsc error, and `satisfies` rejects an extra one. So each map below is provably the
// complete key set of its type at compile time, and comparable as data at run time.
const SERVER_PAYLOAD_KEYS = {
  kind: true,
  model: true,
  params: true,
  reason: true,
  specSummary: true,
  downgraded: true,
  downgradeNote: true,
  structuredPrompt: true,
  entityIds: true,
  variantSel: true,
  estimatedPriceUsd: true,
  estimatedCredits: true,
  videoStep: true,
  sourceGenerationId: true,
  goal: true,
  referenceVideoGenerationId: true,
} satisfies Record<keyof Required<ServerCardPayload>, true>;

const CARD_PAYLOAD_KEYS = {
  kind: true,
  model: true,
  params: true,
  reason: true,
  specSummary: true,
  downgraded: true,
  downgradeNote: true,
  structuredPrompt: true,
  entityIds: true,
  variantSel: true,
  estimatedPriceUsd: true,
  estimatedCredits: true,
  videoStep: true,
  sourceGenerationId: true,
  goal: true,
  referenceVideoGenerationId: true,
} satisfies Record<keyof Required<OttoPlanCardPayload>, true>;

describe("#580 the card's payload type is aligned with the server contract", () => {
  it("declares every field the server sends — no silent dropping", () => {
    const missing = Object.keys(SERVER_PAYLOAD_KEYS).filter((k) => !(k in CARD_PAYLOAD_KEYS));
    expect(missing).toEqual([]);
  });

  it("invents no field the server never sends", () => {
    const extra = Object.keys(CARD_PAYLOAD_KEYS).filter((k) => !(k in SERVER_PAYLOAD_KEYS));
    expect(extra).toEqual([]);
  });

  // The maps above are exhaustive at tsc time. This one runs the REAL server builder
  // and reads the keys it actually emits, so a field added on the server fails here
  // even before anyone looks at the types.
  it("every field the live builder emits is one the card knows about", async () => {
    const { buildProposeCard } = await import("@fikirtive/otto");
    const ctx = {
      orgId: "org_1",
      userId: "user_1",
      projectId: "proj_1",
      threadId: "thread_1",
      disabledModels: [],
      sourceGenerationId: null,
    } as never;
    const base = { structuredPrompt: "a bowl of laksa", entityIds: [], variantSel: {} };
    const emitted = new Set<string>();
    const cards = [
      // plain video, downgraded video, image ad pack, two-step image, i2v, reference video
      buildProposeCard({ kind: "video", ...base }, ctx, []),
      buildProposeCard({ kind: "video", ...base, desiredDuration: 7, desiredAspect: "1:1" }, ctx, []),
      buildProposeCard({ kind: "image", ...base, count: 3 }, ctx, []),
      buildProposeCard({ kind: "image", ...base, forVideo: true }, ctx, []),
      buildProposeCard({ kind: "video", ...base }, { ...(ctx as object), sourceGenerationId: "gen_img" } as never, []),
      buildProposeCard({ kind: "video", ...base }, { ...(ctx as object), referenceVideoGenerationId: "gen_vid" } as never, []),
    ];
    for (const { cardPayload } of cards) {
      for (const key of Object.keys(cardPayload)) emitted.add(key);
    }
    // The branch coverage above must actually reach the optional fields, or this
    // assertion would pass by simply never exercising them.
    for (const key of ["videoStep", "sourceGenerationId", "referenceVideoGenerationId", "downgradeNote"]) {
      expect(emitted.has(key)).toBe(true);
    }
    expect([...emitted].filter((k) => !(k in CARD_PAYLOAD_KEYS))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Card face — full spec, no engine name, explicit downgrade
// ---------------------------------------------------------------------------

const ENGINE_WORDS = /seedance|seedream|byteplus|veo|kling|ltx|pixverse|grok imagine|hailuo/i;

function renderCard(payload: OttoPlanCardPayload): string {
  const markup = renderToStaticMarkup(
    createElement(OttoPlanCard, {
      cardId: "card_1",
      payload,
      entities: [],
      threadId: "thread_1",
      projectId: "proj_1",
      cardState: "idle" as const,
      pendingApproval: false,
      onApproved: vi.fn(),
      onChangeSomething: vi.fn(),
    }),
  );
  // React escapes apostrophes into entities; the merchant sees the character, so
  // assert against what they read rather than against the wire encoding.
  return markup.replaceAll("&#x27;", "'").replaceAll("&#39;", "'");
}

/** A video card exactly as the server builds it today. */
const VIDEO_PAYLOAD: OttoPlanCardPayload = {
  kind: "video",
  model: "seedance-2-fast",
  params: { aspectRatio: "9:16", resolution: "720p", durationSeconds: 5, audio: true, count: 1 },
  reason: "Seedance 2.0 Fast — 9:16, 5s",
  specSummary: "9:16 · 5s · 720p · With sound",
  downgraded: true,
  downgradeNote: "You asked for 10s — this will be 5s.",
  structuredPrompt: "A steaming bowl of laksa, close up",
  entityIds: [],
  variantSel: {},
  estimatedPriceUsd: 0.39,
  estimatedCredits: 8,
  goal: "an ad to drive weekend footfall",
};

describe("#580 specChipsOf — the spec the merchant reads", () => {
  it("video: length, shape, sound, quality — in that order", () => {
    expect(specChipsOf(VIDEO_PAYLOAD)).toEqual(["5s", "9:16", "With sound", "720p"]);
  });

  it("image pack: how many, and none of the video-only controls", () => {
    expect(
      specChipsOf({ kind: "image", params: { count: 3 } }),
    ).toEqual(["3 images"]);
  });

  it("a single image needs no count chip — the card already says what it is", () => {
    expect(specChipsOf({ kind: "image", params: { count: 1 } })).toEqual([]);
  });

  it("an old card with no params produces no chips instead of guessing", () => {
    expect(specChipsOf({ kind: "video" })).toEqual([]);
  });

  it("never reads the engine off model/reason", () => {
    expect(specChipsOf(VIDEO_PAYLOAD).join(" ")).not.toMatch(ENGINE_WORDS);
  });
});

describe("#580 the card face", () => {
  it("shows every spec chip", () => {
    const markup = renderCard(VIDEO_PAYLOAD);
    for (const chip of ["5s", "9:16", "With sound", "720p"]) {
      expect(markup).toContain(chip);
    }
  });

  it("never renders the engine name, even though the payload carries it", () => {
    const markup = renderCard(VIDEO_PAYLOAD);
    expect(markup).not.toMatch(ENGINE_WORDS);
  });

  it("states the downgrade out loud instead of quietly shipping something smaller", () => {
    expect(renderCard(VIDEO_PAYLOAD)).toContain("You asked for 10s — this will be 5s.");
  });

  it("a downgraded card from before the server note still says something honest", () => {
    const markup = renderCard({ ...VIDEO_PAYLOAD, downgradeNote: undefined });
    expect(markup).toContain(DOWNGRADE_FALLBACK_NOTE);
  });

  it("says nothing about downgrades when the plan honours the request", () => {
    const markup = renderCard({ ...VIDEO_PAYLOAD, downgraded: false, downgradeNote: undefined });
    expect(markup).not.toContain("You asked for");
    expect(markup).not.toContain(DOWNGRADE_FALLBACK_NOTE);
  });

  it("falls back to the server's sanitized summary when a card predates params", () => {
    const markup = renderCard({
      kind: "video",
      specSummary: "Same shape as your reference · 5s · 720p · With sound",
      estimatedCredits: 8,
    });
    expect(markup).toContain("Same shape as your reference");
    expect(markup).not.toMatch(ENGINE_WORDS);
  });
});

// ---------------------------------------------------------------------------
// 3. #591 — a parked run must not pretend to be a running one
// ---------------------------------------------------------------------------

describe("#591 the trace panel while the run is parked on approval", () => {
  const parked = [
    { label: "Planning the campaign", status: "done" as const },
    { label: "Making a visual", status: "waiting" as const },
  ];

  const roots: Array<[ReturnType<typeof createRoot>, HTMLElement]> = [];
  afterEach(() => {
    for (const [root, host] of roots.splice(0)) {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("does not claim Otto is making it", () => {
    const markup = renderToStaticMarkup(createElement(OttoTrace, { steps: parked }));
    expect(markup).not.toContain("Otto is making it");
    expect(markup).toContain(TRACE_WAITING_TITLE);
  });

  it("does not show a step counter that implies work is under way", () => {
    const markup = renderToStaticMarkup(createElement(OttoTrace, { steps: parked }));
    expect(markup).not.toContain("step 1 of");
    expect(markup).not.toContain("step 2 of");
    expect(markup).toContain("waiting for you");
  });

  it("does not animate a progress bar for a step that is not running", () => {
    const markup = renderToStaticMarkup(createElement(OttoTrace, { steps: parked }));
    expect(markup).not.toContain('class="otto-trace-bar"');
    expect(markup).not.toContain('class="otto-trace-spin"');
  });

  it("points the merchant at the button that actually starts it", () => {
    const markup = renderToStaticMarkup(createElement(OttoTrace, { steps: parked }));
    expect(markup).toContain(TRACE_WAITING_HINT);
    expect(markup).toContain("Needs your OK");
  });

  it("a genuinely running turn is untouched — it still reads as in progress", () => {
    const markup = renderToStaticMarkup(
      createElement(OttoTrace, {
        steps: [
          { label: "Planning the campaign", status: "done" as const },
          { label: "Making a visual", status: "active" as const },
        ],
      }),
    );
    expect(markup).toContain("Otto is making it");
    expect(markup).toContain("step 2 of 2");
    expect(markup).not.toContain(TRACE_WAITING_HINT);
  });

  // The other half of the honesty: the panel must not keep asking for a click that
  // already happened. The stream sends no status after the merchant confirms, so the
  // card announces it and the parked panel steps aside.
  it("stops asking for a confirmation the merchant has already given", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push([root, host]);

    act(() => {
      root.render(createElement(OttoTrace, { steps: parked }));
    });
    expect(host.textContent).toContain(TRACE_WAITING_TITLE);
    expect(host.textContent).toContain(TRACE_WAITING_HINT);

    act(() => {
      notifyPlanApproved();
    });
    expect(host.textContent).toBe("");
  });

  it("a running panel is unaffected by a go-ahead from some other card", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push([root, host]);

    const running = [{ label: "Making a visual", status: "active" as const }];
    act(() => {
      root.render(createElement(OttoTrace, { steps: running }));
    });
    act(() => {
      notifyPlanApproved();
    });
    expect(host.textContent).toContain("Otto is making it");
  });
});
