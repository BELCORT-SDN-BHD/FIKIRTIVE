import { describe, it, expect } from "vitest";
import { assembleSeedance, seedancePromptInput } from "./seedance-prompt.helpers.js";
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
  it("appends constraints when present", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      shots: [{ subject: "a cat", action: "leaps" }], constraints: "no motion blur",
    }));
    expect(out).toContain("no motion blur");
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
});
