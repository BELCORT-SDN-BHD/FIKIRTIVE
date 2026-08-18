import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_WALL_EXEMPTIONS,
  buildAuthWallMatcher,
  exemptionPattern,
  type AuthWallExemption,
} from "@/lib/auth-wall-ledger";

const mockGetSession = vi.fn();

vi.mock("@/lib/better-auth/server", () => ({
  auth: { api: { getSession: mockGetSession } },
}));

const { default: proxy, config } = await import("../../proxy");

const STALE_THREAD_ACTIVITY_ACTION_ID = "40e295ab821708676046d9a9ce1d58dca80ea9c87c";

// Next runs proxy() ONLY for a pathname that matches config.matcher; an excluded path never even
// reaches the auth wall. So exercise the REAL matcher regex to prove the exclusion, rather than
// trusting proxy() alone (which the harness can call directly).
//
// #901: compile it with the SAME compiler Next uses — its own vendored path-to-regexp — instead of
// wrapping the string in `^…$` by hand. Next's compiled form is not the hand-wrapped one (it adds
// its own anchors and a tolerated trailing `/`, `#` or `?`), so a hand-wrapped regex is a
// look-alike, not the thing that ships. This file's every claim about what is inside or outside
// the wall rests on this one helper; it should read the production article.
const requireFromHere = createRequire(import.meta.url);
const { pathToRegexp } = requireFromHere("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (source: string) => RegExp;
};
const COMPILED_MATCHER = pathToRegexp(config.matcher[0]);

function matcherRuns(pathname: string): boolean {
  return COMPILED_MATCHER.test(pathname);
}

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** app/foo/[id]/page.tsx → /foo/id;app/api/x/[...all]/route.ts → /api/x/all/all。 */
function urlSegment(directoryName: string): string {
  if (directoryName.startsWith("[...")) {
    const name = directoryName.slice(4, -1);
    return `${name}/${name}`;
  }
  return directoryName.startsWith("[") ? directoryName.slice(1, -1) : directoryName;
}

/** app/ 下每一条真路由的 URL 路径,从文件系统机械枚举 —— 地址不在测试里手抄第二份。 */
function realRoutePaths(dir = resolve(WEB_ROOT, "app"), urlPrefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name === "page.tsx" || entry.name === "route.ts")) {
      found.push(urlPrefix === "" ? "/" : urlPrefix);
      continue;
    }
    if (!entry.isDirectory() || entry.name === "__tests__") continue;
    found.push(...realRoutePaths(join(dir, entry.name), `${urlPrefix}/${urlSegment(entry.name)}`));
  }
  return found;
}

