import { describe, it, expect } from "vitest";
import { buildDeploySignal, compareDeploySides, type WorkerHeartbeatRow } from "@/lib/deploy-fingerprint";
import { WORKER_STALE_MS } from "@/lib/health";

const WEB = { commitSha: "aaaaaaaabbbbbbbb", configFingerprint: "1234abcd" };

describe("compareDeploySides (#797)", () => {
  it("in sync when both sides agree on code and configuration", () => {
    const signal = compareDeploySides(WEB, { ...WEB });
    expect(signal.tone).toBe("success");
    expect(signal.status).toBe("In sync");
  });

  it("code mismatch is red and names both shas", () => {
    const signal = compareDeploySides(WEB, { commitSha: "cccccccc", configFingerprint: "1234abcd" });
    expect(signal.tone).toBe("danger");
    expect(signal.status).toBe("Code mismatch");
    expect(signal.detail).toContain("aaaaaaaa");
    expect(signal.detail).toContain("cccccccc");
  });

  it("config mismatch is red even when the code matches — the expensive silent case", () => {
    const signal = compareDeploySides(WEB, { commitSha: WEB.commitSha, configFingerprint: "9999ffff" });
    expect(signal.tone).toBe("danger");
    expect(signal.status).toBe("Config mismatch");
    expect(signal.detail).toContain("1234abcd");
    expect(signal.detail).toContain("9999ffff");
  });

  it("both wrong at once is reported as one split deploy, not two half-truths", () => {
    const signal = compareDeploySides(WEB, { commitSha: "cccccccc", configFingerprint: "9999ffff" });
    expect(signal.tone).toBe("danger");
    expect(signal.status).toBe("Split deploy");
  });

  it("shows short shas, not full ones", () => {
    const signal = compareDeploySides(WEB, { ...WEB });
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
describe("compareDeploySides — a missing fingerprint is never a match (#797 r2 P2-1)", () => {
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
      const signal = compareDeploySides(c.web, c.worker);
      expect(signal.status).toBe("Not yet reported");
      expect(signal.tone).not.toBe("success");
      expect(signal.tone).toBe("info");
      expect(signal.detail).toContain(c.who);
      // 绝不出现「匹配」的说法。
      expect(signal.detail).not.toMatch(/\bmatch(es)?\b/);
    });
  }

  /**
   * 判官 r2 P2-2:config 对不上、code 又比不了的那一格,诊断句原本一律写「两边都报告 <web 的
   * SHA>」——worker 没上报时替它编了一个,web 没上报时把 unknown 说成两边共同的版本。
   * 这一行的全部价值就是让人照着它处置,所以缺失侧必须如实描述,两个方向都要盖。
   */
  describe("config mismatch × unknown code: the diagnosis must not misattribute a sha", () => {
    it("worker did not report a commit — do not claim it runs web's sha", () => {
      const signal = compareDeploySides(WEB, { commitSha: null, configFingerprint: "9999ffff" });
      expect(signal.status).toBe("Config mismatch");
      expect(signal.tone).toBe("danger");
      expect(signal.detail).toContain("Web reports aaaaaaaa and the worker reports no deploy commit");
      expect(signal.detail).not.toContain("Both services report");
    });

    it("web did not report a commit — do not turn that into a shared version", () => {
      const signal = compareDeploySides(
        { commitSha: null, configFingerprint: "1234abcd" },
        { commitSha: "cccccccc", configFingerprint: "9999ffff" },
      );
      expect(signal.status).toBe("Config mismatch");
      expect(signal.detail).toContain("The worker reports cccccccc and web reports no deploy commit");
      expect(signal.detail).not.toContain("Both services report");
      expect(signal.detail).not.toContain("Both services report unknown");
    });

    it("neither side reported a commit — say exactly that", () => {
      const signal = compareDeploySides(
        { commitSha: null, configFingerprint: "1234abcd" },
        { commitSha: null, configFingerprint: "9999ffff" },
      );
      expect(signal.status).toBe("Config mismatch");
      expect(signal.detail).toContain("Neither service reports a deploy commit");
    });

    it("when the code genuinely matches, it still says so", () => {
      const signal = compareDeploySides(WEB, { commitSha: WEB.commitSha, configFingerprint: "9999ffff" });
      expect(signal.detail).toContain("Both services report aaaaaaaa");
    });

    it("no branch of this row ever prints the word unknown as if it were a version", () => {
      const rows = [
        compareDeploySides(WEB, { commitSha: null, configFingerprint: "9999ffff" }),
        compareDeploySides({ commitSha: null, configFingerprint: "1234abcd" }, { commitSha: "cccccccc", configFingerprint: "9999ffff" }),
        compareDeploySides({ commitSha: null, configFingerprint: "1234abcd" }, { commitSha: null, configFingerprint: "9999ffff" }),
      ];
      for (const row of rows) expect(row.detail).not.toContain("unknown");
    });
  });

  it("a real code mismatch still wins over a missing fingerprint — red beats waiting", () => {
    const signal = compareDeploySides(WEB, { commitSha: "cccccccc", configFingerprint: null });
    expect(signal.status).toBe("Code mismatch");
    expect(signal.tone).toBe("danger");
  });

  it("a missing commit sha with matching fingerprints is honest about what was not compared", () => {
    const signal = compareDeploySides(
      { commitSha: null, configFingerprint: "1234abcd" },
      { commitSha: null, configFingerprint: "1234abcd" },
    );
    expect(signal.status).toBe("Config matches, code unknown");
    expect(signal.tone).toBe("info");
    expect(signal.detail).toContain("have not been compared");
  });
});

/**
 * 判官 r3 P1 —— 拆分部署的假绿。
 *
 * #796 之后 worker 是两班,各写各的心跳行。admin 当时还固定读 `id: "worker"` 那一行,而拆分
 * 之后**再没有人写它**:它冻在拆分前的那一刻,sha 和指纹恰好与 web 相同。于是判官的对抗形状
 * 成立 —— 旧行与 web 一致、`worker-wait` 已经分叉,admin 报 In sync / 绿,而发布链正在静默失败。
 *
 * 下面这组把两条断路都钉住:读全部角色行(任何一班分叉即红)+ 超窗的行一律不作数。
 */
describe("buildDeploySignal — every live role, not one hard-coded row (#797 判官 r3 P1)", () => {
  const NOW = new Date("2026-08-13T12:00:00Z");
  const FRESH = new Date(NOW.getTime() - 30_000);
  const STALE = new Date(NOW.getTime() - WORKER_STALE_MS - 60_000);
  const DIVERGED = { commitSha: "cccccccc", configFingerprint: "1234abcd" };

  const row = (
    id: string,
    side: { commitSha: string | null; configFingerprint: string | null },
    at: Date,
  ): WorkerHeartbeatRow => ({ id, at, ...side });

  it("the judge's shape: a leftover worker row that matches web, while worker-wait has diverged", () => {
    const signal = buildDeploySignal(
      WEB,
      [
        // 拆分前留下的那一行。没人再写它,但它的两列与 web 一模一样 —— 这正是假绿的来源。
        row("worker", WEB, STALE),
        row("worker-compute", WEB, FRESH),
        row("worker-wait", DIVERGED, FRESH),
      ],
      NOW,
    );
    expect(signal.tone).toBe("danger");
    expect(signal.status).toBe("Code mismatch");
    // 必须指名道姓是哪一班,否则这一行没法照着处置。
    expect(signal.detail).toContain("worker-wait");
    expect(signal.detail).toContain("cccccccc");
    expect(signal.status).not.toBe("In sync");
  });

  it("same shape while the leftover row is still fresh — the live role's divergence still wins", () => {
    const signal = buildDeploySignal(
      WEB,
      [row("worker", WEB, FRESH), row("worker-wait", DIVERGED, FRESH)],
      NOW,
    );
    expect(signal.tone).toBe("danger");
  });

  it("a single stale leftover row is never green — nothing running has been compared", () => {
    const signal = buildDeploySignal(WEB, [row("worker", WEB, STALE)], NOW);
    expect(signal.tone).toBe("warning");
    expect(signal.status).toBe("No live worker heartbeat");
    expect(signal.tone).not.toBe("success");
    // 忽略了什么必须说出来 —— 静悄悄丢掉一行数据本身就是另一种骗人。
    expect(signal.detail).toContain("worker");
    expect(signal.detail).toContain("stale heartbeat row");
  });

  it("a stale row that diverges is not red either — its process is gone, that is history", () => {
    const signal = buildDeploySignal(
      WEB,
      [row("worker", DIVERGED, STALE), row("worker-compute", WEB, FRESH), row("worker-wait", WEB, FRESH)],
      NOW,
    );
    expect(signal.tone).toBe("success");
    expect(signal.status).toBe("In sync");
    // 但它被忽略这件事仍然写在明处。
    expect(signal.detail).toContain("Ignored 1 stale heartbeat row");
  });

  it("every live role agrees → in sync, and both roles are named", () => {
    const signal = buildDeploySignal(
      WEB,
      [row("worker-compute", WEB, FRESH), row("worker-wait", WEB, FRESH)],
      NOW,
    );
    expect(signal.tone).toBe("success");
    expect(signal.status).toBe("In sync");
    expect(signal.detail).toContain("worker-compute: In sync");
    expect(signal.detail).toContain("worker-wait: In sync");
  });

  it("the worst role decides: one red plus one not-yet-reported is red", () => {
    const signal = buildDeploySignal(
      WEB,
      [
        row("worker-compute", { commitSha: WEB.commitSha, configFingerprint: null }, FRESH),
        row("worker-wait", { commitSha: WEB.commitSha, configFingerprint: "9999ffff" }, FRESH),
      ],
      NOW,
    );
    expect(signal.tone).toBe("danger");
    expect(signal.status).toBe("Config mismatch");
    expect(signal.detail).toContain("worker-compute: Not yet reported");
  });

  it("the unsplit deployment — one fresh worker row behaves exactly as it did before the split", () => {
    expect(buildDeploySignal(WEB, [row("worker", WEB, FRESH)], NOW).status).toBe("In sync");
    expect(buildDeploySignal(WEB, [row("worker", DIVERGED, FRESH)], NOW).status).toBe("Code mismatch");
  });

  it("no rows at all → the worker has never written a heartbeat, a warning not an agreement", () => {
    const signal = buildDeploySignal(WEB, [], NOW);
    expect(signal.tone).toBe("warning");
    expect(signal.status).toBe("No worker heartbeat");
    expect(signal.detail).toContain("never written a heartbeat");
  });
});

/** 判官 r1 P3:admin 面上的状态词是 UI copy,按 English sentence case。 */
describe("deploy signal status strings are English sentence case (#797 r2 P3)", () => {
  const NOW = new Date("2026-08-13T12:00:00Z");
  const statuses = [
    compareDeploySides(WEB, { ...WEB }).status,
    compareDeploySides(WEB, { commitSha: "cccccccc", configFingerprint: "1234abcd" }).status,
    compareDeploySides(WEB, { commitSha: WEB.commitSha, configFingerprint: "9999ffff" }).status,
    compareDeploySides(WEB, { commitSha: "cccccccc", configFingerprint: "9999ffff" }).status,
    compareDeploySides(WEB, { commitSha: null, configFingerprint: null }).status,
    compareDeploySides(
      { commitSha: null, configFingerprint: "1234abcd" },
      { commitSha: null, configFingerprint: "1234abcd" },
    ).status,
    buildDeploySignal(WEB, [], NOW).status,
    buildDeploySignal(WEB, [{ id: "worker", at: new Date(NOW.getTime() - WORKER_STALE_MS - 1), ...WEB }], NOW).status,
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
