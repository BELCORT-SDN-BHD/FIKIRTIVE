/**
 * otto-provider-failure-copy.test.ts —— 走查修复三(#3310):**我们这边坏了**的那一档,
 * 不能再对商家说「再试一次」。
 *
 * 病灶(3310 走查实证,截图 09、13-15):我们自己的 Anthropic 账户余额不足,服务端拿到
 * `AI_APICallError` status=400「Your credit balance is too low to access the Anthropic API」,
 * 商家读到的却是 `Otto hit a snag — please try again. Reference: OTTO-…`,旁边还有一颗
 * 「Edit and retry」。那句话在**瞬时**错误上成立;在这一档上是误导 —— 再试永远失败,
 * 而商家会一直试下去。
 *
 * 这三组钉板为什么承重:
 *   ① 分类:供应商侧不可恢复(计费 400 / 鉴权 401、403 / 型号 404 / 配额 429 / 5xx)与瞬时
 *      (网络抖动、我们自己的代码抛的普通 Error)必须分开。**变异实证**:把
 *      `isProviderSideFailure` 改成 `return false`(分类表退回一律 snag),①②两组当场红。
 *   ② 文案:诚实句 + 属实的扣费状态 + 把手(Reference),且不得出现供应商名或技术栈字样。
 *   ③ 单源:「这一轮没收钱」全仓只有一处字面量(ENGINE-A4 的降级句与本次的诚实句共用),
 *      源码层面钉住,防止下一个人再抄第四份。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  isProviderSideFailure,
  ottoDegradeText,
  ottoFailureMessage,
  providerUnavailableText,
  OTTO_DEGRADE_SENTENCE,
  OTTO_PROVIDER_UNAVAILABLE_SENTENCE,
  TURN_NOT_CHARGED_SENTENCE,
} from "../otto-error-copy";

const WEB_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");

/** 供应商 400 计费错误的真实形状(AI SDK 的 APICallError:message + responseBody + data)。 */
function billingError(): Error {
  const body = JSON.stringify({
    type: "error",
    error: {
      type: "invalid_request_error",
      message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.",
    },
  });
  return Object.assign(new Error("AI_APICallError: Invalid request"), {
    name: "AI_APICallError",
    statusCode: 400,
    responseBody: body,
    data: JSON.parse(body),
  });
}

function statusError(statusCode: number): Error {
  return Object.assign(new Error(`provider said ${statusCode}`), { name: "AI_APICallError", statusCode });
}

