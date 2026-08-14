/**
 * #775 —— 「改这条片子」与「把这条片子接下去」两个新动作的装配面。
 *
 * 两件事的全部要害都在措辞上:官方句式点名那条片子,并且**不许**出现 "reference" ——
 * 那个词会把任务读成「照着它做一条新的」,于是商家要的是改三个字,拿回来的是一条全新的片。
 */
import { describe, it, expect } from "vitest";
import { assembleSeedance, seedancePromptInput, anchoredClipLines } from "./seedance-prompt.helpers.js";
import { seedancePromptSkill } from "./seedance-prompt.js";
import { VIDEO_CLIP_TOKEN, videoPromptWarnings } from "./video-capabilities.js";
import { anchoredVideoAction } from "@fikirtive/core";

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

  it("声音与约束照旧接线", () => {
    const out = assembleSeedance(
      edit({
        constraints: "Keep the camera steady; Avoid sudden cuts",
        shots: [{ subject: "the shirt", action: "turns red", music: "soft guitar", sfx: "cloth rustle" }],
      }),
    );
    expect(out).toContain("Audio: （soft guitar） <cloth rustle>");
    expect(out).toContain("Keep the camera steady.");
    expect(out).toContain("Avoid sudden cuts.");
  });
});

// ---------------------------------------------------------------------------
// 判官 r1 P1-3 —— 清底片的指令与「其余完全不变」自相矛盾
// ---------------------------------------------------------------------------

