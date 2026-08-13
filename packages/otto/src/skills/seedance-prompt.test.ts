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
