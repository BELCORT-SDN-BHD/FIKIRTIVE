/**
 * caption.test.ts — #787: a Malaysian merchant's Malay clip must come back with captions.
 *
 * The bug had two halves and this file fences both:
 *   1. the shipped model was `ggml-base.en` — an ENGLISH-ONLY build — and the transcribe call
 *      pinned `-l en` on top of it, so Malay and Mandarin audio had no way through;
 *   2. the model name was written down TWICE (here and in apps/web's getTranscript), so
 *      changing it in one place would have emptied every merchant's captions in silence.
 *
 * No real transcription runs here (and none can: whisper-cli lives in the worker image, not
 * on a dev box). The subprocess is mocked and fed recorded-shape JSON, exactly like the other
 * subprocess jobs in this directory — what is asserted is the ARGV we send and the rows we
 * write, which is where both halves of #787 actually lived.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const m = vi.hoisted(() => {
  const captionJobFindUnique = vi.fn();
  const captionJobUpdate = vi.fn();
  const captionJobUpdateMany = vi.fn();
  const assetFindUnique = vi.fn();
  const transcriptFindUnique = vi.fn();
  const transcriptUpsert = vi.fn();
  const execa = vi.fn();
  const readFile = vi.fn();
  const probeFile = vi.fn();
  const ffmpegInput = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    captionJob: { findUnique: captionJobFindUnique, update: captionJobUpdate, updateMany: captionJobUpdateMany },
    asset: { findUnique: assetFindUnique },
    transcript: { findUnique: transcriptFindUnique, upsert: transcriptUpsert },
  };
  return {
    prisma, captionJobFindUnique, captionJobUpdate, captionJobUpdateMany, assetFindUnique,
    transcriptFindUnique, transcriptUpsert, execa, readFile, probeFile, ffmpegInput,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));
vi.mock("@fikirtive/db/principal", () => ({
  runAsSystem: (_name: string, fn: () => Promise<unknown>) => fn(),
  runAsTenant: (_ownerId: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../storage.js", () => ({ storage: { ffmpegInput: m.ffmpegInput } }));
vi.mock("./ingest.js", () => ({ probeFile: m.probeFile }));
vi.mock("execa", () => ({ execa: m.execa }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  readFile: m.readFile,
}));

import { handleCaption, WHISPER_MODEL_NAME } from "./caption.js";

const job = {
  id: "cj1",
  ownerId: "org1",
  projectId: "prj1",
  assetId: "ast1",
  contentHash: "c".repeat(64),
  status: "QUEUED",
};

/** The shape whisper-cli -oj actually writes: a `result.language` header (under `-l auto`
 *  this is the DETECTED language) plus millisecond-offset segments. */
function transcriptJson(language: string, words: string[]): string {
  return JSON.stringify({
    result: { language },
    transcription: words.map((text, i) => ({
      offsets: { from: i * 500, to: i * 500 + 480 },
      text: ` ${text}`,
    })),
  });
}

/** The argv of the transcribe call (the 2nd execa call; the 1st is ffmpeg's audio extract). */
function whisperArgv(): string[] {
  const call = m.execa.mock.calls.find((c) => c[0] === "whisper-cli");
  expect(call, "whisper-cli was never invoked").toBeDefined();
  return call![1] as string[];
}

