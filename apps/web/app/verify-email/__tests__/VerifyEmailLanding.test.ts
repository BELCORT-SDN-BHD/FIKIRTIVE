// @vitest-environment jsdom
/**
 * 顺序型假红的隔离修法(前端基线① 乙组):这份用例单跑一直是绿的,只有在**全量**里才
 * 炸在 `next/image` 的 `window.location.href` 上 —— 那是 Next 只在 dev 分支跑的一段
 * 「记录页面上所有图片」的遥测,它的前提是 `typeof window !== "undefined"` 时 window 是
 * 一个**真的**浏览器 window。整个 apps/web 的 vitest 是 `singleThread`,一条工作线程
 * 顺序跑完 456 个文件,环境按文件切换;跑在前面的某个 node 环境文件在 globalThis 上留下
 * 了一个残缺的 `window`(有对象、没 location),这一份就撞上去。
 *
 * 这个组件本来就是 `"use client"` 的浏览器组件(它自己会调 `window.location.replace`),
 * 所以让它在真的 jsdom 里跑,才是它该有的环境 —— 顺带把它从「上一个文件留下什么」里摘出来。
 * 断言一条没动。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerifyEmailLanding } from "../VerifyEmailLanding";

describe("VerifyEmailLanding", () => {
  it("renders the signing-in state on first paint when a token is present (#940)", () => {
    const markup = renderToStaticMarkup(
      createElement(VerifyEmailLanding, { token: "eyJhbGciOi.abc.def", callbackURL: "/otto" }),
    );

    expect(markup).toContain("Signing you in");
    // The spinner is visible, not decorative-only-in-CSS-that-might-not-load.
    expect(markup).toContain("animate-spin");
    expect(markup).toContain('role="status"');
  });

  it("does not render an error state while a token is present", () => {
    const markup = renderToStaticMarkup(
      createElement(VerifyEmailLanding, { token: "eyJhbGciOi.abc.def", callbackURL: "/otto" }),
    );

    expect(markup).not.toContain("This link no longer works");
  });

  it("falls back to an honest broken-link message when there is no token to forward", () => {
    const markup = renderToStaticMarkup(createElement(VerifyEmailLanding, {}));

    expect(markup).toContain("This link no longer works");
    expect(markup).toContain('href="/login"');
    expect(markup).not.toContain("Signing you in");
  });
});
