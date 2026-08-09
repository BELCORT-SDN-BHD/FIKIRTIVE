import { describe, it, expect, vi } from "vitest";
import { publishX, xScopeCanPublish, X_PUBLISH_SCOPE, type XApiPort } from "./x-publish.js";

function portReturning(body: unknown): XApiPort {
  return { post: vi.fn().mockResolvedValue(body) };
}
function portThrowing(err: unknown): XApiPort {
  return { post: vi.fn().mockRejectedValue(err) };
}

describe("xScopeCanPublish (实授 scope 派生, DEFAULT false)", () => {
  it("is false without the publish scope; true only when granted", () => {
    expect(xScopeCanPublish("")).toBe(false);
    expect(xScopeCanPublish(null)).toBe(false);
    expect(xScopeCanPublish("tweet.read users.read")).toBe(false);
    expect(xScopeCanPublish(`tweet.read ${X_PUBLISH_SCOPE} offline.access`)).toBe(true);
    expect(xScopeCanPublish("tweet.read,tweet.write")).toBe(true);
  });
});

describe("publishX (shared X orchestration, mock port — ZERO real X calls)", () => {
  it("posts text and returns the tweet id", async () => {
    const port = portReturning({ data: { id: "tweet-1", text: "hi" } });
    const res = await publishX(port, { text: "hello world" });
    expect(res).toEqual({ externalId: "tweet-1" });
    expect(port.post).toHaveBeenCalledWith("2/tweets", { text: "hello world" });
  });

  it("attaches media_ids when provided", async () => {
    const port = portReturning({ data: { id: "t2" } });
    await publishX(port, { text: "hi", mediaIds: ["m1", "m2"] });
    expect(port.post).toHaveBeenCalledWith("2/tweets", { text: "hi", media: { media_ids: ["m1", "m2"] } });
  });

  it("refuses an empty post (no text, no media) without calling X", async () => {
    const port = portReturning({ data: { id: "x" } });
    const res = await publishX(port, { text: "   " });
    expect(res).toEqual({ error: "an X post needs text or media", retryable: false });
    expect(port.post).not.toHaveBeenCalled();
  });

  it("2xx with no id → ambiguous (never blind-retry, 契约7)", async () => {
    const res = await publishX(portReturning({ data: {} }), { text: "hi" });
    expect(res).toMatchObject({ ambiguous: true });
    expect("retryable" in res).toBe(false);
  });

  it("a definitive 4xx rejection → hard fail (③, not retryable)", async () => {
    const res = await publishX(portThrowing(Object.assign(new Error("Bad Request"), { status: 400 })), { text: "hi" });
    expect(res).toEqual({ error: "Bad Request", retryable: false });
  });

  it("a 5xx → ambiguous (may have crossed X's side-effect point)", async () => {
    const res = await publishX(portThrowing(Object.assign(new Error("Server Error"), { status: 503 })), { text: "hi" });
    expect(res).toMatchObject({ ambiguous: true });
  });

  it("a timeout/abort → ambiguous", async () => {
    const res = await publishX(portThrowing(Object.assign(new Error("aborted"), { name: "TimeoutError" })), { text: "hi" });
    expect(res).toMatchObject({ ambiguous: true });
  });
});

/* #810 r4 P1-a —— X 的最终动作前也走同一个契约。X 目前在 POST 之前没有慢工序,但复核由**契约**
 * 提供而不是各渠道各自为政,意味着以后谁在这里加一步慢工序,窗口也不会重新长出来。 */
describe("#810 r4 P1-a X 的最终动作前也问一次开关", () => {
  it("关掉开关 —— 一个 tweet 都不发", async () => {
    const calls: string[] = [];
    const port: XApiPort = {
      post: async (path) => {
        calls.push(path);
        return { data: { id: "t1" } };
      },
    };
    const res = await publishX(port, { text: "hi", confirmStillAuthorized: async () => false });
    expect(calls).toEqual([]);
    expect(res).toMatchObject({ withdrawn: true, retryable: false });
  });

  it("开关开着 —— 照常发", async () => {
    const calls: string[] = [];
    const port: XApiPort = {
      post: async (path) => {
        calls.push(path);
        return { data: { id: "t1" } };
      },
    };
    const res = await publishX(port, { text: "hi", confirmStillAuthorized: async () => true });
    expect(calls).toEqual(["2/tweets"]);
    expect(res).toMatchObject({ externalId: "t1" });
  });
});
