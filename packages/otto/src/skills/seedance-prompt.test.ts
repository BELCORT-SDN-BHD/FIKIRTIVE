import { describe, it, expect } from "vitest";
import {
  assembleSeedance,
  seedancePromptInput,
  seedanceTurnFacts,
  truthfulSeedanceMode,
  NO_START_FRAME_NOTE,
} from "./seedance-prompt.helpers.js";
import { seedancePromptSkill } from "./seedance-prompt.js";

describe("assembleSeedance", () => {
  const oneShot = (over = {}) => seedancePromptInput.parse({
    shots: [{ subject: "the man in the frame", action: "stops at the door, takes a deep breath", camera: "slow dolly in", ...over }],
  });

  it("i2v single shot opens with the first-frame phrase and has no Shot label", () => {
    const out = assembleSeedance(oneShot());
    expect(out).toContain("starting from the given first frame,");
    expect(out).not.toContain("Shot 1:");
  });
  it("emits NO technical flags", () => {
    const out = assembleSeedance(oneShot());
    expect(out).not.toContain("--resolution");
    expect(out).not.toContain("--duration");
    expect(out).not.toContain("--ratio");
  });
  it("i2v adds a subject-neutral consistency line (no face/outfit assumption)", () => {
    const out = assembleSeedance(oneShot());
    expect(out).toContain("keep the subject consistent with the source frame");
    expect(out).not.toContain("preserve face and outfit");
  });
  it("a character reference still yields face/hairstyle/build identity lock", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "the man in the frame", action: "turns to face the camera" }],
      references: [{ role: "character", name: "Mia", lock: true }],
    }));
    expect(out).toContain("same face, hairstyle, and build");
  });
  it("cleanFootage (default) appends the no-text/watermark/logo line", () => {
    expect(assembleSeedance(oneShot())).toContain("no on-screen text, watermark, or logo");
  });
  it("cleanFootage:false drops the negative line", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      cleanFootage: false, shots: [{ subject: "a logo sting", action: "the logo animates in" }],
    }));
    expect(out).not.toContain("no on-screen text");
  });
  it("audio goes on its own line", () => {
    const out = assembleSeedance(oneShot({ audio: "quiet room tone" }));
    expect(out).toContain("\nAudio: quiet room tone");
  });
  it("multi-shot labels each beat", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [
        { subject: "the car", action: "drifts around the bend" },
        { subject: "the driver", action: "smiles" },
      ],
    }));
    expect(out).toContain("Shot 1:");
    expect(out).toContain("Shot 2:");
  });
  // #782 旧路径退役:接续曾经只是 prompt 里的一句 "continuing from the previous frame,",
  // 而执行层从没把上一镜的末帧送进来 —— 一句说了但没做的话。真接续由分镜闸③ 完成(上一镜
  // 的真实末帧成为这一镜的首帧),所以这一镜本就是 i2v,开口句只剩「从给定首帧起步」这一条
  // 真话。这条测试钉的就是那句暗示**再也不会**出现在任何 prompt 里。
  it("退役的接续暗示句一个字都不再产出", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "the swordsman", action: "raises the blade" }],
    }));
    expect(out).not.toContain("continuing from the previous frame,");
    expect(out).toContain("starting from the given first frame,");
  });
  it("接续开关不再是这个 skill 的入参(输入契约里已无此格)", () => {
    expect("continuesFromPrev" in seedancePromptInput.shape).toBe(false);
  });
  it("references append an identity-lock clause", () => {
    const out = assembleSeedance(oneShot({}));
    const withRef = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "the mascot", action: "waves" }],
      references: [{ role: "character", name: "Otto the fox" }],
    }));
    expect(withRef).toContain("keep Otto the fox identical to the reference");
    expect(out).not.toContain("Otto the fox");
  });
  it("appends constraints when present, as an imperative sentence", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "a cat", action: "leaps" }], constraints: "no motion blur",
    }));
    expect(out).toContain("No motion blur.");
  });
  it("t2v (no source frame) does not reference a first frame", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      mode: "t2v",
      shots: [{ subject: "ocean waves", action: "roll onto the shore" }],
    }));
    expect(out).not.toContain("starting from the given first frame");
    expect(out).not.toContain("keep the subject consistent with the source frame");
  });
  it("a locked brandmark reference suppresses the clean-footage logo ban", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "the bottle", action: "spins slowly" }],
      references: [{ role: "brandmark", name: "the AeroCo logo", lock: true }],
    }));
    expect(out).not.toContain("no on-screen text, watermark, or logo");
    expect(out).toContain("reproduce the");
  });
  it("a brandmark reference with lock:false still gets the clean-footage logo ban", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "the bottle", action: "spins slowly" }],
      references: [{ role: "brandmark", name: "the AeroCo logo", lock: false }],
    }));
    expect(out).toContain("no on-screen text, watermark, or logo");
  });

  // ── #774 U3 三件要件 ──────────────────────────────────────────────────────
  describe("#774 U3 — the three required parts", () => {
    it("① a quality line opens the prompt, before any shot", () => {
      const out = assembleSeedance(oneShot());
      expect(out.split("\n")[0]).toBe("cinematic quality, natural motion, film-grade color, sharp focus");
    });
    it("① a merchant style rides in front of the quality line, not instead of it", () => {
      const out = assembleSeedance(seedancePromptInput.parse({
        style: "documentary", shots: [{ subject: "a cat", action: "leaps" }],
      }));
      expect(out.split("\n")[0]).toBe("documentary, cinematic quality, natural motion, film-grade color, sharp focus");
    });
    it("② constraints become one imperative sentence per line", () => {
      const out = assembleSeedance(seedancePromptInput.parse({
        shots: [{ subject: "a cat", action: "leaps" }],
        constraints: "keep the camera steady; avoid distorted paws\ndo not add other animals",
      }));
      const lines = out.split("\n");
      expect(lines).toContain("Keep the camera steady.");
      expect(lines).toContain("Avoid distorted paws.");
      expect(lines).toContain("Do not add other animals.");
    });
    it("② a constraint that already ends in a full stop is not double-punctuated", () => {
      const out = assembleSeedance(seedancePromptInput.parse({
        shots: [{ subject: "a cat", action: "leaps" }], constraints: "Keep the camera steady.",
      }));
      expect(out).toContain("Keep the camera steady.");
      expect(out).not.toContain("steady..");
    });
    it("③ sound uses the official marks — music（）, sfx <>, dialogue {}", () => {
      const out = assembleSeedance(seedancePromptInput.parse({
        shots: [{
          subject: "the barista", action: "slides the cup across the counter",
          music: "warm acoustic guitar", sfx: "cup on wood", dialogue: "One flat white, ready.",
        }],
      }));
      expect(out).toContain("Audio: （warm acoustic guitar） <cup on wood> {One flat white, ready.}");
    });
    it("③ the subtitle mark 【】 is never written as a request", () => {
      const out = assembleSeedance(seedancePromptInput.parse({
        shots: [{ subject: "the barista", action: "smiles", dialogue: "Enjoy." }],
      }));
      expect(out).toContain("{Enjoy.}");
      expect(out).not.toContain("【");
    });
    it("③ structured sound and free-text audio can coexist, structured first", () => {
      const out = assembleSeedance(seedancePromptInput.parse({
        shots: [{ subject: "a cat", action: "leaps", music: "soft piano", audio: "quiet room tone" }],
      }));
      expect(out).toContain("Audio: （soft piano） quiet room tone");
    });
    it("③ an emotion is externalised into what the camera can see", () => {
      const out = assembleSeedance(seedancePromptInput.parse({
        shots: [{ subject: "the customer", action: "opens the box", emotion: "happy" }],
      }));
      expect(out).toContain("the corners of the mouth lift, the eyes soften, the steps turn light");
      expect(out).not.toContain(", happy,");
    });
    it("③ an emotion outside the table is carried through, never guessed at", () => {
      const out = assembleSeedance(seedancePromptInput.parse({
        shots: [{ subject: "the customer", action: "opens the box", emotion: "wistful" }],
      }));
      expect(out).toContain("wistful");
    });
    it("③ the emotion sits with the action, ahead of camera and light", () => {
      const out = assembleSeedance(seedancePromptInput.parse({
        shots: [{ subject: "the customer", action: "opens the box", emotion: "excited", camera: "slow dolly in", sceneLight: "warm window light" }],
      }));
      expect(out.indexOf("bounce in the step")).toBeLessThan(out.indexOf("slow dolly in"));
    });
  });

  // ── #774 U4 竖版防字幕 ────────────────────────────────────────────────────
  describe("#774 U4 — vertical clips get the reinforced caption ban", () => {
    const portraitOut = (over = {}) => assembleSeedance(seedancePromptInput.parse({
      aspect: "9:16", shots: [{ subject: "the bottle", action: "spins slowly" }], ...over,
    }));
    it("9:16 adds the reinforced ban on top of the base clean-footage line", () => {
      const out = portraitOut();
      expect(out).toContain("no on-screen text, watermark, or logo");
      expect(out).toContain("this is a vertical clip — do not burn in any subtitles or captions, and never render a 【】 caption bar");
    });
    it("'portrait' / 'vertical' / '9x16' are the same shape", () => {
      for (const a of ["portrait", "vertical", "9x16", "9 : 16", "4:5"]) {
        expect(portraitOut({ aspect: a })).toContain("this is a vertical clip");
      }
    });
    it("16:9, 1:1, 21:9 and no aspect stay as they were", () => {
      for (const a of ["16:9", "1:1", "21:9", undefined]) {
        expect(portraitOut({ aspect: a })).not.toContain("this is a vertical clip");
      }
    });
    it("an unrecognised shape is never guessed into vertical", () => {
      expect(portraitOut({ aspect: "adaptive" })).not.toContain("this is a vertical clip");
    });
    it("cleanFootage:false — the user wants text on screen, so nothing is banned", () => {
      expect(portraitOut({ cleanFootage: false })).not.toContain("this is a vertical clip");
    });
    it("a locked brandmark keeps the logo but still bans captions", () => {
      const out = portraitOut({ references: [{ role: "brandmark", name: "the AeroCo logo", lock: true }] });
      expect(out).not.toContain("no on-screen text, watermark, or logo");
      expect(out).toContain("this is a vertical clip — keep the brand mark, but do not burn in any subtitles or captions");
    });
  });

  // ── #774 U2 —— 视频侧刻意**不**编号 ────────────────────────────────────────
  // 元素参考照到不了视频引擎（gen.ts:636-644 的 generateVideo 只吃 imageUrl /
  // tailImageUrl / refVideoUrl；reference-budget.ts 对同一件事记了同样一笔）。
  // 写一个引擎根本没收到的 <Image_2>，就是把编号从「有用」变成「说谎」。
  it("#774 U2 — a video prompt never numbers reference images (the engine gets none)", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "the mascot", action: "waves" }],
      references: [
        { role: "character", name: "Otto the fox" },
        { role: "product", name: "the AeroBottle" },
      ],
    }));
    expect(out).not.toContain("<Image_");
    expect(out).not.toContain("<Subject_");
    // 措辞锁照旧在（身份的真凭据是首帧，不是编号）。
    expect(out).toContain("keep Otto the fox identical to the reference");
  });

  it("#774 — the first-frame phrase no longer double-commas into the shot", () => {
    const out = assembleSeedance(oneShot());
    expect(out).not.toContain(",,");
    expect(out).toContain("starting from the given first frame, the man in the frame");
  });

  // ── R3-F26 —— 「这一趟有没有首帧」是服务端的事实,不是模型的声明 ──────────────
  it("R3-F26:拿到「这一轮没有首帧」这个事实时,i2v 档产出与照实声明的 t2v **逐字相同**", () => {
    const shots = [{ subject: "the bottle", action: "turns slowly on the table" }];
    const refs = [{ role: "product" as const, name: "the AeroBottle" }];
    const declaredI2V = seedancePromptInput.parse({ mode: "i2v", shots, references: refs });
    const honestT2V = seedancePromptInput.parse({ mode: "t2v", shots, references: refs });
    // 没有新措辞被发明出来 —— 降档就是「照实说的那一档」本来会产出的那段字。
    expect(assembleSeedance(declaredI2V, { hasStartFrame: false })).toBe(assembleSeedance(honestT2V));
  });

  it("R3-F26:真有首帧时,两句首帧话原样保留(防过度删除)", () => {
    const out = assembleSeedance(oneShot(), { hasStartFrame: true });
    expect(out).toContain("starting from the given first frame,");
    expect(out).toContain("keep the subject consistent with the source frame");
  });
});

