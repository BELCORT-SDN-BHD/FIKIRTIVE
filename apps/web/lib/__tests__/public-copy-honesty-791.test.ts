/**
 * #791 公开页面文案与产品事实对齐。
 *
 * 这些页面是没登录的人唯一读得到的东西 —— 一句低估或高估自己的话,在这里的代价
 * 最高。测试读的是页面源码里的文案常量,因为这些页是 server component,渲染需要
 * 会话/DB;文案本身是纯字符串,读得到就钉得住。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { redactProviderNames } from "@fikirtive/core/provider-secrecy";

const webRoot = path.resolve(__dirname, "../..");
/** Page source with comments stripped — a comment recording what a line USED to say is
 *  not something a visitor reads, and must not count as the page still saying it. */
const readCopy = (rel: string) =>
  readFileSync(path.join(webRoot, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

describe("#791-5 登录页是 Auth journey，不再承担产品发布卖点", () => {
  const login = readCopy("app/login/page.tsx");

  it("不在登入决定前插入发布产品文案", () => {
    expect(login).not.toMatch(/coming soon/i);
    expect(login).not.toMatch(/Instagram|Facebook|Meta approves|PUBLISHING_AVAILABLE/i);
  });
});

// ── #791-8 对外不称 beta(Founder 裁决 2026-08-08 裁决④)──────────────────
//
// 条款页与私隐页把产品称作「invite-only beta」,注册页把 credits 叫「free」,而这些
// credits 是卖的、产品是收费的。称 beta 有两个代价:对商家是「这东西还没做好」的
// 暗示,对我们是一句随时可以拿来搪塞的免责。裁决:对外不再称 beta;合理的「价格与
// 功能会变」的权利以事实陈述保留,不靠 beta 这个词。
describe("#791-8 对外文案不再称 beta", () => {
  for (const page of ["app/terms/page.tsx", "app/privacy/page.tsx", "app/privacy/bm/page.tsx"]) {
    it(`${page} 的正文里没有 beta`, () => {
      expect(readCopy(page)).not.toMatch(/\bbeta\b/i);
    });
  }

  it("条款仍然保留「功能、价格、限制会变」这项权利 —— 去掉的是词,不是条款", () => {
    const terms = readCopy("app/terms/page.tsx");
    expect(terms).toMatch(/features, prices/i);
    expect(terms).toMatch(/continue to change/i);
  });

  it("管辖法这一句照旧成立(法律实质不动,只去掉 beta 这个词)", () => {
    expect(readCopy("app/terms/page.tsx")).toMatch(/governed\s*\n?\s*by the laws of Malaysia/);
  });
});

// ── #810 P3-2:注册页的承诺与价目表钉在一起 ────────────────────────────────
//
// packages/core 的 spend.test.ts 断言「赠额 ≥ 一场对话 + 一张图 + 一条 5s 视频」,
// 三项全部从活的计价权威读。但那条测试证明不了它算的就是**注册页真正承诺的那句
// 话** —— 页面上多写一件、或者把数字打死成 "25 free credits",价目表那侧一无所知。
// 这里补上另一半:页面的数字必须是算出来的,承诺的必须正好是被算过价的那三件。
describe("#810 P3-2 注册页承诺不许自己长出数字或第四件东西", () => {
  const signupPage = readCopy("app/signup/page.tsx");
  const signupForm = readCopy("app/signup/SignupForm.tsx");

  it("数字是从赠额常量算出来的,不是打上去的", () => {
    expect(signupPage).toContain("displayCredits(SIGNUP_GRANT_CREDITS)");
    expect(signupPage).toContain("starterCredits={starterCredits}");
    expect(signupForm).toContain("{starterCredits} starter credits");
    expect(`${signupPage}\n${signupForm}`).not.toMatch(/\d+\s*(?:free|starter) credits/i);
  });

  it("minimal Auth 不再把赠额扩写成额外能力承诺", () => {
    expect(signupForm).not.toMatch(/enough for a full run|conversation with Otto|short video/i);
  });
});

// ── #805 主话术:「它帮你把活干完了」 ─────────────────────────────────────────
//
// Founder 裁决(2026-08-08 弹窗 产品⑤):主话术改为「它帮你把活干完了 —— 建活动、
// 调分群、看钱、换素材」;「像真人」降为体验描述,不作定价论据。背景是 Meta 已在
// 2026-06-03 把「WhatsApp 里会聊天的 AI」免费化 —— 会聊天不再是卖点,活干完了才是。
//
// 商家看得到的这三面(登录页 = 未登录唯一读得到的落地面、注册页、Otto 进门自我介绍)
// 必须说同一句话。仓内没有独立官网,登录页左半屏就是落地文案本体。
describe("#805 对外主话术:先说把活干完", () => {
  /** 商家看得到、且承载主话术的三面。Otto 提示词那一面由
   *  packages/otto/src/instructions.test.ts 钉(它在另一个包,读不到这里)。 */
  const SURFACES: ReadonlyArray<[string, string]> = [
    ["Otto 进门", "components/otto/OttoFrontDoor.tsx"],
  ];

  describe("Auth surfaces", () => {
    const login = readCopy("app/login/page.tsx");
    const signup = readCopy("app/signup/page.tsx");

    it("登录与注册不再兼任 marketing landing page", () => {
      for (const authCopy of [login, signup]) {
        expect(authCopy).not.toMatch(/Otto gets the|work done|campaign|where the money went/i);
        expect(authCopy).not.toMatch(/\btrusted by\b|without becoming a/i);
      }
    });
  });

  it("Otto 进门那句说的是做完的活,不是「我陪你走一遍」", () => {
    const frontDoor = readCopy("components/otto/OttoFrontDoor.tsx");
    expect(frontDoor).toMatch(/I&apos;ll do the work/);
  });

  // 裁决的第二半:「像真人」可以是体验描述,但不许出现在商家可见表面上当卖点。
  // 这里禁的是**把「像真人」写成产品价值**的那一族说法,不禁「warm」「plain language」
  // 这类体验用词 —— 那些本来就允许。
  const HUMAN_AS_VALUE =
    /\blike a (?:real )?(?:person|human)\b|\bhuman-?like\b|\blike talking to a (?:real )?(?:person|human)\b|\bjust like a human\b/i;

  for (const [name, rel] of SURFACES) {
    it(`${name}不拿「像真人」当卖点`, () => {
      expect(readCopy(rel)).not.toMatch(HUMAN_AS_VALUE);
    });
  }

  // 白标铁律:供应商/模型名不得出现在任何商家可见表面。不另抄一份名单 —— 直接用
  // 洗名权威本身:洗过之后一个字节都没变,才叫没提过。
  for (const [name, rel] of SURFACES) {
    it(`${name}不出现供应商或模型名`, () => {
      const copy = readCopy(rel);
      expect(redactProviderNames(copy)).toBe(copy);
    });
  }
});
