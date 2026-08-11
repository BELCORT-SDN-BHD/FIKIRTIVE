import { describe, it, expect } from "vitest";
import { buildDeploySignal } from "@/lib/deploy-fingerprint";

const WEB = { commitSha: "aaaaaaaabbbbbbbb", configFingerprint: "1234abcd" };

describe("buildDeploySignal (#797)", () => {
  it("in sync when both sides agree on code and configuration", () => {
    const signal = buildDeploySignal(WEB, { ...WEB });
    expect(signal.tone).toBe("success");
    expect(signal.status).toBe("In sync");
  });

  it("code mismatch is red and names both shas", () => {
    const signal = buildDeploySignal(WEB, { commitSha: "cccccccc", configFingerprint: "1234abcd" });
    expect(signal.tone).toBe("danger");
    expect(signal.status).toBe("Code mismatch");
    expect(signal.detail).toContain("aaaaaaaa");
    expect(signal.detail).toContain("cccccccc");
  });

  it("config mismatch is red even when the code matches — the expensive silent case", () => {
    const signal = buildDeploySignal(WEB, { commitSha: WEB.commitSha, configFingerprint: "9999ffff" });
    expect(signal.tone).toBe("danger");
    expect(signal.status).toBe("Config mismatch");
    expect(signal.detail).toContain("1234abcd");
    expect(signal.detail).toContain("9999ffff");
  });

  it("both wrong at once is reported as one split deploy, not two half-truths", () => {
    const signal = buildDeploySignal(WEB, { commitSha: "cccccccc", configFingerprint: "9999ffff" });
    expect(signal.tone).toBe("danger");
    expect(signal.status).toBe("Split deploy");
  });

  it("a missing heartbeat row warns instead of claiming agreement", () => {
    const signal = buildDeploySignal(WEB, null);
    expect(signal.tone).toBe("warning");
    expect(signal.status).toBe("No worker heartbeat");
  });

  it("shows short shas, not full ones", () => {
    const signal = buildDeploySignal(WEB, { ...WEB });
    expect(signal.detail).toContain("aaaaaaaa");
    expect(signal.detail).not.toContain("aaaaaaaabbbbbbbb");
  });
});

/**
 * 判官 r1 P2-1:迁移让存量心跳行的两列是 NULL。第一版在这个形状下返回「配置匹配」并亮绿——
 * 没有比较过任何东西却报了匹配,一个正在裂开的部署会被这样的绿盖住。
 *
 * 这一组把「缺失」与「相等」彻底分开:只要任何一侧没有指纹,就既不许说匹配,也不许亮绿。
 */
describe("buildDeploySignal — a missing fingerprint is never a match (#797 r2 P2-1)", () => {
  const cases = [
    {
      label: "the row right after the migration: worker has neither column",
      web: WEB,
      worker: { commitSha: null, configFingerprint: null },
      who: "The worker has not",
    },
    {
      label: "worker reports a commit but no fingerprint (a build from before this check)",
      web: WEB,
      worker: { commitSha: WEB.commitSha, configFingerprint: null },
      who: "The worker has not",
    },
    {
      label: "web could not compute a fingerprint",
      web: { commitSha: WEB.commitSha, configFingerprint: null },
      worker: WEB,
      who: "Web has not",
    },
    {
      label: "neither side has one",
      web: { commitSha: WEB.commitSha, configFingerprint: null },
      worker: { commitSha: WEB.commitSha, configFingerprint: null },
      who: "Neither service has",
    },
  ] as const;

  for (const c of cases) {
    it(`${c.label} → neutral "Not yet reported", never green`, () => {
      const signal = buildDeploySignal(c.web, c.worker);
      expect(signal.status).toBe("Not yet reported");
      expect(signal.tone).not.toBe("success");
      expect(signal.tone).toBe("info");
      expect(signal.detail).toContain(c.who);
      // 绝不出现「匹配」的说法。
      expect(signal.detail).not.toMatch(/\bmatch(es)?\b/);
    });
  }

  it("a real code mismatch still wins over a missing fingerprint — red beats waiting", () => {
    const signal = buildDeploySignal(WEB, { commitSha: "cccccccc", configFingerprint: null });
    expect(signal.status).toBe("Code mismatch");
    expect(signal.tone).toBe("danger");
  });

  it("a missing commit sha with matching fingerprints is honest about what was not compared", () => {
    const signal = buildDeploySignal(
      { commitSha: null, configFingerprint: "1234abcd" },
      { commitSha: null, configFingerprint: "1234abcd" },
    );
    expect(signal.status).toBe("Config matches, code unknown");
    expect(signal.tone).toBe("info");
    expect(signal.detail).toContain("have not been compared");
  });
});

/** 判官 r1 P3:admin 面上的状态词是 UI copy,按 English sentence case。 */
describe("deploy signal status strings are English sentence case (#797 r2 P3)", () => {
  const statuses = [
    buildDeploySignal(WEB, { ...WEB }).status,
    buildDeploySignal(WEB, { commitSha: "cccccccc", configFingerprint: "1234abcd" }).status,
    buildDeploySignal(WEB, { commitSha: WEB.commitSha, configFingerprint: "9999ffff" }).status,
    buildDeploySignal(WEB, { commitSha: "cccccccc", configFingerprint: "9999ffff" }).status,
    buildDeploySignal(WEB, null).status,
    buildDeploySignal(WEB, { commitSha: null, configFingerprint: null }).status,
    buildDeploySignal(
      { commitSha: null, configFingerprint: "1234abcd" },
      { commitSha: null, configFingerprint: "1234abcd" },
    ).status,
  ];

  it("every status starts with a capital and is neither Title Case nor ALL CAPS", () => {
    for (const s of statuses) {
      expect(s[0], `"${s}" must start with a capital letter`).toBe(s[0]?.toUpperCase());
      expect(s, `"${s}" must not be ALL CAPS`).not.toBe(s.toUpperCase());
      // sentence case:第一个词之后不再出现新的首字母大写单词。
      for (const word of s.split(" ").slice(1)) {
        expect(/^[A-Z]/.test(word), `"${s}" looks like Title Case at "${word}"`).toBe(false);
      }
    }
  });
});