// ---------------------------------------------------------------------------
// ① 分类:供应商侧 vs 瞬时
// ---------------------------------------------------------------------------
describe("ENGINE-A4 供应商侧失败与瞬时失败分开判", () => {
  it("ENGINE-A4:我们这边余额不足的 400 判为供应商侧(3310 走查那一条)", () => {
    expect(isProviderSideFailure(billingError())).toBe(true);
  });

  it.each([
    ["鉴权失效 401", 401],
    ["被禁 403", 403],
    ["型号不存在 404", 404],
    ["配额/限流 429", 429],
    ["供应商故障 500", 500],
    ["同层失败转移之后仍然 529", 529],
  ])("ENGINE-A4:%s 判为供应商侧", (_label, status) => {
    expect(isProviderSideFailure(statusError(status))).toBe(true);
  });

  it("ENGINE-A4:瞬时网络错误与普通 Error 仍走瞬时那一档", () => {
    expect(isProviderSideFailure(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }))).toBe(false);
    expect(isProviderSideFailure(new Error("provider detail must stay private"))).toBe(false);
    expect(isProviderSideFailure(null)).toBe(false);
    expect(isProviderSideFailure("boom")).toBe(false);
  });

  it("ENGINE-A4:不点名计费的普通 400 不算供应商侧(那一档改了消息再试是能成的)", () => {
    expect(isProviderSideFailure(statusError(400))).toBe(false);
  });

  it("ENGINE-A4:包装层里的那个错误也认得出来(retry 壳 lastError / 普通 cause),且不被环卡死", () => {
    expect(isProviderSideFailure({ name: "RetryError", lastError: statusError(429) })).toBe(true);
    expect(isProviderSideFailure(new Error("wrapped", { cause: billingError() }))).toBe(true);

    const a: Record<string, unknown> = { name: "A" };
    const b: Record<string, unknown> = { name: "B", cause: a };
    a.cause = b;
    expect(isProviderSideFailure(a)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ② 文案:诚实句 + 属实的扣费状态 + 把手
// ---------------------------------------------------------------------------
describe("ENGINE-A4 供应商侧的那一句必须诚实", () => {
  it("ENGINE-A4:整笔退了的那一轮,句子自己说「没收钱」,并带 Reference", () => {
    const text = ottoFailureMessage(billingError(), "Otto hit a snag — please try again. Reference: OTTO-ABCD1234", {
      chargedNothing: true,
      errorId: "OTTO-ABCD1234",
    });

    expect(text).toBe(
      "Otto is unavailable right now on our side. This turn wasn't charged. Please try again later. Reference: OTTO-ABCD1234",
    );
    expect(text).not.toMatch(/hit a snag/i);
    // 「马上再试」正是这条走查记录下来的那个死循环。
    expect(text).not.toMatch(/please try again\./i);
  });

  it("ENGINE-A4:没证明退款就不说「没收钱」(不说没发生的事)", () => {
    const text = providerUnavailableText({ errorId: "OTTO-ABCD1234" });
    expect(text).not.toContain(TURN_NOT_CHARGED_SENTENCE);
    expect(text).toBe("Otto is unavailable right now on our side. Please try again later. Reference: OTTO-ABCD1234");
  });

  it("ENGINE-A4:句子里不出现供应商名与技术栈字样", () => {
    const text = ottoFailureMessage(billingError(), "fallback", { chargedNothing: true, errorId: "OTTO-1" });
    expect(text).not.toMatch(/anthropic|claude|openai|byteplus|seedance|seedream|api|400|status/i);
  });

  it("ENGINE-A4:瞬时那一档一个字没变(仍是入口自己的那句)", () => {
    const fallback = "Otto hit a snag — please try again. Reference: OTTO-ABCD1234";
    expect(ottoFailureMessage(new Error("boom"), fallback, { chargedNothing: true })).toBe(fallback);
    expect(ottoFailureMessage(new Error("boom"), "Couldn't reach Otto — please try again.")).toBe(
      "Couldn't reach Otto — please try again.",
    );
  });

  it("ENGINE-A4:截断降级句的两个形态与从前逐字相同", () => {
    expect(ottoDegradeText(false)).toBe("I got a bit tangled up — try asking again.");
    expect(ottoDegradeText(true)).toBe("I got a bit tangled up — try asking again. This turn wasn't charged.");
    expect(ottoDegradeText(true)).toBe(`${OTTO_DEGRADE_SENTENCE} ${TURN_NOT_CHARGED_SENTENCE}`);
    expect(OTTO_PROVIDER_UNAVAILABLE_SENTENCE).toBe("Otto is unavailable right now on our side.");
  });
});

// ---------------------------------------------------------------------------
// ③ 单源:两句共用的字面量全仓只有一处
// ---------------------------------------------------------------------------
describe("ENGINE-A4 「这一轮没收钱」只有一份字面量", () => {
  const SELF = "apps/web/lib/__tests__/otto-provider-failure-copy.test.ts";

  it("ENGINE-A4:apps/ 与 packages/ 的产品代码里,这两句各只写死一次", () => {
    const tracked = execFileSync("git", ["ls-files", "apps", "packages"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      // 测试自己必须写得出被钉的句子,故按**完整相对路径**豁免(与 out-of-credits-copy 同一惯例)。
      .filter((rel) => rel !== SELF && !rel.includes("/__tests__/") && !rel.endsWith(".test.ts"));

    for (const sentence of [TURN_NOT_CHARGED_SENTENCE, OTTO_DEGRADE_SENTENCE]) {
      const offenders = tracked.filter((rel) => {
        let source: string;
        try {
          source = readFileSync(path.join(REPO_ROOT, rel), "utf8");
        } catch {
          return false;
        }
        return source.includes(sentence);
      });
      expect(offenders, `"${sentence}" 被抄成了多份:\n${offenders.join("\n")}`).toEqual([
        "apps/web/lib/otto-error-copy.ts",
      ]);
    }
  });
});