function req(path: string, init?: { method?: string; headers?: HeadersInit }) {
  return {
    method: init?.method ?? "GET",
    nextUrl: new URL(`https://app.test${path}`),
    headers: new Headers(init?.headers),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_ENABLED", "true");
  mockGetSession.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy", () => {
  it("no-ops stale Otto thread activity Server Action posts before auth", async () => {
    const res = await proxy(req("/otto?project=project_1", {
      method: "POST",
      headers: { "next-action": STALE_THREAD_ACTIVITY_ACTION_ID },
    }));

    expect(res?.status).toBe(204);
    expect(res?.headers).toMatchObject({
      "cache-control": "no-store",
      "x-fikirtive-stale-client": "otto-thread-activity",
    });
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("does not intercept other Otto Server Action posts", async () => {
    const res = await proxy(req("/otto?project=project_1", {
      method: "POST",
      headers: { "next-action": "other-action" },
    }));

    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });

  it("does not intercept the stable thread activity API route", async () => {
    const res = await proxy(req("/api/otto/thread-activity?projectId=project_1", {
      method: "GET",
    }));

    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});

// H1: the signed media proxy is fetched by Meta's servers with NO session. If the auth wall
// redirected it to /login, every published post's media would 404 at Meta → publish fails. The
// matcher must exclude EXACTLY /api/media/pub/* (HMAC is its sole auth), and nothing else.
describe("proxy — public signed media route (/api/media/pub)", () => {
  it("the matcher does NOT run the auth wall for /api/media/pub/<token> (Meta fetches it, no session)", () => {
    expect(matcherRuns("/api/media/pub/eyJvIjoib3JnQSJ9.deadbeef")).toBe(false);
  });

  it("boundary (契约5): a same-prefix sibling /api/media/pubfoo stays WALLED, not bypassed", () => {
    // Regression for the v0.2-flagged matcher gap: the exclusion was an UN-bounded prefix
    // (api/media/pub), so /api/media/pubfoo escaped the wall by merely sharing the prefix. The
    // exclusion is now anchored to exactly the /api/media/pub/* [token] route.
    expect(matcherRuns("/api/media/pubfoo")).toBe(true); // walled — NOT the signed-media route
    expect(matcherRuns("/api/media/pub/abc.def")).toBe(false); // real token route stays excluded
  });

  it("keeps the wall on other protected routes → an unauthenticated request still redirects", async () => {
    // The exception is scoped: siblings of the media route are still walled by the matcher.
    expect(matcherRuns("/dashboard")).toBe(true);
    expect(matcherRuns("/api/otto/thread-activity")).toBe(true);
    expect(matcherRuns("/api/media/other")).toBe(true); // ONLY api/media/pub is public, not all api/media

    // And a route the matcher DOES run redirects a session-less request (proves the wall still bites).
    const res = await proxy(req("/dashboard"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});

// #563: /legal/data-deletion is the URL filed with Meta as the app's Data deletion URL
// (app/api/meta/data-deletion/route.ts:76 returns `${origin}/legal/data-deletion?code=…`).
// Meta's reviewer opens it with NO session, so it must render outside the auth wall — if it
// ever redirected to /login, App Review would fail the Data deletion requirement. The wall
// itself is what these assertions pin: the page's own reachability, and the fact that the
// exemption did not quietly widen into the authenticated app.
describe("proxy — public data-deletion page (/legal/data-deletion)", () => {
  it("the matcher does NOT run the auth wall for /legal/data-deletion (Meta's reviewer has no session)", () => {
    expect(matcherRuns("/legal/data-deletion")).toBe(false);
  });

  it("does not open the authenticated app: the walled routes around it stay walled", () => {
    // Scope check. /legal is the ONLY public prefix this page needs; the product's own
    // surfaces — including the ones that perform the self-service deletions the page
    // describes — must still require a session.
    expect(matcherRuns("/otto")).toBe(true); // campaigns, conversations, Connections → Disconnect
    expect(matcherRuns("/library")).toBe(true); // library asset deletion
    expect(matcherRuns("/crm/contacts")).toBe(true);
    expect(matcherRuns("/billing")).toBe(true);
  });

  it("a session-less request to a walled route still redirects to /login", async () => {
    // Proves the wall is live in this test's env, so the `false` assertions above mean
    // "exempted", not "wall switched off".
    const res = await proxy(req("/crm/contacts"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});

// #606 (T7 第二刀):`northstar` 曾整个前缀免认证 —— 那条豁免存在的唯一理由是设计稿画廊与
// 6 页 mock「反正生产 404」。假页删净、预览开关删除之后,这个前缀下只剩两条真产品路由
// (Home + Canvas),它们读的是商家自己的项目与画布。所以豁免收回:northstar 回到登录墙内。
describe("proxy — the northstar prefix is back inside the login wall (#606)", () => {
  it("runs the auth wall for the two real northstar routes", () => {
    expect(matcherRuns("/northstar-immersive")).toBe(true);
    expect(matcherRuns("/northstar-immersive/create/canvas")).toBe(true);
  });

  it("runs the auth wall for anything else under the prefix (no mock page can slip back out)", () => {
    expect(matcherRuns("/northstar")).toBe(true);
    expect(matcherRuns("/northstar-immersive/cityhall/admin")).toBe(true);
    expect(matcherRuns("/northstar-immersive/onboarding/login")).toBe(true);
  });

  it("a session-less request to the northstar canvas redirects to /login, keeping the deep link", async () => {
    const res = await proxy(req("/northstar-immersive/create/canvas?project=p-1"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });

  it("the exemptions that must stay are untouched", () => {
    // Scope check: pulling northstar back in must not disturb the doors that are public by design.
    expect(matcherRuns("/login")).toBe(false);
    expect(matcherRuns("/signup")).toBe(false);
    expect(matcherRuns("/legal/data-deletion")).toBe(false);
    expect(matcherRuns("/api/better-auth/callback/google")).toBe(false);
  });
});

// W2-5: the Create surface moved off the internal code name onto /create. A route rename is
// exactly how a surface falls OUT of a login wall by accident — the exclusion list is written in
// path prefixes, and nobody re-reads it when a directory moves. So the new address gets the same
// two proofs the old one has, on the real matcher regex.
describe("proxy — the renamed Create surface is inside the login wall (W2-5)", () => {
  it("runs the auth wall for /create and its canvas", () => {
    expect(matcherRuns("/create")).toBe(true);
    expect(matcherRuns("/create/canvas")).toBe(true);
  });

  it("a session-less request to the canvas redirects to /login, keeping the deep link", async () => {
    const res = await proxy(req("/create/canvas?project=p-1"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});

// #940: the sign-up verification mail lands on /verify-email (lib/better-auth/verify-landing-url.ts
// builds that link; lib/better-auth/server.ts mails it). Everyone who clicks it is BY DEFINITION
// session-less — verifying is how they get a session — so the wall must not run there. It did:
// the page was missing from the exclusion list, so every new merchant was redirected to /login
// and the token in the link never reached Better Auth.
describe("proxy — email verification landing page (/verify-email)", () => {
  it("the matcher does NOT run the auth wall for /verify-email (the mail's reader has no session)", () => {
    // The matcher decides on the pathname alone; the link's ?token=…&callbackURL=… rides along
    // and is read by the page itself, which forwards it untouched.
    expect(matcherRuns("/verify-email")).toBe(false);
    // Next normalizes the trailing slash away, but a mail client may still send one.
    expect(matcherRuns("/verify-email/")).toBe(false);
  });

  /**
   * #969 judge P2-1/P2-2: this exemption shipped as an UNBOUNDED PREFIX, so every path that
   * merely STARTS with the word escaped the wall. They 404 today, so nothing leaked — but the
   * next route named /verify-email-admin would have been public with no one deciding that.
   * Same shape as the /api/ops/dlq boundary above (#793): the exemption is one path.
   */
  it.each([
    "/verify-emailx",
    "/verify-email-admin",
    "/verify-email2",
    "/verify-email/anything",
    "/verify-email/admin/tokens",
  ])("runs the auth wall for %s — the exemption is one path, not a prefix", (path) => {
    expect(matcherRuns(path)).toBe(true);
  });

  it("a session-less request to a same-prefix path still redirects to /login", async () => {
    const res = await proxy(req("/verify-email-admin"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });

  it("the endpoint the landing page forwards to stays outside the wall too", () => {
    // The page only hands `token` on to this route; if THAT were walled the fix would be half done.
    expect(matcherRuns("/api/better-auth/verify-email")).toBe(false);
  });

  it("opens nothing else: the app behind the door stays walled", async () => {
    expect(matcherRuns("/otto")).toBe(true);
    expect(matcherRuns("/billing")).toBe(true);

    // Proves the wall is live in this env, so the `false` assertions above mean "exempted".
    const res = await proxy(req("/otto"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});

// #793: the dead-letter probe is pulled by an external uptime service, which has no session.
// It answers clear/backed-up/unknown and nothing else, so it joins /api/health outside the wall —
// and the exemption must not quietly become "everything under /api/ops is public".
describe("proxy — dead-letter probe (/api/ops/dlq)", () => {
  it("the matcher does NOT run the auth wall for /api/ops/dlq (the uptime probe has no session)", () => {
    expect(matcherRuns("/api/ops/dlq")).toBe(false);
    // Next normalizes the trailing slash away, but a monitor URL may still carry one.
    expect(matcherRuns("/api/ops/dlq/")).toBe(false);
  });

  it("does not open /api/ops as a public prefix", () => {
    expect(matcherRuns("/api/ops")).toBe(true);
    expect(matcherRuns("/api/ops/queues")).toBe(true);
    expect(matcherRuns("/api/ops/tenants")).toBe(true);
  });

  /**
   * r2 (judge r1 P1): the exemption used to be an UNBOUNDED PREFIX. `/api/ops/dlqx`,
   * `/api/ops/dlq-admin` and `/api/ops/dlq/tenants` all skipped the wall — they 404 today,
   * so nothing leaked, but the next route whose name merely starts the same way would have
   * shipped public with no one deciding that. The exemption is now the exact path.
   */
  it.each([
    "/api/ops/dlqx",
    "/api/ops/dlq-admin",
    "/api/ops/dlq2",
    "/api/ops/dlq/tenants",
    "/api/ops/dlq/purge",
  ])("runs the auth wall for %s — the exemption is one path, not a prefix", (path) => {
    expect(matcherRuns(path)).toBe(true);
  });

  it("a session-less request to a same-prefix path still redirects to /login", async () => {
    const res = await proxy(req("/api/ops/dlq-admin"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });

  it("a session-less request to a sibling ops path still redirects to /login", async () => {
    const res = await proxy(req("/api/ops/queues"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});

/* ──────────────────────────────────────────────────────────────────────────────
 * #901 / #978 —— 豁免簿本身。
 *
 * 上面每个 describe 都是「某一条豁免被判官抓到写错了,补一组边界断言」。抓了三次
 * (api/media/pub、api/ops/dlq、verify-email),三次都只补自己那一条,剩下的照样是裸词前缀。
 * 下面这一组不再一条条补:它机械枚举整本清单,对每条按它自己声明的语义断言边界,
 * 并且把 proxy.ts 里那行字面量钉死成清单的输出。新增豁免时,这里不需要写新测试 ——
 * 清单多一行,断言自动多一组;写歪了,当场红。
 * ────────────────────────────────────────────────────────────────────────────── */

const EXACT_EXEMPTIONS = AUTH_WALL_EXEMPTIONS.filter((e) => e.semantics === "exact");
const SUBTREE_EXEMPTIONS = AUTH_WALL_EXEMPTIONS.filter((e) => e.semantics === "subtree");

describe("proxy — the exemption ledger generates the matcher (#901)", () => {
  it("config.matcher is byte-for-byte what the ledger generates", () => {
    // 围栏。Next 要 matcher 是构建期常量,所以 proxy.ts 里必须是手写字面量;这条断言就是
    // 「手写」与「清单」之间唯一的绑绳。改了清单没同步字面量、或者绕过清单直接手改字面量,
    // 两种走法都在这里断掉。
    expect(config.matcher).toEqual([buildAuthWallMatcher()]);
  });

  it("every exemption states why it may answer without a session", () => {
    for (const exemption of AUTH_WALL_EXEMPTIONS) {
      expect(exemption.reason.trim()).not.toBe("");
    }
  });

  it("the ledger is not empty and every path is declared once", () => {
    expect(AUTH_WALL_EXEMPTIONS.length).toBeGreaterThan(0);
    const paths = AUTH_WALL_EXEMPTIONS.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

// 精确类:四形状。裸路径与尾斜杠出墙,`<name>x` 与 `<name>/anything` 留在墙内。
describe.each(EXACT_EXEMPTIONS.map((e) => [e.path, e] as const))(
  "proxy — exact exemption /%s",
  (path, exemption) => {
    it("lets the bare path out of the wall", () => {
      expect(matcherRuns(`/${path}`)).toBe(false);
    });

    it("lets the trailing-slash form out too (a monitor or mail client may send one)", () => {
      expect(matcherRuns(`/${path}/`)).toBe(false);
    });

    it("keeps a same-word sibling INSIDE the wall — the exemption is one path, not a prefix", () => {
      // /loginx、/api/healthz、/api/readyz、/api/stripe-secret 就是 #901 实测点名的那批词形。
      expect(matcherRuns(`/${path}x`)).toBe(true);
      expect(matcherRuns(`/${path}-admin`)).toBe(true);
    });

    it("keeps everything under the path INSIDE the wall", () => {
      expect(matcherRuns(`/${path}/anything`)).toBe(true);
      expect(matcherRuns(`/${path}/admin/secrets`)).toBe(true);
    });

    it("states its reason", () => {
      expect(exemption.reason.trim()).not.toBe("");
    });
  },
);

// 子树类:整棵子树出墙,但边界钉在 `/` 分段处 —— `<name>x` 依然在墙内。
describe.each(SUBTREE_EXEMPTIONS.map((e) => [e.path, e] as const))(
  "proxy — subtree exemption /%s",
  (path, exemption) => {
    it("lets the path and everything under it out of the wall", () => {
      expect(matcherRuns(`/${path}`)).toBe(false);
      expect(matcherRuns(`/${path}/`)).toBe(false);
      expect(matcherRuns(`/${path}/anything`)).toBe(false);
      expect(matcherRuns(`/${path}/deeply/nested/thing`)).toBe(false);
    });

    it("still keeps a same-word sibling INSIDE the wall (the subtree is bounded at a segment)", () => {
      expect(matcherRuns(`/${path}x`)).toBe(true);
      expect(matcherRuns(`/${path}-admin`)).toBe(true);
    });

    it("states the scope reason that earns it a whole subtree", () => {
      expect(exemption.reason.trim()).not.toBe("");
    });
  },
);

// #901 的实测清单,逐字钉死。这些词形在修复前全部 OPEN(今天 404,所以没有活洞)。
describe("proxy — the word-forms #901 measured as bypassing the wall are walled now", () => {
  it.each([
    "/api/healthz",
    "/api/health-admin",
    "/api/readyz",
    "/api/stripe-secret",
    "/loginx",
    "/legalese",
  ])("%s runs the auth wall", (path) => {
    expect(matcherRuns(path)).toBe(true);
  });

  it("a session-less request to one of them redirects to /login", async () => {
    const res = await proxy(req("/api/stripe-secret"));
    expect(res?.status).toBe(307);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });
});

// #978 点名的十条。八条收成 exact;privacy 与 legal 在实测下**不能**收 —— 见下面的理由断言。
describe("proxy — the ten prefixes named in #978", () => {
  const DECIDED: Record<string, "exact" | "subtree"> = {
    login: "exact",
    signup: "exact",
    "forgot-password": "exact",
    "reset-password": "exact",
    terms: "exact",
    privacy: "subtree",
    legal: "subtree",
    "api/health": "exact",
    "api/ready": "exact",
    "api/meta/data-deletion": "exact",
  };

  it.each(Object.entries(DECIDED))("%s is declared %s in the ledger", (path, semantics) => {
    const exemption = AUTH_WALL_EXEMPTIONS.find((e) => e.path === path);
    expect(exemption?.semantics).toBe(semantics);
  });

  it("privacy stays a subtree because /privacy/bm is a real public page", () => {
    // PDPA 双语要求的 BM 版隐私告知。收成 exact 会把它关进墙里。
    expect(existsSync(resolve(WEB_ROOT, "app/privacy/bm/page.tsx"))).toBe(true);
    expect(matcherRuns("/privacy/bm")).toBe(false);
  });

  it("legal stays a subtree because the ONLY page under it is the Meta Data deletion URL", () => {
    // app/legal 底下没有 page.tsx,只有 data-deletion —— 这条豁免存在的全部理由就是那棵子树。
    expect(existsSync(resolve(WEB_ROOT, "app/legal/page.tsx"))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, "app/legal/data-deletion/page.tsx"))).toBe(true);
    expect(matcherRuns("/legal/data-deletion")).toBe(false);
  });

  it("api/meta/data-deletion is exact because it has no sub-callback route", () => {
    const dir = resolve(WEB_ROOT, "app/api/meta/data-deletion");
    const subdirectories = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "__tests__")
      .map((entry) => entry.name);
    expect(subdirectories).toEqual([]);
  });
});

/* ──────────────────────────────────────────────────────────────────────────────
 * 围栏的负面证据:清单拒绝什么。
 * ────────────────────────────────────────────────────────────────────────────── */
describe("proxy — the ledger refuses a malformed exemption (#901)", () => {
  const sound = (over: Partial<AuthWallExemption> = {}): AuthWallExemption => ({
    path: "api/example",
    semantics: "exact",
    reason: "test fixture",
    ...over,
  });

  it("refuses a hand-written regex fragment — the shape that rotted the old matcher", () => {
    // 旧豁免簿之所以会腐烂,是因为它是一条正则,谁都能往里塞 `.*`、`|`、`(?!`。
    expect(() => buildAuthWallMatcher([sound({ path: "api/example.*" })])).toThrow(/unsafe/i);
    expect(() => buildAuthWallMatcher([sound({ path: "api/a|api/b" })])).toThrow(/unsafe/i);
    expect(() => buildAuthWallMatcher([sound({ path: "api/(?!x)" })])).toThrow(/unsafe/i);
  });

  it("refuses the old trailing-slash prefix shape (`api/media/pub/`)", () => {
    expect(() => buildAuthWallMatcher([sound({ path: "api/media/pub/" })])).toThrow(/unsafe/i);
  });

  it("refuses a leading slash, an empty path and an empty ledger", () => {
    expect(() => buildAuthWallMatcher([sound({ path: "/api/example" })])).toThrow(/unsafe/i);
    expect(() => buildAuthWallMatcher([sound({ path: "" })])).toThrow(/unsafe/i);
    expect(() => buildAuthWallMatcher([])).toThrow(/empty ledger/i);
  });

  it("refuses an exemption with no stated reason", () => {
    expect(() => buildAuthWallMatcher([sound({ reason: "   " })])).toThrow(/no stated reason/i);
  });

  it("refuses the same path declared twice", () => {
    expect(() => buildAuthWallMatcher([sound(), sound()])).toThrow(/duplicate/i);
  });

  it("has no way to SPELL an unbounded prefix: both semantics generate a bounded pattern", () => {
    // 这是围栏的核心。裸词前缀不是「被检查出来然后拒绝」,而是**根本写不出来** ——
    // semantics 是封闭联合,两个取值生成的两种形状都自带边界。
    expect(exemptionPattern(sound({ path: "login", semantics: "exact" }))).toBe("login/?$");
    expect(exemptionPattern(sound({ path: "legal", semantics: "subtree" }))).toBe("legal(?:/.*)?$");
    expect(exemptionPattern(sound({ path: "favicon.ico" }))).toBe("favicon\\.ico/?$");

    // @ts-expect-error —— 没有第三种语义。这行一旦不再报错,就是有人把裸词前缀重新放了进来。
    const widened: AuthWallExemption = { path: "login", semantics: "prefix", reason: "r" };
    void widened;
  });

  it("a ledger with an unbounded prefix never becomes a matcher at all", () => {
    // 把「无界前缀」按唯一还能表达它的方式塞进来(手写正则片段),生成器整条拒绝出片 ——
    // 不是产出一个带洞的 matcher,而是抛错。
    const withHole = [...AUTH_WALL_EXEMPTIONS, sound({ path: "api/newthing.*" })];
    expect(() => buildAuthWallMatcher(withHole)).toThrow();
  });
});

/* ──────────────────────────────────────────────────────────────────────────────
 * 零误伤 + 零悄悄扩大:app/ 下每一条真路由,机械枚举后对账。
 *
 * 地址不在这里手抄第二份(手抄的那份迟早和权威源各说各话)。枚举 app/ 的 page.tsx 与
 * route.ts,算出它们的 URL,问 matcher 每条是墙内还是墙外,再和一份**明确写下来的公开名单**
 * 逐字对齐。所以这一条测试同时钉住两件事:
 *   ① 今天真正在墙外的路由,一条都没被这次收口误伤;
 *   ② 将来在已豁免子树下长出的新路由(例如 app/legal/cookies/page.tsx),不会悄悄公开 ——
 *      它会让这条测试变红,逼人做一次决定。这正是 #901 复发三次的那个机制。
 * ────────────────────────────────────────────────────────────────────────────── */

/** 今天故意公开的路由,一条不多一条不少。改这份名单 = 决定让某条路由无会话可达。 */
const PUBLIC_APP_ROUTES = [
  "/api/better-auth/all/all",
  "/api/health",
  "/api/media/pub/token",
  "/api/meta/data-deletion",
  "/api/ops/dlq",
  "/api/ready",
  "/api/stripe/webhook",
  "/forgot-password",
  "/legal/data-deletion",
  "/login",
  "/privacy",
  "/privacy/bm",
  "/reset-password",
  "/signup",
  "/terms",
  "/verify-email",
];

describe("proxy — the wall vs every real route in app/ (#901 零误伤)", () => {
  it("exactly these real routes answer without a session — nothing more, nothing less", () => {
    const outsideTheWall = realRoutePaths()
      .filter((path) => !matcherRuns(path))
      .sort();
    expect(outsideTheWall).toEqual(PUBLIC_APP_ROUTES);
  });

  it("the enumeration actually found the app (guards against a silently empty walk)", () => {
    const all = realRoutePaths();
    expect(all.length).toBeGreaterThan(50);
    expect(all).toContain("/otto");
    expect(all).toContain("/");
  });

  it("the merchant-facing surfaces are all inside the wall", () => {
    for (const path of realRoutePaths()) {
      if (PUBLIC_APP_ROUTES.includes(path)) continue;
      expect(matcherRuns(path)).toBe(true);
    }
  });
});
