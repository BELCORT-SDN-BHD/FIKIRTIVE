/**
 * 认证墙豁免簿(#901 / #978)—— proxy.ts 那条负向前瞻正则的唯一权威来源。
 *
 * 病史:豁免簿从第一天起就是「一条手写的负向前瞻正则」,里面每一条都是**裸词前缀**。
 * 裸词前缀的意思是 `login` 这一条不只放行 `/login`,它同时放行 `/loginx`、`/login-help`、
 * `/login/anything` —— 任何以这几个字母开头的地址都从墙外走。这不是谁决定的,是写法带出来的。
 * 同一根缺陷复发过两次(#793 的 `api/ops/dlq`、#969 的 `verify-email`),两次都靠判官抓获,
 * 两次都只补了自己那一条。#901 实测点名的可绕过词形:`/api/healthz`、`/api/health-admin`、
 * `/api/readyz`、`/api/stripe-secret`、`/loginx`、`/legalese`。今天它们全 404,所以没有活洞;
 * 但任何一天这些前缀下长出新路由,它就静默裸奔。
 *
 * 根治:豁免不再是正则片段,而是**结构化声明** —— 每条写清路径、语义、理由。
 * 语义只有两种,并且**故意没有第三种**:
 *
 *   - `exact`   —— 就这一条路径(容忍尾斜杠)。生成 `<path>/?$`。
 *                  `<path>x` 与 `<path>/anything` 一律留在墙内。
 *   - `subtree` —— 这条路径**及其整棵子树**,边界钉在 `/` 分段处。生成 `<path>(?:/.*)?$`。
 *                  `<path>/anything` 出墙,但 `<path>x` 仍在墙内。
 *
 * 也就是说:**「裸词前缀」在这套类型里根本无法书写**。想放行一棵子树,只能声明 subtree,
 * 而 subtree 天生在分段边界上收口。这就是围栏本身,不是靠人记得加 `$`。
 *
 * Next 要求 `config.matcher` 是构建期可静态分析的**字面量**(proxy.md:「matcher values need to
 * be constants … Dynamic values such as variables will be ignored」),所以 proxy.ts 里那行必须
 * 保持手写字面量,不能在运行时用本文件拼出来。两者靠 lib/__tests__/proxy.test.ts 的围栏测试对齐:
 * 它断言 `config.matcher[0] === buildAuthWallMatcher()`。改了清单没同步字面量,或者绕过清单直接
 * 手改字面量,那条测试当场变红。
 */

export type AuthWallExemptionSemantics = "exact" | "subtree";

export type AuthWallExemption = {
  /** 不带前导斜杠的路径,例如 `api/health`。 */
  readonly path: string;
  /** `exact` = 只有这条路径;`subtree` = 这条路径加它下面的一切。没有第三种。 */
  readonly semantics: AuthWallExemptionSemantics;
  /** 这条路径凭什么可以无会话作答。留空视为缺陷,由 assertLedgerSound 拒绝。 */
  readonly reason: string;
};

/**
 * 顺序 = proxy.ts 字面量里的顺序。负向前瞻的各分支互不重叠,顺序不影响判定,
 * 但保持一致能让字面量的 diff 一眼可读。
 */
