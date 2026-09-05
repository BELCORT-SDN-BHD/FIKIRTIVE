import { describe, it, expect, afterEach, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createStubEmailPort } from "../stub-adapter";

/**
 * The stub transport's three behaviours, moved here whole with the code they describe (they used
 * to live in `resend-adapter.test.ts` as "dev fallback"). Nothing about what it does changed —
 * what changed is that it is now a transport with a name, chosen by `transport.ts`, which is what
 * lets the login page know this deployment can deliver at all.
 */
const STUB_FILE = path.join(process.cwd(), "..", "..", ".data", "last-magic-link.txt");

describe("createStubEmailPort", () => {
  afterEach(async () => {
    await rm(STUB_FILE, { force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("writes devPreview to <repo>/.data/last-magic-link.txt when given, without hitting the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const port = createStubEmailPort();

    await port.send({
      to: "a@x.test",
      subject: "S",
      text: "Sign in:\nhttps://x.test/verify?t=1\n\nignore.",
      devPreview: "https://x.test/verify?t=1",
    });

    expect(await readFile(STUB_FILE, "utf8")).toBe("https://x.test/verify?t=1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to text (then html) when devPreview is omitted", async () => {
    const port = createStubEmailPort();
    await port.send({ to: "a@x.test", subject: "S", text: "plain body" });
    expect(await readFile(STUB_FILE, "utf8")).toBe("plain body");
  });

  it("logs the same preview value it persists", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const port = createStubEmailPort();
    await port.send({ to: "a@x.test", subject: "Sign in to Fikirtive", devPreview: "u123" });
    expect(logSpy).toHaveBeenCalledWith("[better-auth] Sign in to Fikirtive for a@x.test: u123");
  });
});