describe("锚在商家自己那条片子上时,不下任何「清掉画面上的东西」的指令", () => {
  it("剪辑:不含 no on-screen text / watermark / logo 那一行", () => {
    const out = assembleSeedance(edit());
    expect(out).not.toContain("no on-screen text, watermark, or logo");
    // 「其余完全不变」那句话仍在 —— 它才是这一档真正的边界。
    expect(out).toContain("Keep every other part of the clip exactly as it is.");
  });

  it("剪辑:cleanFootage 显式为 true 也不下 —— 默认值不是这条规矩的判据", () => {
    expect(assembleSeedance(edit({ cleanFootage: true }))).not.toContain("no on-screen text");
  });

  it("续写:同一条规矩", () => {
    expect(assembleSeedance(extend())).not.toContain("no on-screen text, watermark, or logo");
  });

  it("竖版防字幕这一档同样不下 —— 它同样是一条「别让画面上有那个东西」的指令", () => {
    const out = assembleSeedance(edit({ aspect: "9:16" }));
    expect(out).not.toContain("do not burn in any subtitles or captions");
    expect(out).not.toContain("【】");
  });

  it("商家片子里的 logo 是商家的东西:改衬衫颜色的请求里,一个字都不提 logo", () => {
    const out = assembleSeedance(
      edit({ shots: [{ subject: "the shirt on the man", action: "is deep red instead of white" }] }),
    );
    expect(out.toLowerCase()).not.toContain("logo");
    expect(out.toLowerCase()).not.toContain("watermark");
  });

  it("从零生成那两档一个字没变 —— 清底片与竖版防字幕照旧", () => {
    const t2v = assembleSeedance(
      seedancePromptInput.parse({
        mode: "t2v",
        aspect: "9:16",
        shots: [{ subject: "the jar", action: "turns slowly" }],
      }),
    );
    expect(t2v).toContain("no on-screen text, watermark, or logo");
    expect(t2v).toContain("do not burn in any subtitles or captions");
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

  // 判官 r1 P3 —— 子串匹配把「preference」当成「reference」误报。
  it("只认整个词,不认碰巧含着它的别的词", () => {
    for (const clean of [
      "Strictly edit <Video_1>, and modify the customer's preference badge.",
      "Strictly edit <Video_1>, and modify the preferences panel.",
      "Strictly edit <Video_1>, and modify the dereferenced label.",
    ]) {
      expect(videoPromptWarnings("editClip", clean)).toEqual([]);
    }
  });

  it("复数照样逮 —— 「use the references」误导得一模一样", () => {
    expect(videoPromptWarnings("editClip", "Strictly edit <Video_1>, and modify using the references.")).toHaveLength(1);
  });

  it("大小写、标点贴着都逮得住", () => {
    expect(videoPromptWarnings("editClip", "Strictly edit <Video_1>, and modify the Reference.")).toHaveLength(1);
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

/**
 * #922 缺口 A(判官 r1 P2-1)—— 装配器**只加、不改**。
 *
 * 商家手动入口把他自己打的那句话原样交给这个装配器,所以句末那个句号只能在**还不在那里**
 * 时才补。删一个他打的字符,卡上冻结的那一段就不再是他看到的那一段(#917)。
 * 这一组直接测装配器本身:Otto 那条路与素材库那条路共用它,规则只有一份。
 */
describe("#922 —— 锚定句的组句:只补缺的分隔符,绝不动 segment 的字节", () => {
  const HEAD = "Strictly edit <Video_1>, and modify";
  const line = (segment: string) => anchoredClipLines({ action: "editClip", extendDirection: "forward", segment })[0]!;

  it("没有句末标点 ⇒ 补一个句号", () => {
    expect(line("the shirt to red")).toBe(`${HEAD} the shirt to red.`);
  });

  it("已有句末标点 ⇒ 不再补(不会出现 '..')", () => {
    for (const seg of ["the shirt to red.", "brighter?", "now!", "把衬衫改成红色。"]) {
      expect(line(seg)).toBe(`${HEAD} ${seg}`);
    }
  });

  it("句中的句号不算句末 ⇒ 照常补,商家的字节一个不动", () => {
    expect(line("make it 1.5x brighter")).toBe(`${HEAD} make it 1.5x brighter.`);
  });

  it("省略号收尾也算收尾 ⇒ 不补那第四个点(判官 r3 P3 点名的显式案例)", () => {
    expect(line("Wait...")).toBe(`${HEAD} Wait...`);
    expect(line("Wait…")).toBe(`${HEAD} Wait…`);
  });

  /**
   * 判官 r3 P1 —— 开场词后面那个空格是**识别器的边界**,不是排版。
   *
   * r1 那一版按「已经在那里就不再补」处理它:`segment` 以空白起头就不补空格。可 `/^\s/`
   * 认整个 Unicode 空白类,而 core 的 `anchoredVideoAction` 只认**字面 ASCII 空格**。
   * 于是商家用 tab / 换行起头(措辞框收得下),装配出来是 `…and modify\t改什么`,
   * 识别器回 `null` ⇒ 卡从 adaptive 退回 16:9、付费 schema 的 anchored 收紧整条不执行。
   *
   * 所以这一组把两件事一起钉死,少一件都不算修好:
   *   ① 分隔空格**无条件**在(识别器认得出来);
   *   ② 商家的字节从那个空格之后**逐字节原样**开始(他自己的前导空白也原样留着)。
   */
  describe("前导空白的五种起头形态 —— 分隔符归装配层,商家的字节一个不动", () => {
    const FORMS: Array<[string, string]> = [
      ["无前导空白", "the shirt to red"],
      ["前导空格", " the shirt to red"],
      ["前导 tab", "\tthe shirt to red"],
      ["前导换行", "\nthe shirt to red"],
      ["前导回车", "\rthe shirt to red"],
    ];

    for (const [name, seg] of FORMS) {
      it(`${name} ⇒ 仍被 core 认成 editClip,且字节逐一原样`, () => {
        const assembled = line(seg);
        // ① 装配层拥有那个分隔空格,无条件在。
        expect(assembled).toBe(`${HEAD} ${seg}.`);
        // ② 商家的那一段,从分隔空格之后起,逐字节原样。
        expect(assembled.slice(HEAD.length + 1, HEAD.length + 1 + seg.length)).toBe(seg);
        // ③ 钱路判据认得出来 —— 这一条才是 P1 的要害。
        expect(anchoredVideoAction(assembled)).toBe("editClip");
      });

      it(`${name} ⇒ 续写那一档同样认得出来`, () => {
        const assembled = anchoredClipLines({
          action: "extendClip", extendDirection: "forward", segment: seg,
        })[0]!;
        expect(anchoredVideoAction(assembled)).toBe("extendClip");
      });
    }

    it("首尾空白都在:前导跟在分隔空格后面,尾部原样留着", () => {
      expect(line(" the shirt to red ")).toBe(`${HEAD}  the shirt to red .`);
    });
  });

  it("续写那一档同一条规矩,且方向词照旧在官方位置上", () => {
    expect(anchoredClipLines({ action: "extendClip", extendDirection: "backward", segment: "she walks in." })[0])
      .toBe("Extend <Video_1> backward, she walks in.");
  });

  it("组句之后仍然是官方句式 —— 钱路判据认得出来", () => {
    for (const seg of ["the shirt to red", "the shirt to red.", " padded ", "Wait..."]) {
      expect(anchoredVideoAction(line(seg))).toBe("editClip");
    }
  });
});