export const AUTH_WALL_EXEMPTIONS: readonly AuthWallExemption[] = [
  // 登录页本身。走到这里的人按定义就没有会话。app/login/ 下只有 page.tsx 一张页面。
  {
    path: "login",
    semantics: "exact",
    reason: "The sign-in page itself; whoever reaches it has no session yet.",
  },
  // signup / forgot-password / reset-password:#543 的自助门。这三张页面必须在无会话时渲染
  // —— 那正是它们存在的理由 —— 所以它们和 /login 一起待在墙外。它们自己不改任何状态;
  // 门后的每个动作都过 Better Auth 自己的闸(暂停开关、允许名单、验证、限流)。
  {
    path: "signup",
    semantics: "exact",
    reason: "#543 self-service door; must render without a session, mutates nothing itself.",
  },
  {
    path: "forgot-password",
    semantics: "exact",
    reason: "#543 self-service door; must render without a session, mutates nothing itself.",
  },
  {
    path: "reset-password",
    semantics: "exact",
    reason: "#543 self-service door; must render without a session, mutates nothing itself.",
  },
  // #940:注册验证邮件指向的落地页(lib/better-auth/verify-landing-url.ts 造这个链接)。
  // 点它的人按定义没有会话 —— 验证正是他拿到会话的方式。页面本身不持数据、不做判断,
  // 只把 token / callbackURL 原样转交给 /api/better-auth/verify-email(下面也在墙外),
  // token 在那里才被检验。#969 判官抓到它当初是裸词前缀,#973 已收成 exact,这里原样承接。
  {
    path: "verify-email",
    semantics: "exact",
    reason: "#940 verification landing page; the mail's reader has no session by definition.",
  },
  // B0-28:无座位分享链接(schedule/share-preview)。商家为自己的**一条**排期贴文铸一个只读链接
  // 发给没有账号的客户 —— 「不需要开户」正是这功能的全部意义,所以读者必然没有会话,墙会把
  // 每一个都弹去 /login。授权是链接自带的 HMAC token 加一行存活的 SharePreviewToken
  // (lib/share-preview.ts),每次加载都在服务端核验,任何失败都归一到同一张「不可用」页。
  // 页面只读 token 认证的那一条贴文,别无其它(lib/share-preview-view.ts)。收成 exact 是因为
  // /schedule 本身是商家自己的日历,必须留在墙内,这条子路径下面也不该再长出别的东西。
  {
    path: "schedule/share-preview",
    semantics: "exact",
    reason: "B0-28 seat-less share link for one scheduled post; its HMAC token plus a live "
      + "SharePreviewToken row (lib/share-preview.ts) is the sole authorization.",
  },
  // 公开法律页。app/terms/ 下只有 page.tsx,没有子页面(privacy 有 BM 版,terms 没有)。
  {
    path: "terms",
    semantics: "exact",
    reason: "Public terms page; app/terms/ holds page.tsx and nothing else.",
  },
  // 公开隐私告知,**两张**:app/privacy/page.tsx(英文)与 app/privacy/bm/page.tsx
  // (PDPA 双语要求的 Bahasa Malaysia 版,PR #486 决定清单)。BM 那张页面顶部的注释白纸黑字
  // 写着「免登录:proxy.ts 的 matcher 以 privacy 前缀放行,/privacy/bm 一并覆盖」。
  // 所以这条是真正的子树豁免,不能收成 exact —— #978 把它列进「统一收成 /?$」的十条是笔误,
  // 照做会把 /privacy/bm 关进墙里。
  {
    path: "privacy",
    semantics: "subtree",
    reason: "Public privacy notice in two languages: /privacy and /privacy/bm (PDPA bilingual).",
  },
  // #563:/legal/data-deletion 是报给 Meta 的 Data deletion URL
  // (app/api/meta/data-deletion/route.ts 回的就是 `${origin}/legal/data-deletion?code=…`)。
  // Meta 的审核员无会话打开它;一旦被弹去 /login,App Review 的 Data deletion 项直接不过。
  // 注意 app/legal/ 底下**没有** page.tsx —— 这条豁免存在的全部理由就是那棵子树,
  // 收成 exact 只会放行一个 404 并把真页面关进墙里。同样是 #978 十条里的笔误。
  {
    path: "legal",
    semantics: "subtree",
    reason: "#563 Meta Data deletion URL lives at /legal/data-deletion; /legal itself has no page.",
  },
  // api/better-auth 必须留在墙外 —— 否则登录 / OAuth 回调端点被墙 → 无限重定向 / 整站锁死。
  // (NextAuth 的 api/auth 路由已退役。)路由是 app/api/better-auth/[...all]/route.ts,
  // 一条 catch-all:整棵子树就是它的正常形状。
  {
    path: "api/better-auth",
    semantics: "subtree",
    reason: "Better Auth's [...all] catch-all; walling it means infinite redirect / total lockout.",
  },
  // Stripe webhook 无认证 —— Stripe 调它,签名就是它的认证。今天子树下只有
  // app/api/stripe/webhook/route.ts 一条。分段收口后 `/api/stripe-secret`(#901 点名)回到墙内。
  {
    path: "api/stripe",
    semantics: "subtree",
    reason: "Stripe's unauthenticated callbacks (webhook); the signature is their auth.",
  },
  // 外部 uptime 监控探它,只回 up/stale,不带任何数据。
  {
    path: "api/health",
    semantics: "exact",
    reason: "External uptime monitors probe it; answers up/stale only, no data.",
  },
  // #793:死信探针被同一批外部 uptime 服务拉取,它们没有会话。只回 clear/backed-up/unknown,
  // 没有计数、没有队列名、没有商家数据。r2(判官 r1 P1)把它从裸词前缀收成这条精确路径:
  // 裸词前缀当时同时开着 /api/ops/dlqx、/api/ops/dlq-admin、/api/ops/dlq/anything。
  {
    path: "api/ops/dlq",
    semantics: "exact",
    reason: "#793 dead-letter probe for external uptime services; clear/backed-up/unknown only.",
  },
  // #796:平台自己的部署 / 负载探针无会话调它,而且必须在容器被允许接流量之前作答。
  // 与 api/health 同一份零数据契约:ready true/false 加一个原因词,不涉及任何商家。
  {
    path: "api/ready",
    semantics: "exact",
    reason: "#796 platform deploy/load probe; ready true/false plus a reason word, no merchant data.",
  },
  // Codex 全 beta 审计 P1-012:发布身份(web sha/ref、逐班 worker 短 sha、迁移 id、外加
  // web.startedAt/worker[].at/migrations.appliedAt 三个时间戳)必须能被无会话的运维流程
  // 读到——这正是它存在的理由(核对一次修复到底在哪次部署上验的)。判官四轮 P1-1:这**不是**
  // api/health 那份「只报状态词、不报时间戳」的零数据契约(app/api/health/route.ts:5、:33)——
  // 本端点如实报时间戳,因为「这一班 worker 什么时候活着」「库迁移什么时候跑完」这两件事
  // 本身就是发布身份要核对的东西,藏起来这个端点就白建了。仍然零敏感字段:不含
  // configFingerprint、env 变量名或任何商家数据(见 lib/build-info.ts)。
  {
    path: "api/build-info",
    semantics: "exact",
    reason: "P1-012 release identity probe; exposes web sha/ref, per-worker short sha, migration id, and three diagnostic timestamps (web.startedAt/worker[].at/migrations.appliedAt) — not api/health's status-word-only contract, but still no configFingerprint or merchant data.",
  },
  // Meta 无认证调它,signed_request 就是它的认证。app/api/meta/data-deletion/ 下只有 route.ts,
  // 没有任何子回调(同级的 api/meta/authorize 与 api/meta/callback 是各自独立的路径,本来就在墙内)。
  {
    path: "api/meta/data-deletion",
    semantics: "exact",
    reason: "Meta calls it unauthenticated; the signed_request is its auth. No sub-callbacks exist.",
  },
  // 两个调用方永远都没有会话:Meta 的异步取媒体服务器,以及 B0-28 的无座位分享预览页
  // (它渲染 <img src="/api/media/pub/<signed token>">,见 lib/share-preview-view.ts)。
  // 路由的 HMAC token(签名覆盖 ownerId+key+expiry)是它**唯一**的授权;verifyMediaToken
  // 对任何坏 / 过期 / 伪造的 token 一律 fail-close 成 404。路由是
  // app/api/media/pub/[token]/route.ts,子树是它的正常形状。
  {
    path: "api/media/pub",
    semantics: "subtree",
    reason: "Two callers, both sessionless by construction: Meta's async media fetcher and the "
      + "B0-28 share-preview page's own <img> tag; the route's HMAC token is the sole authorization "
      + "for either.",
  },
  // Next 构建产物与图片优化器。没有 matcher 时 proxy 会跑在它们身上,静态资源会被认证逻辑挡住。
  {
    path: "_next/static",
    semantics: "subtree",
    reason: "Next build output; walling it blocks CSS/JS from loading.",
  },
  {
    path: "_next/image",
    semantics: "subtree",
    reason: "Next image optimizer; walling it blocks images from loading.",
  },
  // app/favicon.ico(Next 的 metadata 文件约定)。
  {
    path: "favicon.ico",
    semantics: "exact",
    reason: "app/favicon.ico, served as a static asset before any session exists.",
  },
];

