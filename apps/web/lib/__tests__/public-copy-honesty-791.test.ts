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

// ── #791-5 逐字钉句退役 → 机制断言(Founder 授权编排者判,2026-08-25)────────────
//
// 【碑文】原三条钉的是旧登录页的具体句子:「不再说 coming soon」「改说 Meta approves」
// 「那句只活在 PUBLISHING_AVAILABLE 的通电支里」。R22 重写(Founder 批准)把整块营销
// 文案从登录页拿掉了,被钉的句子连同它们的两支一起不存在了 —— 钉子失去对象,断言从
// 「守着一句实话」退化成「守着一个已经不在的形状」。裁决:拆钉,但**恢复它保护的机制**:
// 公开页关于发布能力的口径必须来自 packages/core 的开关,页面自己一个字都不写。
// 通电那天翻 PUBLISHING_AVAILABLE 一行,登录页与注册页跟着改口,没有第二处措辞要找。
//
// 措辞两态由 publish-honest-preview.test.ts ⑥ 钉(词族在那边);这里钉的是**页面这一侧**:
// 口径 import 自权威,且页面源码里没有一句手写的发布能力主张。
describe("#791-5 公开页的发布口径归开关管,不是页面自己写的", () => {
  const PUBLIC_PAGES: ReadonlyArray<[string, string]> = [
    ["登录页", "app/login/page.tsx"],
    ["注册页", "app/signup/page.tsx"],
  ];

  /** 手写发布能力主张的几种自然写法。不求穷尽 —— 求的是「顺手再写一句」会立刻红。 */
  const HAND_WRITTEN_PUBLISH_CLAIM = [
    /\bpublishes to\b/i,
    /\bwill (?:be )?(?:automatically )?(?:publish|post|go out|send|be sent)\b/i,
    /\bauto-?publish\b/i,
    /\bgoes? live\b/i,
    /\bonce Meta approves\b/i,
    /\bcoming soon\b/i,
  ];

  for (const [name, rel] of PUBLIC_PAGES) {
    it(`${name}的那句话 import 自 gate 模块`, () => {
      const src = readCopy(rel);
      expect(src, "发布口径必须来自权威模块,不许在页面里另起一套").toMatch(
        /import\s*\{[^}]*\bpublicPublishLine\b[^}]*\}\s*from\s*"@fikirtive\/core\/schedule-draft"/,
      );
      expect(src, "import 了却没用,等于没接上开关").toContain("publicPublishLine()");
    });

    it(`${name}源码里没有一句手写的发布能力主张`, () => {
      const src = readCopy(rel);
      // 承重自检:这张网必须真的会响,否则下面的 not.toMatch 全是空过。
      const planted = "Approved posts will publish to your account, and auto-publish sends them.";
      expect(HAND_WRITTEN_PUBLISH_CLAIM.some((re) => re.test(planted))).toBe(true);
      for (const re of HAND_WRITTEN_PUBLISH_CLAIM) {
        expect(src, `${rel} 里长出了一句手写的发布承诺:${re}`).not.toMatch(re);
      }
    });
  }
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
  const signup = readCopy("app/signup/page.tsx");

  it("数字是从赠额常量算出来的,不是打上去的", () => {
    expect(signup).toContain("displayCredits(SIGNUP_GRANT_CREDITS)");
    expect(signup).toMatch(/\{starterCredits\}\s*free credits/);
    // 正文里不许出现「<数字> free credits」这种写死的说法(改赠额时它会静静变成谎话)。
    expect(signup).not.toMatch(/\d+\s*free credits/);
  });

  // 【碑文】原第二条(「承诺的正好是被算过价的那三件」+ promisedItems() 拆句器)已退役。
  // 它钉的是注册页那句「enough for a full run: a conversation with Otto, an image and a short
  // video」的逐字形状;R22 重写(Founder 批准)把副标题改成「Confirm your email, then name and
  // prepare one workspace.」,那句枚举不在了,拆句器分不到任何东西,断言只会永红。
  // 裁决:Founder 授权编排者判,2026-08-25 —— 旧文案钉子拆钉立碑作废。
  // 保留的这一条不是钉句子,是钉**机制**:数字必须从 SIGNUP_GRANT_CREDITS 算出来,正文里不许
  // 出现写死的「<数字> free credits」。改赠额时那一侧仍旧不会静静变成谎话。
  // 若哪天注册页重新枚举「这些赠额够干什么」,这条枚举断言要连同拆句器一起回来。
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
    ["登录页", "app/login/page.tsx"],
    ["注册页", "app/signup/page.tsx"],
    ["Otto 进门", "components/otto/OttoFrontDoor.tsx"],
  ];

  // 【碑文】登录页三条**正面**逐字钉已退役,裁决:Founder 授权编排者判,2026-08-25。
  //   ① 「主标题说的是活干完了」(钉 `Otto gets the … work done` / 禁 `without becoming a`)
  //   ② 「四件事一件不少」(钉 campaign / segment / where the money went / creative 四词)
  //   ③ 「说的是审批卡真正管得住的那一半」(钉 `nothing gets made or published until you approve`)
  // R22 重写(Founder 批准)把登录页收成一块纯登录闸:品牌标、验证码卡、法务页脚,整块落地
  // 营销文案不在这一页了。三条钉的都是那块文案里的具体句子,页面没了句子,钉子就只剩形状。
  // 主话术这件事本身没有作废 —— 它现在没有承载面;哪天公开落地面回来(独立官网或登录页重开
  // 左半屏),这三条要照原样回来钉在那一面上。
  // 下面留着的是**负面**断言:它们不要求页面说什么,只要求页面别说得比事实大 —— 这类断言在
  // 一块空页面上照样成立、照样会在有人重新写文案时立刻咬人,所以一条都不退。
  describe("登录页", () => {
    const login = readCopy("app/login/page.tsx");

    it("不拿证明不了的社会证明当卖点(没有可指名的公开商家)", () => {
      expect(login).not.toMatch(/\btrusted by\b/i);
    });

    // r2 · 判官 P1(PR #831 评论 5232023830):第一版写的是「brings every paid step back for
    // you to approve first」。**这句话是假的** —— 和 Otto 聊天本身就按消息预扣结算,那条路
    // (OttoFrontDoor 的 ottoTurn 调用)上根本没有审批卡。审批卡真实覆盖的是付费生成与发布。
    // 未登录的人读到的第一句钱路承诺,只能说得比事实小,不许说得比事实大。
    it("不承诺「凡花钱都先经你点头」—— 审批卡覆盖的是做东西与发布,不是每一次计费", () => {
      expect(login).not.toMatch(/every paid step/i);
      expect(login).not.toMatch(/every step that (?:spends|costs)/i);
    });

  });

  // 【碑文】「注册页把 Otto 派去干活」(钉 `put Otto to work` / 禁 `meet Otto`)已退役,
  // 同一裁决(2026-08-25)。R22 的注册页副标题改成了「Confirm your email, then name and
  // prepare one workspace.」—— 讲的是注册这件事本身,不再承载主话术。禁语 `meet Otto` 这一半
  // 也一并退:它禁的是主话术的错误写法,没有主话术就没有对象。落地面回来时与登录页三条同批回来。


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
