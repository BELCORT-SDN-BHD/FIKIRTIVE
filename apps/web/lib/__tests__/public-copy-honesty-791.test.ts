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
