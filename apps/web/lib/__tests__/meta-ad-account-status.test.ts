/**
 * #693 —— 广告户状态码永远不对客,人话映射只有一张表。
 *
 * 病灶:lib/meta-actions.ts 把 Meta 的 `account_status` 直接 String() 存进 status,
 * Connections 再原样印出来 —— 商家看到的是「MYR · 1」;户被停用时变成「MYR · 2」,
 * 「我的广告户被停了」这件事在屏幕上一个字都没有。这与 #683(账本内部备注对客可见)
 * 同族:内部代码直接印给商家。
 *
 * 这张表就是那份单点权威。断言钉三头:
 *  ① Meta 官方枚举里每一个真实户状态都有人话,且人话里不含那串数字;
 *  ② 不认识的码不瞎猜 —— 退回诚实兜底(与 describeConnectError 的 default 分支同一套做法);
 *  ③ 非正常状态必须说清楚对广告的后果,不能只换个词继续沉默。
 */
import { describe, expect, it } from "vitest";
import {
  describeMetaAdAccountStatus,
  META_AD_ACCOUNT_STATUS_CODES,
} from "../meta-ad-account-status";

// Meta Marketing API 的 account_status 枚举(真实户状态那一段)。这里逐条写死,
// 表里少一条就红 —— 「枚举全覆盖」不能靠映射表自己给自己打分。
const OFFICIAL_ACCOUNT_STATES: { code: number; meaning: string }[] = [
  { code: 1, meaning: "ACTIVE" },
  { code: 2, meaning: "DISABLED" },
  { code: 3, meaning: "UNSETTLED" },
  { code: 7, meaning: "PENDING_RISK_REVIEW" },
  { code: 8, meaning: "PENDING_SETTLEMENT" },
  { code: 9, meaning: "IN_GRACE_PERIOD" },
  { code: 100, meaning: "PENDING_CLOSURE" },
  { code: 101, meaning: "CLOSED" },
];

describe("#693 广告户状态映射覆盖 Meta 官方枚举", () => {
  it("每一个官方状态码都认得,且给的是人话不是码", () => {
    for (const { code, meaning } of OFFICIAL_ACCOUNT_STATES) {
      const view = describeMetaAdAccountStatus(String(code));
      expect(view, `account_status ${code} (${meaning}) 应有人话`).toBeTruthy();
      expect(view!.tone, `account_status ${code} 应被认得`).not.toBe("unknown");
      // 商家看到的那一行里不许出现那串数字,也不许出现 Meta 的 SCREAMING_CASE 枚举名原文。
      expect(`${view!.label} ${view!.detail ?? ""}`).not.toMatch(/\d/);
      expect(`${view!.label} ${view!.detail ?? ""}`).not.toContain(meaning);
      // English sentence case:首字母大写,其余不是喊出来的。
      expect(view!.label).toMatch(/^[A-Z]/);
      expect(view!.label).not.toBe(view!.label.toUpperCase());
    }
  });

  it("表里登记的码与官方枚举一一对应,不多不少", () => {
    expect([...META_AD_ACCOUNT_STATUS_CODES].sort((a, b) => a - b)).toEqual(
      OFFICIAL_ACCOUNT_STATES.map((s) => s.code),
    );
  });

  it("数字和字符串两种写法一视同仁(Graph 回的是数字,DTO 存的是字符串)", () => {
    expect(describeMetaAdAccountStatus(1)).toEqual(describeMetaAdAccountStatus("1"));
    expect(describeMetaAdAccountStatus(" 2 ")).toEqual(describeMetaAdAccountStatus("2"));
  });

  it("只有真的能投放的状态才算正常;停用/欠费/关闭一律要说清后果", () => {
    expect(describeMetaAdAccountStatus("1")!.tone).toBe("ok");
    // 宽限期广告还在投,所以不吓人,但也不假装没事(仍要交代付款方式)。
    expect(describeMetaAdAccountStatus("9")!.tone).toBe("ok");
    expect(describeMetaAdAccountStatus("9")!.detail).toBeTruthy();
    for (const code of ["2", "3", "7", "8", "100", "101"]) {
      const view = describeMetaAdAccountStatus(code)!;
      expect(view.tone, `account_status ${code} 不该被说成正常`).toBe("attention");
      expect(view.detail, `account_status ${code} 必须交代对广告的后果`).toBeTruthy();
      expect(view.detail!).toMatch(/^[A-Z].*[.!]$/);
    }
  });

  it("停用那一档必须让商家一眼看懂「广告不会投放」", () => {
    const disabled = describeMetaAdAccountStatus("2")!;
    expect(disabled.label).toBe("Disabled");
    expect(disabled.detail!.toLowerCase()).toContain("ads");
  });

  it("不认识的码不瞎猜:诚实兜底,且绝不把那串数字印出来", () => {
    for (const unknown of ["201", "202", "9999", "not-a-number"]) {
      const view = describeMetaAdAccountStatus(unknown)!;
      expect(view.tone).toBe("unknown");
      expect(view.label).toBe("Unknown status");
      expect(`${view.label} ${view.detail ?? ""}`).not.toContain(unknown);
      // 兜底也要给一条真走得通的路,而不是一句「未知」了事。
      expect(view.detail).toBeTruthy();
    }
  });

  it("Meta 根本没报状态时不编一个出来 —— 那一段直接不显示", () => {
    expect(describeMetaAdAccountStatus("")).toBeNull();
    expect(describeMetaAdAccountStatus("   ")).toBeNull();
    expect(describeMetaAdAccountStatus(null)).toBeNull();
    expect(describeMetaAdAccountStatus(undefined)).toBeNull();
  });
});
