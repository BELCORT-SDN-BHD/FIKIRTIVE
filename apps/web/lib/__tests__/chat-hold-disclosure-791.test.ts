/**
 * #791-9 Otto 预扣披露。
 *
 * 一场对话开始前,产品会先从余额里冻结一笔(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL),
 * 结算时按实际 token 花费扣,剩下的当场退回。这整件事对商家从来没说过 —— 他只会看到
 * 余额先掉一块、过一会儿又回来一点,而产品一个字没解释。
 *
 * 「用多少扣多少、剩下当场退」是这条钱路真实的行为(settleCredits 把 A = min(actual, held)
 * 之外的部分退回 balance),说出来只有好处:它比商家自己猜的更宽厚。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const webRoot = path.resolve(__dirname, "../..");

/**
 * R3-F06(Founder 2026-09-14「输入附近不要这类常驻说明」+ 2026-09-15 当面追加「整段一起删」)。
 *
 * 这一组从前钉的是界面上那句 `CHAT_HOLD_NOTE`(「Each message holds up to N …」):它必须在、
 * 必须说「up to」、数字必须现算、必须挂在商家开始对话的那一屏上。Founder 裁掉了门厅页尾那条
 * 「You stay in control」之后,那句话在产品面上一个消费者都不剩,常量也随之删除。
 *
 * **被删的是那句话,不是那件事。** 预扣照旧:先冻结 min(常量, 余额),结算按实际 token 花费扣,
 * 差额同笔事务退回(`settleCredits`:A = min(actual, held))。所以这一组现在钉两半 ——
 *   ① 产品面上确实不再常驻这段说明(下面第一条,同时拦「换个地方又挂回来」);
 *   ② **这件事仍然说得出口**:Otto 被问到时自己答得上来(第二组,原封不动)。
 *      真实数字另有 Billing 的账目与 journeys 02/03/04(开着的冻结 / 按实结算 / 整额退款)。
 */
describe("R3-F06 预扣说明不再常驻在产品面上,但那件事没变", () => {
  it("门厅与钱文案单一来源都不再带这句话", () => {
    const frontDoor = readFileSync(path.join(webRoot, "components/otto/OttoFrontDoor.tsx"), "utf8");
    expect(frontDoor, "门厅又挂回了预扣说明").not.toContain("CHAT_HOLD_NOTE");
    expect(frontDoor, "门厅自己抄了一份预扣文案").not.toContain("Each message holds up to");

    const creditFormat = readFileSync(path.join(webRoot, "lib/credit-format.ts"), "utf8");
    expect(
      creditFormat,
      "CHAT_HOLD_NOTE 又被建出来了 —— 没有消费者的钱文案常量不留在仓库里",
    ).not.toContain("export const CHAT_HOLD_NOTE");
  });

  it("没有任何产品面再念这句话(整仓扫一遍,不只门厅)", () => {
    // 只盯门厅会漏:换个页面挂同一句话,上一条照样绿。
    const roots = ["components", "app", "lib", "design-system"];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(path.join(webRoot, dir), { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith(".")) continue;
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
          if (readFileSync(path.join(webRoot, rel), "utf8").includes("Each message holds up to")) {
            offenders.push(rel);
          }
        }
      }
    };
    for (const root of roots) walk(root);
    expect(offenders, "有产品面又把预扣说明挂回来了").toEqual([]);
  });
});

describe("#791-9 Otto 自己也答得上来", () => {
  it("指令里写明预扣三件事,Otto 被问到时不必猜", async () => {
    const { ottoInstructions } = await import("@fikirtive/otto");
    expect(ottoInstructions).toMatch(/holds a few credits before it starts/i);
    expect(ottoInstructions).toMatch(/charged only what it actually used/i);
    expect(ottoInstructions).toMatch(/rest goes back/i);
  });
});
