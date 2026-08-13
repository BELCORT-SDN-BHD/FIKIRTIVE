/**
 * #775 —— 「改这条片子」与「把这条片子接下去」两个新动作的装配面。
 *
 * 两件事的全部要害都在措辞上:官方句式点名那条片子,并且**不许**出现 "reference" ——
 * 那个词会把任务读成「照着它做一条新的」,于是商家要的是改三个字,拿回来的是一条全新的片。
 */
import { describe, it, expect } from "vitest";
import { assembleSeedance, seedancePromptInput } from "./seedance-prompt.helpers.js";
import { seedancePromptSkill } from "./seedance-prompt.js";
import { VIDEO_CLIP_TOKEN, videoPromptWarnings } from "./video-capabilities.js";

const edit = (over: Record<string, unknown> = {}) =>
  seedancePromptInput.parse({
    mode: "edit",
    shots: [{ subject: "the shirt on the man", action: "is deep red instead of white" }],
    ...over,
  });

const extend = (over: Record<string, unknown> = {}) =>
  seedancePromptInput.parse({
    mode: "extend",
    shots: [{ subject: "the man", action: "walks out of the shop and waves" }],
    ...over,
  });

describe("剪辑(edit)—— 官方句式", () => {
  it("第一句就是官方的严格编辑句,并点名那条片子", () => {
    const out = assembleSeedance(edit());
    expect(out.split("\n")[0]).toBe(
      `Strictly edit ${VIDEO_CLIP_TOKEN}, and modify the shirt on the man, is deep red instead of white.`,
    );
  });

  it("紧接着一句「别的一律别动」—— 严格编辑的另一半", () => {
    expect(assembleSeedance(edit())).toContain("Keep every other part of the clip exactly as it is.");
  });

  it("不写 i2v 那两句 —— 这条路上没有首帧", () => {
    const out = assembleSeedance(edit());
    expect(out).not.toContain("starting from the given first frame");
    expect(out).not.toContain("keep the subject consistent with the source frame");
  });

  it("不带画质/风格开场白 —— 一条重新调色的指令会跟「严格编辑」当场打架", () => {
    const out = assembleSeedance(edit({ style: "cinematic" }));
    expect(out).not.toContain("cinematic quality, natural motion");
    expect(out.split("\n")[0]).toContain("Strictly edit");
  });

  it("给了 @元素也不写身份锁 —— 这一趟引擎收不到任何一张元素照,写了就是撒谎", () => {
    const out = assembleSeedance(edit({ references: [{ role: "character", name: "Mia", lock: true }] }));
    expect(out).not.toContain("reference");
    expect(out).not.toContain("Mia");
  });

  it("声音、约束、竖版防字幕照旧接线", () => {
    const out = assembleSeedance(
      edit({
        aspect: "9:16",
        constraints: "Keep the camera steady; Avoid sudden cuts",
        shots: [{ subject: "the shirt", action: "turns red", music: "soft guitar", sfx: "cloth rustle" }],
      }),
    );
    expect(out).toContain("Audio: （soft guitar） <cloth rustle>");
    expect(out).toContain("Keep the camera steady.");
    expect(out).toContain("Avoid sudden cuts.");
    expect(out).toContain("do not burn in any subtitles or captions");
  });
});

describe("续写(extend)—— 官方句式", () => {
  it("第一句是官方的延长句,默认往后接", () => {
    expect(assembleSeedance(extend()).split("\n")[0]).toBe(
      `Extend ${VIDEO_CLIP_TOKEN} forward, the man, walks out of the shop and waves.`,
    );
  });

  it("往前接也说得出来", () => {
    expect(assembleSeedance(extend({ extendDirection: "backward" })).split("\n")[0]).toContain(
      `Extend ${VIDEO_CLIP_TOKEN} backward,`,
    );
  });

  it("紧接着一句「接着同一批人、同一身衣服、同一个地方、同一种光」", () => {
    expect(assembleSeedance(extend())).toContain(
      "Continue the same characters, wardrobe, setting, and lighting.",
    );
  });

  it("同样不写 i2v 开场、不写身份锁、不出现 reference", () => {
    const out = assembleSeedance(extend({ references: [{ role: "product", name: "Sambal Nyonya" }] }));
    expect(out).not.toContain("starting from the given first frame");
    expect(out).not.toContain("reference");
    expect(out).not.toContain("Sambal Nyonya");
  });
});