/** Read the value that follows a flag in an argv array. */
function flagValue(argv: string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

/** The first call's first argument, asserting the call happened at all. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstArg(fn: { mock: { calls: any[][] } }): any {
  const call = fn.mock.calls[0];
  expect(call, "expected this prisma call to have happened").toBeDefined();
  return call![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  m.captionJobFindUnique.mockResolvedValue({ ...job });
  m.captionJobUpdateMany.mockResolvedValue({ count: 1 });
  m.captionJobUpdate.mockResolvedValue({});
  m.transcriptFindUnique.mockResolvedValue(null); // cold cache
  m.transcriptUpsert.mockResolvedValue({});
  m.assetFindUnique.mockResolvedValue({ id: "ast1", ownerId: "org1", contentHash: job.contentHash, ext: "mp4" });
  m.ffmpegInput.mockResolvedValue("/tmp/in.mp4");
  m.probeFile.mockResolvedValue({ hasAudio: true, durationS: 12 });
  m.execa.mockResolvedValue({ stdout: "" });
  m.readFile.mockResolvedValue(transcriptJson("en", ["Hello", "there"]));
});

// ───────────────────────────────────────────────────────────────────────────────
describe("#787 — the transcribe call can reach a non-English merchant at all", () => {
  it("asks the model to DETECT the language instead of pinning English", async () => {
    await handleCaption({ captionJobId: "cj1" });
    // `-l en` was the bug: it forced Malay/Mandarin audio through an English decoder.
    expect(flagValue(whisperArgv(), "-l")).toBe("auto");
  });

  it("loads a MULTILINGUAL model file, never an English-only `.en` build", async () => {
    await handleCaption({ captionJobId: "cj1" });
    const model = flagValue(whisperArgv(), "-m")!;
    expect(model).toContain(WHISPER_MODEL_NAME);
    // `ggml-base.en.bin` / `ggml-small.en.bin` — the `.en` suffix IS the defect.
    expect(model).not.toMatch(/\.en\.bin$/);
    expect(WHISPER_MODEL_NAME).not.toMatch(/\.en$/);
  });

  it("never translates — the merchant's own words stay in the merchant's own language", async () => {
    await handleCaption({ captionJobId: "cj1" });
    const argv = whisperArgv();
    expect(argv).not.toContain("--translate");
    expect(argv).not.toContain("-tr");
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("#787 — the languages this market actually speaks survive the round trip", () => {
  it("Malay: the cues are cached verbatim, not romanised into English", async () => {
    const words = ["Selamat", "datang", "ke", "kedai", "kami"];
    m.readFile.mockResolvedValue(transcriptJson("ms", words));

    await handleCaption({ captionJobId: "cj1" });

    const cues = firstArg(m.transcriptUpsert).create.cuesJson;
    expect(cues.map((c: { text: string }) => c.text)).toEqual(words);
    expect(m.captionJobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DONE", progress: 100 }) }),
    );
  });

  it("Mandarin: non-Latin script survives the parse", async () => {
    m.readFile.mockResolvedValue(transcriptJson("zh", ["欢迎", "光临", "我们的", "店"]));

    await handleCaption({ captionJobId: "cj1" });

    const cues = firstArg(m.transcriptUpsert).create.cuesJson;
    expect(cues.map((c: { text: string }) => c.text)).toEqual(["欢迎", "光临", "我们的", "店"]);
  });

  it("English does not regress — the path that already worked still works", async () => {
    m.readFile.mockResolvedValue(transcriptJson("en", ["Fifty", "percent", "off"]));

    await handleCaption({ captionJobId: "cj1" });

    const cues = firstArg(m.transcriptUpsert).create.cuesJson;
    expect(cues).toEqual([
      { startMs: 0, lengthMs: 480, text: "Fifty" },
      { startMs: 500, lengthMs: 480, text: "percent" },
      { startMs: 1000, lengthMs: 480, text: "off" },
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("#787 — the cache cannot serve English cues for a model that no longer runs", () => {
  it("reads and writes the cache under the CURRENT model name, not the retired one", async () => {
    await handleCaption({ captionJobId: "cj1" });

    const lookup = firstArg(m.transcriptFindUnique).where.contentHash_model;
    expect(lookup).toEqual({ contentHash: job.contentHash, model: WHISPER_MODEL_NAME });
    expect(lookup.model).not.toBe("base.en");
    expect(firstArg(m.transcriptUpsert).create.model).toBe(WHISPER_MODEL_NAME);
  });

  it("a transcript cached by the retired English model is not served as a hit", async () => {
    // The row exists for these bytes — but under the OLD model, so findUnique misses and the
    // clip is transcribed again. Merchants who captioned before this fix get real captions.
    m.transcriptFindUnique.mockImplementation(async ({ where }: { where: { contentHash_model: { model: string } } }) =>
      where.contentHash_model.model === "base.en" ? { cuesJson: [] } : null,
    );

    await handleCaption({ captionJobId: "cj1" });

    expect(m.execa.mock.calls.some((c) => c[0] === "whisper-cli")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe("#787 — the model name has exactly one owner", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../../../..");
  const dockerfile = readFileSync(path.join(repoRoot, "apps/worker/Dockerfile"), "utf8");

  it("the Dockerfile builds the same model this handler loads", () => {
    expect(dockerfile).toMatch(new RegExp(`^ARG WHISPER_MODEL=${WHISPER_MODEL_NAME}$`, "m"));
    expect(dockerfile).toMatch(
      new RegExp(`^ENV WHISPER_MODEL_PATH=/opt/whisper/models/ggml-${WHISPER_MODEL_NAME}\\.bin$`, "m"),
    );
  });

  it("the model download is checksum-pinned — a 466 MiB blob does not enter the image unverified", () => {
    expect(dockerfile).toMatch(/^ARG WHISPER_MODEL_SHA256=[0-9a-f]{64}$/m);
    expect(dockerfile).toContain("sha256sum -c -");
  });

  it("apps/web no longer keeps a second copy of the model name", () => {
    // The silent half of #787: getTranscript asked the cache for `model: "base.en"` on its own
    // authority. It must not name a model at all — that knowledge belongs to the worker.
    // (booleans, not toContain — a failed toContain on a 3k-line file prints the whole file)
    const actions = readFileSync(path.join(repoRoot, "apps/web/lib/actions.ts"), "utf8");
    expect(actions.includes('model: "base.en"'), "actions.ts still hardcodes the retired model").toBe(false);
    expect(actions.includes("contentHash_model"), "actions.ts still reads the cache by model name").toBe(false);
  });
});
