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
  it("i2v adds a subject-consistency line", () => {
    expect(assembleSeedance(oneShot())).toContain("keep the subject consistent with the source frame");
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
  it("continuesFromPrev opens with the handoff phrase", () => {
    const out = assembleSeedance(seedancePromptInput.parse({
      continuesFromPrev: true, shots: [{ subject: "the swordsman", action: "raises the blade" }],
    }));
    expect(out).toContain("continuing from the previous frame,");
    expect(out).not.toContain("starting from the given first frame,");
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
});