/**
 * 路径的合法形状:分段以字母 / 数字 / 下划线开头,段内只允许字母数字与 `.`、`_`、`-`,
 * 分段之间单个 `/`,不带前导或尾随斜杠。
 *
 * 这条正则是围栏里承重的一根:它让**正则元字符进不了清单**。豁免簿之所以会腐烂成
 * 一条手写正则,就是因为当初可以往里塞 `.*`、`|`、`(?!`。现在塞不进去了 —— 想放行一棵子树
 * 只能声明 `semantics: "subtree"`,由生成器决定边界长什么样。
 */
const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;

/** 把一条豁免翻译成负向前瞻里的一个分支。 */
export function exemptionPattern(exemption: AuthWallExemption): string {
  // SAFE_PATH 已经挡掉了除 `.` 以外的全部正则元字符,`.` 在这里必须转义
  // (否则 `favicon.ico` 会顺带放行 `faviconXico`)。
  const literal = exemption.path.replace(/\./g, "\\.");
  return exemption.semantics === "exact" ? `${literal}/?$` : `${literal}(?:/.*)?$`;
}

/** 清单自身的体检。任何一条不合格就抛错 —— 生成器拒绝为坏清单产出 matcher。 */
export function assertLedgerSound(exemptions: readonly AuthWallExemption[]): void {
  if (exemptions.length === 0) {
    throw new Error("auth-wall ledger: refusing an empty ledger — the wall would swallow /login");
  }
  const seen = new Set<string>();
  for (const exemption of exemptions) {
    const { path, reason } = exemption;
    if (!SAFE_PATH.test(path)) {
      throw new Error(
        `auth-wall ledger: unsafe exemption path ${JSON.stringify(path)} — a path is plain path `
          + "segments only (no leading/trailing slash, no regex metacharacters). Reach for "
          + 'semantics: "subtree" instead of hand-writing a pattern.',
      );
    }
    if (reason.trim().length === 0) {
      throw new Error(
        `auth-wall ledger: exemption ${JSON.stringify(path)} has no stated reason — every path that `
          + "answers without a session needs one on the record.",
      );
    }
    if (seen.has(path)) {
      throw new Error(`auth-wall ledger: duplicate exemption path ${JSON.stringify(path)}`);
    }
    seen.add(path);
  }
}

/**
 * 由清单生成 proxy.ts 那行 matcher 字面量。
 *
 * 这个函数**不在运行时被 proxy.ts 调用**(Next 要求 matcher 静态可分析)。它的读者是
 * lib/__tests__/proxy.test.ts 的围栏测试,那条测试断言生成结果与 proxy.ts 里的字面量逐字节相等。
 */
export function buildAuthWallMatcher(
  exemptions: readonly AuthWallExemption[] = AUTH_WALL_EXEMPTIONS,
): string {
  assertLedgerSound(exemptions);
  return `/((?!${exemptions.map(exemptionPattern).join("|")}).*)`;
}
