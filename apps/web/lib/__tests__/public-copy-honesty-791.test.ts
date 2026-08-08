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

const webRoot = path.resolve(__dirname, "../..");
/** Page source with comments stripped — a comment recording what a line USED to say is
 *  not something a visitor reads, and must not count as the page still saying it. */
const readCopy = (rel: string) =>
  readFileSync(path.join(webRoot, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

describe("#791-5 登录页不再低估自己的发布器", () => {
  const login = readCopy("app/login/page.tsx");

  it("不再说「direct publish is coming soon」—— 发布器早就写好了", () => {
    expect(login).not.toMatch(/coming soon/i);
  });

  it("改说真正的卡点:Meta 的审核", () => {
    expect(login).toMatch(/Instagram and Facebook/);
    expect(login).toMatch(/Meta approves/);
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
