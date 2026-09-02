import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SETTINGS_SECTIONS, SHELL_ROUTES } from "@fikirtive/core/navigation";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/storage", () => ({
  storage: { url: () => "https://example.test/asset" },
  kindOf: () => "image",
}));

import { OttoStreamErrorNotice } from "@/components/otto/OttoStreamErrorNotice";
import { toChatMessageDTO } from "@/lib/dto";
import { persistedStreamErrorOf } from "@/lib/otto-status-helpers";
import { threadToUiMessages } from "@/lib/otto-ui-messages";
import type { OttoErrorData } from "@/lib/otto-stream-bridge";
import type { ChatThreadDTO } from "@/lib/types";

const WEB_ROOT = path.resolve(__dirname, "../..");
const pageOf = (href: string) =>
  readFileSync(path.join(WEB_ROOT, "app", href.replace(/^\//, ""), "page.tsx"), "utf8");

/**
 * 花费上限控件**今天**住在哪一页 —— 从路由表推导,不手抄地址。
 *
 * 判官 2026-09-02 P1:换壳把上限控件从 Settings 搬到了 Billing & credits
 * (`app/billing/page.tsx` 挂 `<SpendCapCard>`),而拒绝提示里那颗唯一能点的按钮还指着
 * `/settings` —— 一个本 PR 自己用围栏保证「一个钱控件都没有」的地方。旧围栏把错的目的地
 * 逐字钉死(`href="/settings"` + `not.toContain('href="/billing"')`),于是谁去修这条链谁当场红。
 *
 * 所以这里不再钉一个字面地址,改成钉**关系**:出路必须指向真的画着上限控件的那一页。
 * 控件将来再搬家,这条围栏跟着搬,而产品不跟着搬就红。
 */
/** 导航 registry 里「上限住在哪一面」那一格 —— 名字与地址的单一来源。 */
const CAP_SECTION = SETTINGS_SECTIONS.find((section) => section.key === "billing")!;

/** renderToStaticMarkup 会把 `&` 转义,断言得按转义后的样子比。 */
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;");

const CAP_CONTROL_ROUTE = (() => {
  const candidates = [SHELL_ROUTES.billing, SHELL_ROUTES.preferences];
  const owners = candidates.filter((href) => pageOf(href).includes("<SpendCapCard"));
  if (owners.length !== 1) {
    throw new Error(
      `花费上限控件在 ${candidates.join(" / ")} 里找到 ${owners.length} 处 —— 出路无处可指,先修产品`,
    );
  }
  return owners[0]!;
})();

function renderNotice(
  error: OttoErrorData,
  retryDraft?: string,
): string {
  return renderToStaticMarkup(createElement(OttoStreamErrorNotice, {
    error,
    retryDraft,
    onRetry: retryDraft ? vi.fn() : undefined,
  }));
}

describe("OttoStreamErrorNotice", () => {
  it("renders the first-turn insufficient-credits notice with the server copy and top-up guidance", () => {
    const markup = renderNotice({
      kind: "insufficient_credits",
      text: "You're out of credits.",
    });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("You&#x27;re out of credits.");
    expect(markup).toContain('href="/billing"');
    expect(markup).toContain("Top up");
  });

  it("rehydrates the user message and honest failure after a remount", () => {
    const createdAt = new Date("2026-07-23T00:00:00.000Z");
    const userMessage = toChatMessageDTO({
      id: "user_1",
      role: "USER",
      kind: "TEXT",
      seq: 1,
      text: "Make a launch post",
      payload: null,
      genJobId: null,
      createdAt,
    } as never, new Map());
    const failureMessage = toChatMessageDTO({
      id: "error_1",
      role: "AGENT",
      kind: "TURN_ERROR",
      seq: 2,
      text: "You're out of credits.",
      payload: {
        kind: "stream_run_error",
        userMessageId: "user_1",
        error: { kind: "insufficient_credits", text: "You're out of credits." },
      },
      genJobId: null,
      createdAt,
    } as never, new Map());
    const thread: ChatThreadDTO = {
      id: "thread_1",
      projectId: "project_1",
      title: "Launch post",
      updatedAt: "2026-07-23T00:00:00.000Z",
      messages: [userMessage, failureMessage],
    };

    const rehydrated = threadToUiMessages(thread);
    const durableError = persistedStreamErrorOf(
      rehydrated[1].metadata?.payload,
      "fallback must not replace server copy",
    );

    expect(rehydrated[0]).toMatchObject({
      role: "user",
      parts: [{ type: "text", text: "Make a launch post" }],
    });
    expect(durableError).toEqual({
      kind: "insufficient_credits",
      text: "You're out of credits.",
    });
    const markup = renderNotice(durableError);
    expect(markup).toContain('href="/billing"');
    expect(markup).toContain("Top up");
  });

  // #524 — the spend cap is a real refusal now, so its notice must point at the limit the
  // merchant can actually move. A Top-up link here would send them to buy credits they
  // already have, for an action their own setting stopped.
  it("points a spend-cap refusal at the page that actually holds the cap control", () => {
    const capCopy =
      "Paused by your spend cap — this needs 11 credits and your cap is 5 credits per action. Raise the cap in Billing & credits to run it.";
    const markup = renderNotice({ kind: "spend_cap", text: capCopy });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Paused by your spend cap");
    // 出路 = 真的画着上限控件的那一页(今天是 /billing)。地址从路由表推导,不手抄。
    expect(markup, "拒绝提示里那颗按钮没指向上限控件所在的页").toContain(
      `href="${CAP_CONTROL_ROUTE}"`,
    );
    // 按钮上的名字也来自同一份 registry —— 不许自己另起一个叫法。
    expect(markup, "按钮上的名字不是导航 registry 里那一格的名字").toContain(
      `Open ${escapeHtml(CAP_SECTION.label)}`,
    );
    // 句子念的地方,和按钮去的地方,必须是同一个地方。
    expect(capCopy, "文案念的目的地与按钮的目的地对不上").toContain(CAP_SECTION.label);
    expect(CAP_CONTROL_ROUTE).toBe(CAP_SECTION.href);
    expect(CAP_CONTROL_ROUTE).toBe(SHELL_ROUTES.billing);
    // 上限被拒 ≠ 没钱:这条出路不许退化成一颗充值键。
    expect(markup).not.toContain("Top up");
  });

  // The durable TURN_ERROR row must carry the spend-cap kind through a reload, or a refresh
  // silently downgrades the refusal to a generic error and the exit disappears.
  it("rehydrates a persisted spend-cap refusal with its own kind", () => {
    const createdAt = new Date("2026-08-11T00:00:00.000Z");
    const failureMessage = toChatMessageDTO({
      id: "error_2",
      role: "AGENT",
      kind: "TURN_ERROR",
      seq: 2,
      text: "Paused by your spend cap.",
      payload: {
        kind: "stream_run_error",
        userMessageId: "user_1",
        error: { kind: "spend_cap", text: "Paused by your spend cap." },
      },
      genJobId: null,
      createdAt,
    } as never, new Map());
    const thread: ChatThreadDTO = {
      id: "thread_2",
      projectId: "project_1",
      title: "Launch post",
      updatedAt: "2026-08-11T00:00:00.000Z",
      messages: [failureMessage],
    };

    const durableError = persistedStreamErrorOf(
      threadToUiMessages(thread)[0].metadata?.payload,
      "fallback must not replace server copy",
    );

    expect(durableError).toEqual({ kind: "spend_cap", text: "Paused by your spend cap." });
    // 刷新之后那条出路也必须还在,而且指向同一个地方(上限控件所在的页)。
    expect(renderNotice(durableError)).toContain(`href="${CAP_CONTROL_ROUTE}"`);
  });

  it("keeps the existing generic reply failure presentation and retry action", () => {
    const markup = renderNotice(
      { kind: "error", text: "Otto hit a snag - please try again." },
      "Try another post",
    );

    expect(markup).toContain("Otto hit a snag - please try again.");
    expect(markup).toContain("Edit and retry");
    expect(markup).not.toContain("Top up");
  });
});
