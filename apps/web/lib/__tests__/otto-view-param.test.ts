/**
 * otto-view-param.test.ts — `/otto?view=…` 只有一份读法(#969 判官 P2-3)。
 *
 * 病灶:屏幕清单和 `stuff → library` 这条别名被写了两遍 —— 服务端页面(app/otto/page.tsx,
 * 负责给 initialView)一遍,客户端外壳(components/otto/OttoApp.tsx,负责跟随 URL)一遍。
 * 同一张表抄两份,新加一扇门时就会出现「从这边进得去、从那边进不去」。
 *
 * 收成一份之后,两边的差异只剩一处、且是故意的:服务端要能说「地址栏没点名任何屏幕」,
 * 因为那正是它决定要不要往重定向 URL 里塞 ?view= 的依据;客户端必须落到某一屏,所以落到对话。
 */
import { describe, expect, it } from "vitest";
import {
  OTTO_VIEW_KEYS,
  parseOptionalViewParam,
  parseViewParam,
  type OttoViewKey,
} from "@/components/otto/otto-view-param";

describe("parseViewParam — the one reading of ?view=", () => {
  it("honours the stuff → library alias (the old name is still linked to from outside)", () => {
    expect(parseViewParam("stuff")).toBe("library");
    expect(parseOptionalViewParam("stuff")).toBe("library");
  });

  it("passes every real screen through untouched", () => {
    for (const key of OTTO_VIEW_KEYS) {
      const expected: OttoViewKey = key === "stuff" ? "library" : key;
      expect(parseViewParam(key), `?view=${key}`).toBe(expected);
    }
  });

  it("lands on the conversation when the URL names no screen, or names one that does not exist", () => {
    expect(parseViewParam(null)).toBe("otto");
    expect(parseViewParam(undefined)).toBe("otto");
    expect(parseViewParam("")).toBe("otto");
    expect(parseViewParam("billing")).toBe("otto");
    expect(parseViewParam("Library")).toBe("otto"); // case-sensitive, as it always was
  });

  it("the optional reading says 'none named' instead — that is what keeps ?view= out of the redirect", () => {
    expect(parseOptionalViewParam(null)).toBeUndefined();
    expect(parseOptionalViewParam(undefined)).toBeUndefined();
    expect(parseOptionalViewParam("")).toBeUndefined();
    expect(parseOptionalViewParam("billing")).toBeUndefined();
  });
});
