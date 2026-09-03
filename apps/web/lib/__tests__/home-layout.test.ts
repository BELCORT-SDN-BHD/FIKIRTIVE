/**
 * Home 版面定义层的行为(规格 docs/specs/frontend-baseline.md §7.3⑤;验收 FRONT-A4)。
 *
 * 这里钉的是**规则**,不是渲染:哪几块能出现、保存过的顺序怎么复原、以后逐个点亮的组件
 * 该落在哪。全是纯函数,所以每一条都能拿具体输入逐条证明,而不是靠眼睛看页面。
 */
import { describe, expect, it } from "vitest";

import {
  HOME_COMPONENT_PRODUCER,
  availableHomeComponents,
  homeLayoutWrite,
  isHomeComponentId,
  resolveHomeComponents,
} from "@/lib/home-layout";
import {
  HOME_COMPONENTS,
  HOME_TEMPLATES,
  type HomeComponentId,
} from "@/design-system/patterns/founder-home/model";

describe("FRONT-A4:Home 版面是一份服务端定义,客户端只渲染", () => {
  it("FRONT-A4:生产者表覆盖设计模型的每一块,一块都不许漏登记", () => {
    // 设计里加了一块、这里忘了表态,就会悄悄变成「不出现,而且没人说得出为什么」。
    const declared = new Set(Object.keys(HOME_COMPONENT_PRODUCER));
    for (const component of HOME_COMPONENTS) {
      expect(declared.has(component.id), `${component.id} 没在 HOME_COMPONENT_PRODUCER 里表态`).toBe(true);
    }
    expect(declared.size).toBe(HOME_COMPONENTS.length);
  });

  it("FRONT-A4:没有真实生产者的组件不出现,而且每一块都写得出不出现的理由", () => {
    const available = availableHomeComponents();
    // 今天生产上唯一有真数据源的一块 —— getAnalytics → marketingHealthFromAnalytics。
    expect(available).toEqual(["marketing-health"]);
    for (const component of HOME_COMPONENTS) {
      const reason = HOME_COMPONENT_PRODUCER[component.id];
      if (available.includes(component.id)) {
        expect(reason).toBeNull();
      } else {
        expect(typeof reason === "string" && reason.length > 0, `${component.id} 不出现却没写理由`).toBe(true);
      }
    }
  });

  it("FRONT-A4:没保存过就走该 business goal 的推荐模板(只留有生产者的那些)", () => {
    const available = new Set(availableHomeComponents());
    for (const goal of ["online-sales", "leads-bookings", "brand-awareness"] as const) {
      expect(resolveHomeComponents({ goal, saved: null })).toEqual(
        HOME_TEMPLATES[goal].filter((id) => available.has(id)),
      );
    }
  });

  it("FRONT-A4:保存过的顺序原样复原,取消勾选的那块不再出现", () => {
    expect(
      resolveHomeComponents({
        goal: "online-sales",
        saved: { componentIds: ["marketing-health"], hiddenIds: [] },
      }),
    ).toEqual(["marketing-health"]);

    // 明确取消勾选 = 一块都不剩。这不是「读不出来」,是商家自己的决定,要照办。
    expect(
      resolveHomeComponents({
        goal: "online-sales",
        saved: { componentIds: [], hiddenIds: ["marketing-health"] },
      }),
    ).toEqual([]);
  });

  it("FRONT-A4:以后才点亮的组件补到末尾出现,不会被当成「商家关掉过」", () => {
    // 保存那天面板只列过 marketing-health,所以 efficiency 既不在 componentIds 也不在
    // hiddenIds 里。等它有了生产者,它该出现,而不是永远消失。
    const resolved = resolveHomeComponents({
      goal: "online-sales",
      saved: { componentIds: ["marketing-health"], hiddenIds: [] },
    });
    expect(resolved).toEqual(["marketing-health"]);
    // 反过来:真被藏起来的那一块,推荐模板不许把它拉回来。
    expect(
      resolveHomeComponents({
        goal: "online-sales",
        saved: { componentIds: [], hiddenIds: ["marketing-health"] },
      }),
    ).not.toContain("marketing-health");
  });

  it("FRONT-A4:库里存着的未知 id、重复 id、没有生产者的 id 一律丢弃", () => {
    const resolved = resolveHomeComponents({
      goal: "online-sales",
      saved: {
        componentIds: [
          "marketing-health",
          "marketing-health", // 重复
          "retired-component", // 退役/改名的组件
          "efficiency", // 今天没有生产者
        ],
        hiddenIds: ["another-unknown"],
      },
    });
    expect(resolved).toEqual(["marketing-health"]);
  });

  it("FRONT-A4:isHomeComponentId 只认设计模型里声明过的 id", () => {
    expect(isHomeComponentId("marketing-health")).toBe(true);
    expect(isHomeComponentId("marketing-heath")).toBe(false);
    expect(isHomeComponentId(null)).toBe(false);
    expect(isHomeComponentId(42)).toBe(false);
  });
});

describe("FRONT-A4:Save 那一刻要落库的两列", () => {
  const offered = availableHomeComponents();

  it("FRONT-A4:勾着的进 componentIds,取消勾选的进 hiddenIds", () => {
    expect(homeLayoutWrite({ offered, selected: ["marketing-health"] })).toEqual({
      componentIds: ["marketing-health"],
      hiddenIds: [],
    });
    expect(homeLayoutWrite({ offered, selected: [] })).toEqual({
      componentIds: [],
      hiddenIds: ["marketing-health"],
    });
  });

  it("FRONT-A4:面板没列过的组件,两列都不进 —— 「没勾＝藏起来」只对看得见的那些成立", () => {
    // 客户端硬发一个面板从没列出来过的 id,服务端不许把它当成商家的意思。
    const write = homeLayoutWrite({
      offered,
      selected: ["marketing-health", "recommended-action" as HomeComponentId],
    });
    expect(write.componentIds).toEqual(["marketing-health"]);
    expect(write.hiddenIds).toEqual([]);
  });

  it("FRONT-A4:重复勾选只落一次,顺序按商家排的来", () => {
    expect(
      homeLayoutWrite({ offered, selected: ["marketing-health", "marketing-health"] }).componentIds,
    ).toEqual(["marketing-health"]);
  });
});
