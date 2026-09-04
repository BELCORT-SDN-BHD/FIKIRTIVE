/**
 * 域层判据的单测(CREATE-A10 只读半)。
 *
 * 这里只证一件事:**判据是 `catalogKey`,不是名字**。剩下三层(DTO / UI / server action)
 * 各自的测试都从这个函数取真相,所以这个文件是那三份测试的地基。
 */
import { describe, expect, it } from "vitest";
import {
  OFFICIAL_CATALOG_REFUSAL,
  capabilitiesForOrigin,
  entityCapabilities,
  entityOrigin,
  type EntityCapabilities,
} from "./entity-policy.js";

const CAPABILITY_KEYS: readonly (keyof EntityCapabilities)[] = [
  "mutateBase",
  "createVariant",
  "regenerateVariant",
  "renameVariant",
  "deleteVariant",
  "editIdentity",
  "deleteEntity",
];

describe("CREATE-A10 官方演员只读 —— 域层判据", () => {
  it("CREATE-A10: catalogKey 非空 ⇒ OFFICIAL_CATALOG,能力表逐格 false", () => {
    const official = { catalogKey: "actor-v1-aisyah" };
    expect(entityOrigin(official)).toBe("OFFICIAL_CATALOG");
    const caps = entityCapabilities(official);
    for (const key of CAPABILITY_KEYS) expect(caps[key], String(key)).toBe(false);
    // 能力表没有第八格 —— 加动作必须回来开格,不能悄悄绕过。
    expect(Object.keys(caps).sort()).toEqual([...CAPABILITY_KEYS].sort());
  });

  it("CREATE-A10: catalogKey 为 null / undefined / 空串 ⇒ USER,能力表逐格 true", () => {
    for (const entity of [{ catalogKey: null }, {}, { catalogKey: "" }]) {
      expect(entityOrigin(entity), JSON.stringify(entity)).toBe("USER");
      const caps = entityCapabilities(entity);
      for (const key of CAPABILITY_KEYS) expect(caps[key], `${JSON.stringify(entity)}.${String(key)}`).toBe(true);
    }
  });

  it("CREATE-A10: 判据只看 catalogKey,不看名字 —— 商家自建的同名角色照旧可改", () => {
    // 商家完全可以自己建一个也叫 Aisyah 的角色。那是他自己的元素,他有权改。
    const merchantOwnAisyah = { catalogKey: null, name: "Aisyah" };
    expect(entityOrigin(merchantOwnAisyah)).toBe("USER");
    expect(entityCapabilities(merchantOwnAisyah).editIdentity).toBe(true);

    // 反过来:官方目录里的一行改了名字仍然是官方的。
    const renamedOfficial = { catalogKey: "actor-v1-aisyah", name: "Bob" };
    expect(entityOrigin(renamedOfficial)).toBe("OFFICIAL_CATALOG");
    expect(entityCapabilities(renamedOfficial).editIdentity).toBe(false);
  });

  it("CREATE-A10: capabilitiesForOrigin 与 entityCapabilities 同答案,且返回可变副本", () => {
    expect(capabilitiesForOrigin("OFFICIAL_CATALOG")).toEqual(entityCapabilities({ catalogKey: "actor-v1-weijie" }));
    expect(capabilitiesForOrigin("USER")).toEqual(entityCapabilities({ catalogKey: null }));
    // 调用方拿到的是副本:改它不会污染下一个调用方(共享常量被就地改掉 = 围栏静默失效)。
    const caps = capabilitiesForOrigin("OFFICIAL_CATALOG");
    caps.createVariant = true;
    expect(capabilitiesForOrigin("OFFICIAL_CATALOG").createVariant).toBe(false);
  });

  it("CREATE-A10: 拒绝原话只有一句,并且照 Founder 裁决说了「能用」这条出路", () => {
    expect(OFFICIAL_CATALOG_REFUSAL).toContain("Fikirtive");
    expect(OFFICIAL_CATALOG_REFUSAL.toLowerCase()).toContain("canvas");
    expect(OFFICIAL_CATALOG_REFUSAL.toLowerCase()).toContain("identity");
  });
});
