import { describe, it, expect } from "vitest";
import {
  STRATEGY_FAMILIES,
  DISTANT_PAIRS,
  SPECIFICITY,
  decideStrategy,
  type StrategyFamily,
} from "./prompt-strategy.js";

describe("STRATEGY_FAMILIES table", () => {
  it("covers exactly the six families", () => {
    expect(STRATEGY_FAMILIES.map((f) => f.family).sort()).toEqual(
      ["beatSync", "dialogueDrama", "ecommerce", "educational", "fantasyAnimation", "generalCreative"].sort(),
    );
  });
  it("every non-fallback family carries trilingual signals", () => {
    for (const f of STRATEGY_FAMILIES) {
      if (f.family === "generalCreative") continue;
      expect(f.signals.en.length, `${f.family} en`).toBeGreaterThan(0);
      expect(f.signals.zh.length, `${f.family} zh`).toBeGreaterThan(0);
      expect(f.signals.ms.length, `${f.family} ms`).toBeGreaterThan(0);
    }
  });
  it("every family asks at most 2 clarifying questions; distant pairs too", () => {
    for (const f of STRATEGY_FAMILIES) {
      expect(f.questions.length).toBeLessThanOrEqual(2);
      expect(f.questions.length).toBeGreaterThan(0);
    }
    for (const d of DISTANT_PAIRS) {
      expect(d.questions.length).toBeGreaterThan(0);
      expect(d.questions.length).toBeLessThanOrEqual(2);
    }
  });
  it("SPECIFICITY ranks every family once, generalCreative last", () => {
    expect([...SPECIFICITY].sort()).toEqual(STRATEGY_FAMILIES.map((f) => f.family).sort());
    expect(SPECIFICITY[SPECIFICITY.length - 1]).toBe("generalCreative");
  });
});

describe("decideStrategy — happy paths per language", () => {
  const route = (d: ReturnType<typeof decideStrategy>): StrategyFamily => {
    expect(d.kind).toBe("route");
    return (d as Extract<typeof d, { kind: "route" }>).family;
  };

  it("English e-commerce signals route to ecommerce", () => {
    expect(route(decideStrategy({ text: "I need a product video for our new listing, big sale next week" }))).toBe("ecommerce");
  });
  it("华语电商信号 → ecommerce", () => {
    expect(route(decideStrategy({ text: "帮我做一条上新带货视频，主打卖点" }))).toBe("ecommerce");
  });
  it("Malay e-commerce signals → ecommerce", () => {
    expect(route(decideStrategy({ text: "nak buat iklan promosi untuk kedai saya" }))).toBe("ecommerce");
  });
  it("@product reference alone is a strong-enough signal (可单独定族)", () => {
    expect(route(decideStrategy({ text: "make something nice with this", referenceRoles: ["product"] }))).toBe("ecommerce");
  });
  it("a product link alone routes to ecommerce", () => {
    expect(route(decideStrategy({ text: "buat video untuk ini", hasProductLink: true }))).toBe("ecommerce");
  });
  it("华语短剧信号 → dialogueDrama", () => {
    expect(route(decideStrategy({ text: "来一个短剧，两个角色对话带反转" }))).toBe("dialogueDrama");
  });
  it("Malay tutorial signals → educational", () => {
    expect(route(decideStrategy({ text: "video cara buat kuih, langkah demi langkah" }))).toBe("educational");
  });
  it("English beat-sync signals → beatSync", () => {
    expect(route(decideStrategy({ text: "a montage cut to the beat with hard transitions" }))).toBe("beatSync");
  });
  it("华语动画信号 → fantasyAnimation", () => {
    expect(route(decideStrategy({ text: "做一个水墨风格的奇幻动画" }))).toBe("fantasyAnimation");
  });
  it("word-boundary matching: 'made' does not trip the 'ad' keyword", () => {
    const d = decideStrategy({ text: "I made a drawing of my cat yesterday" });
    expect(d.kind).toBe("route");
    expect((d as Extract<typeof d, { kind: "route" }>).family).toBe("generalCreative");
  });
});

describe("decideStrategy — ambiguous branch (≤2 questions)", () => {
  it("bare 'story'/'cerita' ties dialogueDrama vs fantasyAnimation → ask real-or-fictional", () => {
    for (const text of ["I want a story video", "买一个 故事 视频", "buat video cerita"]) {
      const d = decideStrategy({ text });
      expect(d.kind, text).toBe("ask");
      const ask = d as Extract<typeof d, { kind: "ask" }>;
      expect([...ask.candidates].sort()).toEqual(["dialogueDrama", "fantasyAnimation"]);
      expect(ask.questions.length).toBeGreaterThan(0);
      expect(ask.questions.length).toBeLessThanOrEqual(2);
    }
  });
  it("bare 'viral' ties ecommerce vs beatSync → ask product-or-montage", () => {
    const d = decideStrategy({ text: "make me something viral" });
    expect(d.kind).toBe("ask");
    const ask = d as Extract<typeof d, { kind: "ask" }>;
    expect([...ask.candidates].sort()).toEqual(["beatSync", "ecommerce"]);
    expect(ask.questions.length).toBeLessThanOrEqual(2);
  });
  it("adding a stronger signal resolves the tie without questions", () => {
    const d = decideStrategy({ text: "make me something viral", referenceRoles: ["product"] });
    expect(d.kind).toBe("route");
    expect((d as Extract<typeof d, { kind: "route" }>).family).toBe("ecommerce");
  });
});

describe("decideStrategy — signal dedupe (复审 P2：跨语言表重复词只计一次)", () => {
  it("'tutorial' (in both the en and ms tables) scores ONCE and appears once in matched", () => {
    const d = decideStrategy({ text: "a tutorial video" });
    expect(d.kind).toBe("route");
    const r = d as Extract<typeof d, { kind: "route" }>;
    expect(r.family).toBe("educational");
    expect(r.matched.filter((m) => m === "tutorial")).toHaveLength(1);
  });
  it("no matched list ever contains duplicate surface forms", () => {
    for (const text of ["tutorial", "belajar tutorial cara buat kuih"]) {
      const d = decideStrategy({ text });
      expect(d.kind, text).toBe("route");
      const r = d as Extract<typeof d, { kind: "route" }>;
      expect(new Set(r.matched).size, `text: ${text}`).toBe(r.matched.length);
    }
  });
  it("double-counting no longer tips a tie: one 'tutorial' cannot outscore two distinct signals", () => {
    // "iklan promosi" = 2 distinct ecommerce signals vs a single deduped "tutorial" (1).
    const d = decideStrategy({ text: "iklan promosi tutorial" });
    expect(d.kind).toBe("route");
    expect((d as Extract<typeof d, { kind: "route" }>).family).toBe("ecommerce");
  });
});

describe("decideStrategy — open-endedness guard (不预判商家)", () => {
  it("a personal request with no signals routes to generalCreative with NO questions", () => {
    const d = decideStrategy({ text: "a video for my grandma's 80th birthday" });
    expect(d).toEqual({ kind: "route", family: "generalCreative", matched: [] });
  });
  it("华语个人请求同样兜底，不往带货掰", () => {
    const d = decideStrategy({ text: "帮我做一张给朋友的生日祝福图" });
    expect(d.kind).toBe("route");
    expect((d as Extract<typeof d, { kind: "route" }>).family).toBe("generalCreative");
  });
});