describe("旧路一个字都没变", () => {
  it("i2v / t2v 的开场、身份锁、画质段照旧", () => {
    const i2v = assembleSeedance(
      seedancePromptInput.parse({
        shots: [{ subject: "the man", action: "turns to camera" }],
        references: [{ role: "character", name: "Mia", lock: true }],
        style: "documentary",
      }),
    );
    expect(i2v.split("\n")[0]).toBe("documentary, cinematic quality, natural motion, film-grade color, sharp focus");
    expect(i2v).toContain("starting from the given first frame,");
    expect(i2v).toContain("keep Mia identical to the reference");
  });
});

describe("一条片子只能有一个编号,因为付费请求只送得出一条片子", () => {
  it("装配结果里只可能出现 <Video_1>", () => {
    for (const input of [edit(), extend()]) {
      const out = assembleSeedance(input);
      expect(out).toContain("<Video_1>");
      expect(out).not.toContain("<Video_2>");
    }
  });
});

describe("剪辑/续写只接受一个 shot —— 一次严格编辑不是四个节拍", () => {
  it("两个 shot 的 edit 直接被 schema 拒绝", () => {
    const two = {
      mode: "edit",
      shots: [
        { subject: "the shirt", action: "turns red" },
        { subject: "the sky", action: "turns blue" },
      ],
    };
    expect(seedancePromptInput.safeParse(two).success).toBe(false);
    expect(seedancePromptInput.safeParse({ ...two, mode: "extend" }).success).toBe(false);
    // 旧路不受影响
    expect(seedancePromptInput.safeParse({ ...two, mode: "i2v" }).success).toBe(true);
  });
});

describe("禁词只提醒,不改写商家的话", () => {
  it("剪辑/续写的成品里混进 reference → 回一条提醒", () => {
    const warn = videoPromptWarnings("editClip", "Strictly edit <Video_1>, and modify the reference colour.");
    expect(warn.length).toBe(1);
    expect(warn[0]).toContain("reference");
  });

  it("干净的成品 → 一条都不回", () => {
    expect(videoPromptWarnings("editClip", assembleSeedance(edit()))).toEqual([]);
    expect(videoPromptWarnings("extendClip", assembleSeedance(extend()))).toEqual([]);
  });

  it("照着做一条新的那一档不禁这个词", () => {
    expect(videoPromptWarnings("guideFromClip", "match the reference clip's pacing")).toEqual([]);
  });
});

describe("skill 面 —— Otto 学不到这两件事,商家就永远用不上", () => {
  it("description 教会两个 mode 各自什么时候用", () => {
    const d = seedancePromptSkill.description;
    expect(d).toContain("mode:'edit'");
    expect(d).toContain("mode:'extend'");
    expect(d).toContain("Strictly edit");
    expect(d).toContain("Extend");
  });

  it("skill 把禁词提醒当 notes 交回,不改写 prompt", async () => {
    const invoke = seedancePromptSkill.tool as unknown as {
      invoke: (rc: unknown, a: string) => Promise<{ prompt: string; notes?: string[] }>;
    };
    const out = await invoke.invoke(
      { context: {} },
      JSON.stringify({ mode: "edit", shots: [{ subject: "the reference board", action: "turns red" }] }),
    );
    expect(out.prompt).toContain("the reference board");
    expect(out.notes?.some((n) => n.includes("reference"))).toBe(true);
  });
});