describe("seedancePromptSkill gate", () => {
  it("free/read/internal → not gated, no requires", () => {
    expect(seedancePromptSkill.cost).toBe("free");
    expect(seedancePromptSkill.effect).toBe("read");
    expect(seedancePromptSkill.needsApproval).toBe(false);
    expect(seedancePromptSkill.requires).toEqual([]);
  });
  it("built tool returns { prompt } from assembly", async () => {
    const invoke = seedancePromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<unknown> };
    const out = await invoke.invoke({ context: {} }, JSON.stringify({ shots: [{ subject: "a cat", action: "leaps" }] })) as { prompt: string };
    expect(typeof out.prompt).toBe("string");
    expect(out.prompt).toContain("a cat");
  });
  it("description carries concrete camera/shot/lighting vocabulary, English only", () => {
    expect(seedancePromptSkill.description).toContain("dolly in");
    expect(seedancePromptSkill.description).toContain("golden hour");
    expect(seedancePromptSkill.description).not.toContain("推镜头");
  });
  // #774 —— 三件要件与画幅接线的教学面：Otto 学不到，装配层就永远收不到这些字段。
  it("description teaches the emotion table, the sound fields and imperative constraints", () => {
    const d = seedancePromptSkill.description;
    expect(d).toContain("Never write a feeling word alone");
    expect(d).toContain("the corners of the mouth lift");
    expect(d).toContain("pass `music`, `sfx`, and `dialogue` as SEPARATE fields");
    expect(d).toContain("Never ask for subtitles.");
    expect(d).toContain("write each one as a COMMAND and separate them with a semicolon");
    expect(d).toContain("Keep the camera steady.");
  });
  it("description ties `aspect` to propose's desiredAspect", () => {
    expect(seedancePromptSkill.description).toContain("SAME shape you will pass to propose's desiredAspect");
  });
  it("advisory notes are returned, never enforced", async () => {
    const invoke = seedancePromptSkill.tool as unknown as { invoke: (rc: unknown, a: string) => Promise<{ prompt: string; notes?: string[] }> };
    const many = Array.from({ length: 6 }, (_, n) => ({ role: "character", name: `P${n}` }));
    const out = await invoke.invoke({ context: {} }, JSON.stringify({
      shots: [{ subject: "the crew", action: "turn to camera" }], references: many,
    }));
    expect(out.notes?.length).toBeGreaterThan(0);
    for (let n = 0; n < 6; n++) expect(out.prompt).toContain(`P${n}`);
    expect(seedancePromptSkill.description).toContain("they are advice, never a limit");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R3-F26(P2,钱路诚实;staging c0d25917,2026-09-17)
//
// GenJob 01M2PV9ZBN5ZQXN5GRY1PQN64C:`sourceGenerationId` / `tailGenerationId` /
// `referenceVideoGenerationId` 三格全 NULL、零 RefGenJob —— 一张首帧都没有。可
// `GenJob.prompt`(真送到付费引擎的那一份)与 `Generation.promptText`(卡面与素材库
// 让商家读的那一份)里都写着「starting from the given first frame」与「keep the
// subject consistent with the source frame」。商家的输入只有两个 @元素(一个产品
// 1 张参考照、一个角色 2 张)加一句话。
//
// 我们花钱请引擎去照顾一张不存在的首帧,而卡上那段字与真发生的事对不上 ——
// 规格 :34/:76(sentPromptText ＝商家批准的那一份逐字)与 :66 CREATE-A2(素材的角色
// 指派句必须与真实角色一致)两条一起被违反。
// ═══════════════════════════════════════════════════════════════════════════
describe("R3-F26 —— 没有首帧的那一趟,提示词不许说「从给定首帧开始」", () => {
  type SkillOut = { prompt: string; notes?: string[] };
  const invoke = (ctx: unknown, input: unknown): Promise<SkillOut> =>
    (seedancePromptSkill.tool as unknown as {
      invoke: (rc: unknown, a: string) => Promise<SkillOut>;
    }).invoke({ context: ctx }, JSON.stringify(input));

  /** 走查现场那一趟:一句话 + 两个 @元素,这一轮一张图都没挂。 */
  const textAsk = {
    shots: [{ subject: "the bottle", action: "turns slowly on the table" }],
    references: [
      { role: "product", name: "the AeroBottle" },
      { role: "character", name: "Xinyi" },
    ],
  };
  const liveTurn = { orgId: "org_1", userId: "org_1", projectId: "proj_1", threadId: "thr_1" };

  it("(a) 一张图都没挂 ⇒ 首帧那两句一句都不出现(模型漏传 mode,默认那一档)", async () => {
    const out = await invoke(liveTurn, textAsk);
    expect(out.prompt).not.toContain("first frame");
    expect(out.prompt).not.toContain("source frame");
  });

  it("(a) 元素参考照照旧按「身份/相似」说清楚 —— 它们真会作参考照上车", async () => {
    const out = await invoke(liveTurn, textAsk);
    expect(out.prompt).toContain("keep Xinyi identical to the reference");
    expect(out.prompt).toContain("feature the AeroBottle exactly as in the reference");
  });

  it("(a) 模型显式写 mode:'i2v' 也一样 —— 声明不是证据", async () => {
    const out = await invoke(liveTurn, { ...textAsk, mode: "i2v" });
    expect(out.prompt).not.toMatch(/first frame|source frame/);
  });

  it("(a) 降档时 Otto 手上拿到一条照实说的 note,叙述没有第二个版本可写", async () => {
    const out = await invoke(liveTurn, { ...textAsk, mode: "i2v" });
    expect(out.notes ?? []).toContain(NO_START_FRAME_NOTE);
  });

  it("(b) 真把一张图当首帧(「Animate this result」)⇒ 两句首帧话原样保留", async () => {
    const out = await invoke(
      { ...liveTurn, sourceGenerationId: "gen_1", sourceGenerationIds: ["gen_1"] },
      { shots: [{ subject: "the man in the frame", action: "turns to the camera" }] },
    );
    expect(out.prompt).toContain("starting from the given first frame,");
    expect(out.prompt).toContain("keep the subject consistent with the source frame");
    expect(out.notes ?? []).not.toContain(NO_START_FRAME_NOTE);
  });

  it("(b) 挂了图却同时 @ 了演员 ⇒ 挂图作参考照(FC-4 同一条判据),首帧话不出现", async () => {
    const out = await invoke(
      {
        ...liveTurn,
        sourceGenerationIds: ["gen_1"],
        // 服务端这一趟真解析出来的 @元素,与它在这家店里的族别 —— 与铸卡那一侧同一份事实。
        turnEntityIds: ["ent_xinyi"],
        availableRefs: [{ id: "ent_xinyi", name: "Xinyi", type: "CHARACTER" }],
      },
      {
        shots: [{ subject: "Xinyi", action: "holds up the bottle" }],
        references: [{ role: "character", name: "Xinyi" }],
      },
    );
    expect(out.prompt).not.toMatch(/first frame|source frame/);
  });

  // ── PR #1466 跨厂复审 P2 —— 反方向:模型多报一个「演员」,不许夺走一张真首帧 ────────
  // 上一版这道闸数的是**模型**在 `references` 里自己写的 `role:"character"`,而卡面与
  // worker 数的是**服务端核过归属**的 CHARACTER 元素。同一件事两个证人,于是画布上
  // 「Animate this result」+ 模型把画面里的人写成一个 character 参考,提示词被降成 t2v、
  // 两句首帧话被删,卡上却写着 Starting frame、`GenJob.sourceGenerationId` 也真有值 ——
  // 这条修改自己造出来的一次新的分家。判据改回单一来源之后,这里必须逐字保留。
  it("(b) 模型多报一个 character、服务端一个 @演员都没有 ⇒ 首帧话原样保留、不发 note", async () => {
    const out = await invoke(
      {
        ...liveTurn,
        sourceGenerationId: "gen_1",
        sourceGenerationIds: ["gen_1"],
        turnEntityIds: [],
        availableRefs: [{ id: "ent_xinyi", name: "Xinyi", type: "CHARACTER" }],
      },
      {
        shots: [{ subject: "the woman in the frame", action: "turns to the camera" }],
        // 模型把画面里的人当成一个身份锁来写 —— 它不是一个 @ 到的元素。
        references: [{ role: "character", name: "the woman in the frame" }],
      },
    );
    expect(out.prompt).toContain("starting from the given first frame,");
    expect(out.prompt).toContain("keep the subject consistent with the source frame");
    expect(out.notes ?? []).not.toContain(NO_START_FRAME_NOTE);
  });

  it("(b) 演员的族别只认服务端那一份:@ 到的是产品,不是演员 ⇒ 首帧照旧", async () => {
    const out = await invoke(
      {
        ...liveTurn,
        sourceGenerationIds: ["gen_1"],
        turnEntityIds: ["ent_bottle"],
        availableRefs: [{ id: "ent_bottle", name: "the AeroBottle", type: "PRODUCT" }],
      },
      {
        shots: [{ subject: "the bottle", action: "turns slowly" }],
        references: [{ role: "character", name: "the woman in the frame" }],
      },
    );
    expect(out.prompt).toContain("starting from the given first frame,");
  });

  it("判据只有一份 —— 与卡面、worker 读的是同一个 `videoAttachmentRole`", () => {
    const noImage = seedanceTurnFacts({ ...liveTurn, sourceGenerationIds: [] });
    const oneImage = seedanceTurnFacts({ ...liveTurn, sourceGenerationIds: ["gen_1"] });
    expect(truthfulSeedanceMode("i2v", noImage)).toBe("t2v");
    expect(truthfulSeedanceMode("i2v", oneImage)).toBe("i2v");
    // 分镜铸卡那一档:挂图一律作参考随行(FSE-208),首帧那一档对它不存在。
    expect(
      truthfulSeedanceMode(
        "i2v",
        seedanceTurnFacts({ ...liveTurn, sourceGenerationIds: ["gen_1"], alwaysVideoReference: true }),
      ),
    ).toBe("t2v");
    // 整段参考片那一档也没有首帧。
    expect(
      truthfulSeedanceMode(
        "i2v",
        seedanceTurnFacts({ ...liveTurn, sourceGenerationIds: ["gen_1"], referenceVideoGenerationId: "gen_v" }),
      ),
    ).toBe("t2v");
  });

  it("演员这一格只读服务端两样东西(解析出来的 id + 按 owner 读到的族别)", () => {
    const withCast = seedanceTurnFacts({
      ...liveTurn,
      sourceGenerationIds: ["gen_1"],
      turnEntityIds: ["ent_xinyi"],
      availableRefs: [{ id: "ent_xinyi", name: "Xinyi", type: "CHARACTER" }],
    });
    expect(withCast.hasStartFrame).toBe(false);
    // 同一个 id,族别是服务端说了算:产品不是演员。
    const withProduct = seedanceTurnFacts({
      ...liveTurn,
      sourceGenerationIds: ["gen_1"],
      turnEntityIds: ["ent_bottle"],
      availableRefs: [{ id: "ent_bottle", name: "the AeroBottle", type: "PRODUCT" }],
    });
    expect(withProduct.hasStartFrame).toBe(true);
    // 别家店的 id 在这张按 owner 读出来的名单里查不到 ⇒ 数不进来(归属闸)。
    const foreign = seedanceTurnFacts({
      ...liveTurn,
      sourceGenerationIds: ["gen_1"],
      turnEntityIds: ["ent_other_shop"],
      availableRefs: [{ id: "ent_xinyi", name: "Xinyi", type: "CHARACTER" }],
    });
    expect(foreign.hasStartFrame).toBe(true);
  });

  // 具名登记的窄缺口(规格 §5:195):演员一张参考图都没有时不在 @ 候选名单里,族别查不到,
  // 于是这道闸比铸卡侧宽一格 —— 提示词留着首帧话、卡上写 Reference。这是主干原有的老缺口
  // (与 staging 那一单同一种谎,范围窄得多),不是这条修改带来的。钉在这里,免得它被
  // 读成「已经关掉了」。
  it("已登记缺口:演员没有任何参考图 ⇒ 这道闸数不到它(与铸卡侧仍可能不一致)", () => {
    const facts = seedanceTurnFacts({
      ...liveTurn,
      sourceGenerationIds: ["gen_1"],
      turnEntityIds: ["ent_no_photo"],
      availableRefs: [],
    });
    expect(facts.hasStartFrame).toBe(true);
  });

  it("锚在片子上的两档与首帧无关,一格不动", () => {
    expect(truthfulSeedanceMode("edit", { hasStartFrame: false })).toBe("edit");
    expect(truthfulSeedanceMode("extend", { hasStartFrame: false })).toBe("extend");
  });

  it("读不到服务端事实(ctx 缺席)⇒ 逐字维持模型声明的那一档", () => {
    expect(truthfulSeedanceMode("i2v", seedanceTurnFacts(undefined))).toBe("i2v");
  });
});
