/**
 * 商密围栏（otto 内侧补充；CI 的 check-provider-secrecy.mjs 只扫 apps/**）：
 * 装配出的 prompt 会原样渲染在用户可见的提案卡上（含 Copy 按钮），
 * 策略/能力/变体/清单表的字符串也可能进入 Otto 的用户回复 ——
 * 供应商与模型商号一个都不得出现。内部标识符（文件名/类型名/skill 名）不受此限。
 */
import { describe, it, expect } from "vitest";
import { assembleSeedance, seedancePromptInput } from "./seedance-prompt.helpers.js";
import { assembleSeedream, seedreamPromptInput } from "./seedream-prompt.helpers.js";
import { seedancePromptSkill } from "./seedance-prompt.js";
import { seedreamPromptSkill } from "./seedream-prompt.js";
import { STRATEGY_FAMILIES, DISTANT_PAIRS } from "./prompt-strategy.js";
import { VIDEO_CAPABILITIES } from "./video-capabilities.js";
import {
  ASSET_WHY,
  ASSET_HOW_TO_SUPPLY,
  MISSING_ASSET_WARNING,
  deriveAssetChecklist,
} from "./variant-policy.js";

// 与 scripts/ci/check-provider-secrecy.mjs 同源的词面（含 \bfal\b 防误伤 half/false）。
const FORBIDDEN = /(?:seedance|seedream|byteplus|bytedance|jimeng|即梦|\bfal\b)/iu;

const assembledSamples = (): string[] => [
  assembleSeedance(seedancePromptInput.parse({
    style: "纪实风，暖色调",
    pacing: "快节奏卡点剪辑, hard cut, 每拍约 0.5s",
    shots: [
      { subject: "老板娘", action: "0-2s: 舀起参巴酱", camera: "dolly in", sceneLight: "清晨侧光，暖色温", mood: "烟火气", audio: "油锅滋滋声" },
      { subject: "档口", action: "2-4s: 食客落座", camera: "fixed" },
    ],
    references: [
      { role: "character", name: "Boba仔", lock: true },
      { role: "product", name: "辣椒酱经典装", lock: true },
      { role: "location", name: "老店面", lock: true },
      { role: "brandmark", name: "AeroCo", lock: false },
    ],
    constraints: "画面中不出现：多余手指",
  })),
  assembleSeedance(seedancePromptInput.parse({ mode: "t2v", shots: [{ subject: "海浪", action: "涌上沙滩" }] })),
  assembleSeedance(seedancePromptInput.parse({ mode: "edit", editInstruction: "将 T 恤改为黄色" })),
  assembleSeedream(seedreamPromptInput.parse({
    subject: "a batik scarf",
    style: "editorial photography",
    lighting: "studio softbox at 45 degrees",
    textContent: "Raya Bersama",
    forVideo: true,
    references: [{ role: "product", name: "the scarf", lock: true }, { role: "character", name: "Mia", lock: false }],
  })),
  assembleSeedream(seedreamPromptInput.parse({ mode: "i2i", subject: "the source image", editVerb: "Replace", editTarget: "the background with a beach" })),
];

describe("no provider/model trade names in any user-visible surface", () => {
  it("assembled prompts (rendered verbatim on the proposal card) are clean", () => {
    for (const out of assembledSamples()) {
      expect(out).not.toMatch(FORBIDDEN);
    }
  });
  it("skill descriptions speak of 'the video engine' / 'the image engine' only", () => {
    expect(seedancePromptSkill.description).not.toMatch(FORBIDDEN);
    expect(seedreamPromptSkill.description).not.toMatch(FORBIDDEN);
    expect(seedancePromptSkill.description).toContain("the video engine");
    expect(seedreamPromptSkill.description).toContain("the image engine");
  });
  it("strategy tables (labels, signals, questions) are clean", () => {
    for (const f of STRATEGY_FAMILIES) {
      expect(f.label).not.toMatch(FORBIDDEN);
      for (const q of f.questions) expect(q).not.toMatch(FORBIDDEN);
      for (const kw of [...f.signals.en, ...f.signals.zh, ...f.signals.ms]) expect(kw).not.toMatch(FORBIDDEN);
    }
    for (const d of DISTANT_PAIRS) for (const q of d.questions) expect(q).not.toMatch(FORBIDDEN);
  });
  it("capability table (labels + hints) is clean", () => {
    for (const cap of VIDEO_CAPABILITIES) {
      expect(cap.labelZh).not.toMatch(FORBIDDEN);
      expect(cap.hintZh).not.toMatch(FORBIDDEN);
    }
  });
  it("asset-checklist strings are clean", () => {
    for (const why of Object.values(ASSET_WHY)) expect(why).not.toMatch(FORBIDDEN);
    expect(ASSET_HOW_TO_SUPPLY).not.toMatch(FORBIDDEN);
    expect(MISSING_ASSET_WARNING).not.toMatch(FORBIDDEN);
    for (const item of deriveAssetChecklist("ecommerce", [{ role: "product", name: "X", ready: false }])) {
      expect(item.why).not.toMatch(FORBIDDEN);
      expect(item.howToSupply ?? "").not.toMatch(FORBIDDEN);
    }
  });
});
