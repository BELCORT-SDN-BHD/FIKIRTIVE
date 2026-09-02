/**
 * actor-library.test.ts —— 演员库 v1 的名单、原件与九套 preset 是不是同一份真相。
 *
 * 这个文件钉三件事,三件都属于 CREATE-A10(规格 `docs/specs/creation-engine.md` 验收表):
 *
 *   ① **像素完整性的钉子还钉在原件上**。人物卡上写死的 sha256 必须等于仓库里那份
 *      `.bin` 的真实 sha256。血统信任的标记在像素里 —— 同一张图裁剪之后就被供应商拒收
 *      「may contain real person」(2026-08-30 实证),所以任何人「顺手压一压」原件、
 *      或者改了钉子而忘了换图,都必须在这里当场断,而不是等商家出片失败。
 *
 *   ② **本模块与归档凭据逐字对住**。`assets/actor-library/v1/*-card.json` 是定妆那一次
 *      真正用过的卡(归档),本模块是权威(代码读它)。两份内容必须完全一致 —— 否则
 *      「这张图是照这张卡生成的」这句话就断了,而那正是新增演员两两互认 QC 的前提。
 *
 *   ③ **九套 preset 的两轴交叉真的会按人物卡适配**。preset 定意图、细节按卡走
 *      (Founder 2026-08-30):Aisyah 一律 hijab 友好 modest 版,节庆装按族裔各穿各的。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTOR_LIBRARY,
  ACTOR_LIBRARY_ASSET_DIR,
  ACTOR_CATALOG_VERSION,
  WARDROBE_PRESETS,
  WARDROBE_PRESET_KEYS,
  actorPresetBlocks,
  findActorByCatalogKey,
  isWardrobePresetKey,
  wardrobePreset,
  wardrobePromptFor,
} from "./actor-library.js";

/** 仓库根 —— 本文件在 packages/core/src/,往上三层。 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ASSET_DIR = path.join(REPO_ROOT, ACTOR_LIBRARY_ASSET_DIR);

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(path.join(ASSET_DIR, file))).digest("hex");
}

describe("CREATE-A10 —— 演员库五人:名单本身", () => {
  it("创始五名即全量(Founder 2026-08-30 把「首发 50 名」改裁为此)", () => {
    expect(ACTOR_LIBRARY).toHaveLength(5);
    expect(ACTOR_LIBRARY.map((a) => a.name)).toEqual(["Aisyah", "Weijie", "Arjun", "Rahman", "Xinyi"]);
  });

  it("catalogKey 各不相同,并且带版本前缀 —— 幂等播种认的就是这一格", () => {
    const keys = ACTOR_LIBRARY.map((a) => a.catalogKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key.startsWith(`actor-${ACTOR_CATALOG_VERSION}-`)).toBe(true);
    // 反查得回来 —— 播种脚本与商家面都靠它把一行实体认回一位演员。
    for (const actor of ACTOR_LIBRARY) expect(findActorByCatalogKey(actor.catalogKey)).toBe(actor);
    expect(findActorByCatalogKey("actor-v1-nobody")).toBeNull();
  });

  it("每人恰好一对定妆图:特写 + 全身,视角标签各就各位", () => {
    for (const actor of ACTOR_LIBRARY) {
      expect(actor.closeup.viewTag).toBe("closeup");
      expect(actor.fullbody.viewTag).toBe("fullbody");
      // 字节是 JPEG,`.bin` 只是归档时的保护色 —— 入库一律按 jpg 落键。
      expect(actor.closeup.ext).toBe("jpg");
      expect(actor.fullbody.ext).toBe("jpg");
      expect(actor.closeup.file).toBe(`${actor.assetPrefix}-closeup.bin`);
      expect(actor.fullbody.file).toBe(`${actor.assetPrefix}-fullbody.bin`);
    }
  });
});

describe("CREATE-A10 —— 像素完整性:钉子必须钉在真的原件上", () => {
  it("人物卡写死的 sha256 逐张等于仓库里 .bin 的真实 sha256", () => {
    // 这一条同时证明两件事:①原件在仓库里(读不到就抛);②它一个字节都没被动过。
    // 播种时 `readActorImage` 用同一颗钉子再核一遍,所以「入库的就是这些字节」是
    // 一条从仓库一直连到 storage 键的链,不是一句声明。
    for (const actor of ACTOR_LIBRARY) {
      expect(sha256Of(actor.closeup.file), `${actor.name} closeup`).toBe(actor.closeup.sha256);
      expect(sha256Of(actor.fullbody.file), `${actor.name} fullbody`).toBe(actor.fullbody.sha256);
    }
  });

  it("十张图两两不同 —— 同一串 sha256 出现两次就说明有人拷错了文件", () => {
    const hashes = ACTOR_LIBRARY.flatMap((a) => [a.closeup.sha256, a.fullbody.sha256]);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("每张 .bin 的头两个字节是 JPEG 的 SOI —— 存进去的确实是原始 JPEG,不是被转过格式的东西", () => {
    for (const actor of ACTOR_LIBRARY) {
      for (const image of [actor.closeup, actor.fullbody]) {
        const head = readFileSync(path.join(ASSET_DIR, image.file)).subarray(0, 2);
        expect([head[0], head[1]], image.file).toEqual([0xff, 0xd8]);
      }
    }
  });
});

describe("CREATE-A10 —— 名单与归档凭据逐字对住", () => {
  it("每位演员的六格与 assets/actor-library/v1/*-card.json 完全一致", () => {
    for (const actor of ACTOR_LIBRARY) {
      const archived = JSON.parse(
        readFileSync(path.join(ASSET_DIR, `${actor.assetPrefix}-card.json`), "utf8"),
      ) as Record<string, string>;
      expect(actor.identity, `${actor.name} ID`).toBe(archived.ID);
      expect(actor.face, `${actor.name} FACE`).toBe(archived.FACE);
      expect(actor.hair, `${actor.name} HAIR`).toBe(archived.HAIR);
      expect(String(actor.heightCm), `${actor.name} H`).toBe(archived.H);
      expect(actor.build, `${actor.name} BUILD`).toBe(archived.BUILD);
      expect(actor.wardrobe, `${actor.name} WARDROBE`).toBe(archived.WARDROBE);
    }
  });

  it("定妆提示词原件里逐字含着这张卡 —— 「这对图是照这张卡生成的」有据可查", () => {
    for (const actor of ACTOR_LIBRARY) {
      const prompt = readFileSync(path.join(ASSET_DIR, `${actor.assetPrefix}-prompt.txt`), "utf8");
      for (const field of [actor.identity, actor.face, actor.hair, actor.build, actor.wardrobe]) {
        expect(prompt, `${actor.name}: 定妆提示词里找不到「${field.slice(0, 24)}…」`).toContain(field);
      }
    }
  });
});

describe("CREATE-A10 —— 九套造型 preset(Founder 2026-08-30「就先这九套」)", () => {
  it("恰好九套,顺序即规格 §5 那一行的 ①–⑨", () => {
    expect(WARDROBE_PRESET_KEYS).toEqual([
      "plain", "streetwear", "chef", "storefront", "business", "clinical", "salon", "gym", "festive",
    ]);
    expect(WARDROBE_PRESETS).toHaveLength(9);
  });

  it("每套都有商家读得懂的名字与用途,且全是 English sentence case", () => {
    for (const preset of WARDROBE_PRESETS) {
      expect(preset.label.length, preset.key).toBeGreaterThan(0);
      expect(preset.useCase.length, preset.key).toBeGreaterThan(0);
      // sentence case:首字母大写,后面不许出现 Title Case 的连串大写词。
      expect(preset.label[0], preset.key).toBe(preset.label[0]!.toUpperCase());
      expect(preset.label.slice(1), preset.key).toBe(preset.label.slice(1).toLowerCase());
    }
  });

  it("isWardrobePresetKey 只认这九个字符串", () => {
    for (const key of WARDROBE_PRESET_KEYS) expect(isWardrobePresetKey(key)).toBe(true);
    for (const junk of ["", "PLAIN", "chef ", "pirate", null, undefined]) {
      expect(isWardrobePresetKey(junk)).toBe(false);
    }
  });

  it("两轴交叉:任何演员 × 任何 preset 都得出一段非空英文块", () => {
    for (const actor of ACTOR_LIBRARY) {
      const blocks = actorPresetBlocks(actor);
      expect(Object.keys(blocks).sort()).toEqual([...WARDROBE_PRESET_KEYS].sort());
      for (const key of WARDROBE_PRESET_KEYS) {
        expect(blocks[key].trim().length, `${actor.name}/${key}`).toBeGreaterThan(0);
        expect(blocks[key], `${actor.name}/${key}`).toBe(wardrobePromptFor(actor, key));
      }
    }
  });

  it("素装 = 人物卡自己的 WARDROBE,定妆原样", () => {
    for (const actor of ACTOR_LIBRARY) {
      expect(wardrobePromptFor(actor, "plain")).toBe(`wearing ${actor.wardrobe}`);
    }
    expect(wardrobePreset("plain").prompt).toBeNull();
  });

  it("Aisyah 一律取 hijab 友好的 modest 版,厨师装也不动头巾", () => {
    const aisyah = findActorByCatalogKey("actor-v1-aisyah")!;
    expect(aisyah.modest).toBe(true);
    // 七套有分版的 preset,Aisyah 拿到的必须**不是**通用版。
    for (const key of ["streetwear", "chef", "storefront", "business", "clinical", "salon", "gym"] as const) {
      const preset = wardrobePreset(key);
      expect(preset.modestPrompt, `${key} 少了 modest 版`).not.toBeNull();
      expect(wardrobePromptFor(aisyah, key), key).toBe(preset.modestPrompt);
      expect(wardrobePromptFor(aisyah, key), key).not.toBe(preset.prompt);
      // 意图不变、覆盖度改:每一段都明写头巾照参考图不动。
      expect(wardrobePromptFor(aisyah, key), key).toContain("hijab exactly as in the reference");
    }
    // 厨师装那一套还额外要求不戴厨师帽(帽子会顶掉头巾 = 换脸风险)。
    expect(wardrobePromptFor(aisyah, "chef")).toContain("no chef hat");
  });

  it("其余四位取通用版 —— modest 是人物卡的属性,不是全库的默认", () => {
    for (const actor of ACTOR_LIBRARY.filter((a) => !a.modest)) {
      for (const key of ["streetwear", "chef", "business"] as const) {
        expect(wardrobePromptFor(actor, key), `${actor.name}/${key}`).toBe(wardrobePreset(key).prompt);
      }
    }
  });

  it("节庆传统装按族裔各穿各的 —— Raya / CNY / Deepavali 三种都在,五段互不相同", () => {
    const festive = ACTOR_LIBRARY.map((a) => wardrobePromptFor(a, "festive"));
    expect(new Set(festive).size).toBe(5);
    const all = festive.join("\n");
    expect(all).toContain("baju kurung"); // Aisyah — Raya
    expect(all).toContain("baju melayu"); // Rahman — Raya
    expect(all).toContain("qipao"); // Xinyi — CNY
    expect(all).toContain("Chinese New Year"); // Weijie — CNY
    expect(all).toContain("kurta"); // Arjun — Deepavali
    // 戴头巾的那位,节庆装同样不换头巾。
    expect(wardrobePromptFor(findActorByCatalogKey("actor-v1-aisyah")!, "festive"))
      .toContain("hijab exactly as in the reference");
  });

  it("换装只发生在提示词里 —— 九套里没有任何一套要求重新生成或再处理图片", () => {
    // 零新图零重铸(Founder 2026-08-30):preset 是 prompt 层的 wardrobe 块。
    // 出现「crop / resize / edit the reference」这类词就说明有人把换装做成了图像处理,
    // 而那条路已被实证会被供应商拒收(像素完整性铁律)。
    const forbidden = /\b(crop|cropped|resize|resized|upscal|retouch|edit the reference|photoshop)\w*/i;
    for (const actor of ACTOR_LIBRARY) {
      for (const [key, block] of Object.entries(actorPresetBlocks(actor))) {
        expect(block, `${actor.name}/${key}`).not.toMatch(forbidden);
      }
    }
  });
});
