/**
 * env-contract — 生产 env 的单一权威清单(#797,工程评估债 #8)。
 *
 * 病因:49 个 env 变量没有任何开机契约。漏配一个,进程照样起来,然后在某条业务路径上
 * 变成一个查不出来的怪病——发布静默失败、图片写去容器本地盘、退款事务里才发现钥匙不在。
 * 每一次都是「跑起来了」和「配对了」被当成同一件事。
 *
 * 这个文件把「代码要求什么」写成数据,于是三件事第一次可以互相对账:
 *   ① 代码里读的 env(process.env.X)                — 扫描源码
 *   ② 本契约声明的 env(ENV_CONTRACT)               — 本文件
 *   ③ .env.example 里写给人看的 env                  — 仓库根
 * 三者任何一方漂移,env-contract.test.ts 就红。文档不再靠自觉。
 *
 * 三条刻意的设计选择,每条都为了「不制造新的停机」:
 *
 *   1. **格式永远校验,存在性只在生产要求。** 值写错(64 位密钥写成 63 位、URL 少了协议)
 *      在任何环境都是硬错——那是纯粹的打字错误,早失败一定比晚失败便宜。但「没设」在
 *      dev/CI 里是正常状态(本仓库大量能力上线前刻意 inert),所以缺失只在
 *      NODE_ENV=production 时才致命。
 *
 *   2. **条件依赖是主角。** 真正让人流血的不是全空,是半配——GENERATION_PROVIDER=byteplus
 *      却没有 key,STORAGE_DRIVER=r2 却少一个 R2_*。全空 = 刻意 inert,半配 = 有人试过但漏了。
 *      contract 直接把这种「一开就必须全开」的组关系写下来。
 *
 *   3. **永远只报变量名,绝不回显值。** 报错信息、日志、指纹,任何一处都不允许出现密钥内容。
 *
 * 指纹(债 #6 的另一半)见本文件末尾 configFingerprint():web 与 worker 各自算一次,
 * 两边对不上就是「两个进程跑在不同配置上」,admin 亮红。
 */
import { createHmac } from "node:crypto";
import { z } from "zod";

/** 谁读这个变量。both = web 与 worker 都读(其中 shared 的还必须是同一个值)。 */
export type EnvSurface = "web" | "worker" | "both";

/**
 * 这个变量事实上由谁读进来。契约测试按此断言:
 *   code     — 变量名在产品源码里逐字出现(process.env.X 或解构)。
 *   library  — 第三方 SDK 在 node_modules 里读,仓库源码里看不到名字。
 *   platform — 运行平台注入(Railway 的 git 元数据),仓库永远不设置它。
 *   none     — 文档里写着,但今天没有任何代码读它。保留这个取值就是为了让「过期的
 *              文档条目」有地方被诚实登记,而不是伪装成生效中的配置。
 */
export type EnvReadBy = "code" | "library" | "platform" | "none";

/** 要求强度。conditional = 只在 `when` 描述的条件成立时才必须存在。 */
export type EnvRequirement = "required" | "conditional" | "optional";

export type EnvFormat =
  | "hex64"
  | "url"
  | "postgres-url"
  | "email-list"
  | "integer"
  | "number"
  | "boolean-ish"
  | "enum"
  | "free";

export type EnvVarSpec = {
  name: string;
  surface: EnvSurface;
  readBy: EnvReadBy;
  requirement: EnvRequirement;
  format: EnvFormat;
  /** enum 的合法取值(format === "enum" 时必填)。 */
  values?: readonly string[];
  /** conditional 的条件:同一 env 下这个谓词为真时,本变量必须存在。 */
  requiredWhen?: (env: EnvRecord) => boolean;
  /** 条件的人话描述,进报错信息。 */
  when?: string;
  /** 密钥:值永不进日志,进指纹时先 HMAC。 */
  secret: boolean;
  /**
   * web 与 worker 必须携带同一个值。这些变量构成部署指纹——两个服务的指纹不同,
   * 就是两边跑在不同配置上(#569 那一类:worker 的 TOKEN_ENCRYPTION_KEY 与 web 的
   * 不是同一把,发布链每次都在解密那一步静默失败)。
   */
  shared: boolean;
  /** 一行说明,渲染进 .env.example 的生成片段。 */
  summary: string;
};

export type EnvRecord = Record<string, string | undefined>;

const isSet = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";

/** 生成 provider 选了要花钱的那一个。 */
const providerIs = (want: string) => (env: EnvRecord) => (env.GENERATION_PROVIDER ?? "").trim() === want;

/** 对象存储切到 R2:四件套必须齐,少一件 createStorage 直接抛。 */
const storageIsR2 = (env: EnvRecord) => (env.STORAGE_DRIVER ?? "").trim() === "r2";

/**
 * ENV_CONTRACT — 权威清单。新增任何 env 读取,必须同时在这里登记,否则测试红。
 *
 * 排序即分组:核心运行时 → 认证 → 密钥 → 平台集成 → 生成 → 存储 → 计费 → LLM → 可选。
 */
export const ENV_CONTRACT: readonly EnvVarSpec[] = [
  // ── 数据库 ────────────────────────────────────────────────────────────────
  {
    name: "DATABASE_URL",
    surface: "both",
    readBy: "code",
    requirement: "required",
    format: "postgres-url",
    secret: true,
    shared: false, // web 走 pooled、worker 走 direct 是刻意的,两边不必相同
    summary: "Postgres connection string. Worker prefers this direct URL; web prefers the pooled one.",
  },
  {
    name: "DATABASE_URL_POOLED",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "postgres-url",
    secret: true,
    shared: false,
    summary: "Pooled (PgBouncer) endpoint the web runtime prefers. Falls back to DATABASE_URL.",
  },
  {
    name: "DB_POOL_MAX",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "integer",
    secret: false,
    shared: false,
    summary: "pg Pool max per process (defaults to 10). replicas × max must stay under the provider budget.",
  },

  // ── 认证 ──────────────────────────────────────────────────────────────────
  {
    name: "BETTER_AUTH_SECRET",
    surface: "web",
    readBy: "code",
    requirement: "required",
    format: "free",
    secret: true,
    shared: false,
    summary: "Session signing secret (openssl rand -base64 32). Also signs the Meta OAuth state.",
  },
  {
    name: "BETTER_AUTH_URL",
    surface: "both",
    readBy: "code",
    requirement: "required",
    format: "url",
    secret: false,
    // 刻意 NOT shared:worker 只把它当 media-proxy 回源 origin 的兜底,生产上 worker 常常
    // 只配 PUBLIC_BASE_URL。把它算进指纹会制造一条永远亮红的假警报。
    shared: false,
    summary: "Canonical origin sessions and callbacks bind to.",
  },
  {
    name: "NEXT_PUBLIC_BETTER_AUTH_URL",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "url",
    secret: false,
    shared: false,
    summary: "Public origin the browser client talks to.",
  },
  {
    name: "GOOGLE_CLIENT_ID",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Google OAuth app id.",
  },
  {
    name: "GOOGLE_CLIENT_SECRET",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: true,
    shared: false,
    summary: "Google OAuth app secret.",
  },
  {
    name: "AUTH_ALLOWED_EMAILS",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "email-list",
    secret: false,
    shared: false,
    summary: "Comma-separated invite/back-door allowlist (the DB AllowedEmail table is the other half).",
  },
  {
    name: "FOUNDER_ADMIN_EMAILS",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "email-list",
    secret: false,
    shared: false,
    summary: "Comma-separated founder emails seeded to super-admin on sign-in.",
  },
  {
    name: "AUTH_ENABLED",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "boolean-ish",
    secret: false,
    shared: false,
    summary: "Perimeter wall. In production it is ON unless explicitly \"false\".",
  },
  {
    name: "SIGNUPS_PAUSED",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Emergency stop for new self-service signups. Any value other than 0/false/off/no pauses them.",
  },
  {
    name: "RESEND_API_KEY",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: true,
    shared: false,
    summary: "Magic-link sender (resend.com). Production sign-in email throws without it.",
  },
  {
    name: "AUTH_EMAIL_FROM",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Verified Resend sender address for auth email.",
  },

  // ── 共享密钥(web 与 worker 必须同值)────────────────────────────────────
  {
    name: "TOKEN_ENCRYPTION_KEY",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "hex64",
    secret: true,
    shared: true,
    summary: "AES-256-GCM key for Meta tokens at rest (openssl rand -hex 32). Web encrypts, worker decrypts — same value or publishing fails.",
  },
  {
    name: "MEDIA_PROXY_SECRET",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "hex64",
    secret: true,
    shared: true,
    summary: "HMAC key for the signed media proxy. Worker signs, web verifies — a mismatch 404s every published post's media.",
  },
  {
    name: "SHARE_PREVIEW_SECRET",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "hex64",
    secret: true,
    shared: false,
    summary: "HMAC key for share-preview links. Deliberately separate from MEDIA_PROXY_SECRET.",
  },
  {
    name: "PUBLIC_BASE_URL",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "url",
    secret: false,
    shared: false,
    summary: "Public origin the platform fetches published media from. Falls back to BETTER_AUTH_URL.",
  },

  // ── Meta ─────────────────────────────────────────────────────────────────
  {
    name: "META_APP_ID",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Meta app id.",
  },
  {
    name: "META_APP_SECRET",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: true,
    shared: false,
    summary: "Meta app secret. Also verifies data-deletion callbacks.",
  },
  {
    name: "META_LOGIN_CONFIG_ID",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Facebook Login for Business configuration id (the permission set lives in the Meta dashboard).",
  },
  {
    name: "META_GRAPH_MOCK",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Dev only: \"1\" serves canned Meta Graph responses.",
  },
  {
    name: "APP_ORIGIN",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "url",
    secret: false,
    shared: false,
    summary: "Origin printed on the Meta data-deletion confirmation page. Falls back to the request origin.",
  },

  // ── 生成 provider(花钱)──────────────────────────────────────────────────
  {
    name: "GENERATION_PROVIDER",
    // worker-only in fact: only packages/generation reads it, and only the worker depends on
    // that package. Declaring it "both" would put it in the fingerprint and light a permanent
    // false red, because the web service has no reason to carry it.
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "enum",
    values: ["mock", "byteplus", "fal"],
    secret: false,
    shared: false,
    summary: "mock ($0, default) | byteplus | fal. Anything unrecognized resolves to mock so a misconfigured deploy cannot burn money.",
  },
  {
    name: "BYTEPLUS_API_KEY",
    surface: "worker",
    readBy: "code",
    requirement: "conditional",
    requiredWhen: providerIs("byteplus"),
    when: "GENERATION_PROVIDER=byteplus",
    format: "free",
    secret: true,
    shared: false,
    summary: "BytePlus Ark key. Required when the byteplus provider is selected.",
  },
  {
    name: "FAL_KEY",
    surface: "worker",
    readBy: "code",
    requirement: "conditional",
    requiredWhen: providerIs("fal"),
    when: "GENERATION_PROVIDER=fal",
    format: "free",
    secret: true,
    shared: false,
    summary: "fal.ai key. Required when the fal provider is selected.",
  },
  {
    name: "OTTO_DEFAULT_VIDEO_MODEL",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Video model override. Only margin-floored models are honored; anything else degrades to the code default.",
  },
  {
    name: "OTTO_LLM_MARGIN",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "number",
    secret: false,
    shared: false,
    summary: "LLM pricing margin override.",
  },

  // ── 对象存储 ──────────────────────────────────────────────────────────────
  {
    name: "STORAGE_DRIVER",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "enum",
    values: ["local", "r2"],
    secret: false,
    shared: true,
    summary: "local (disk, dev only) | r2. Production must be r2 — local disk in production scatters files across containers.",
  },
  {
    name: "R2_ENDPOINT",
    surface: "both",
    readBy: "code",
    requirement: "conditional",
    requiredWhen: storageIsR2,
    when: "STORAGE_DRIVER=r2",
    format: "url",
    secret: false,
    shared: true,
    summary: "R2 S3-compatible endpoint.",
  },
  {
    name: "R2_ACCESS_KEY_ID",
    surface: "both",
    readBy: "code",
    requirement: "conditional",
    requiredWhen: storageIsR2,
    when: "STORAGE_DRIVER=r2",
    format: "free",
    secret: true,
    shared: false,
    summary: "R2 access key id.",
  },
  {
    name: "R2_SECRET_ACCESS_KEY",
    surface: "both",
    readBy: "code",
    requirement: "conditional",
    requiredWhen: storageIsR2,
    when: "STORAGE_DRIVER=r2",
    format: "free",
    secret: true,
    shared: false,
    summary: "R2 secret access key.",
  },
  {
    name: "R2_BUCKET",
    surface: "both",
    readBy: "code",
    requirement: "conditional",
    requiredWhen: storageIsR2,
    when: "STORAGE_DRIVER=r2",
    format: "free",
    secret: false,
    shared: true,
    summary: "Exact bucket for this environment. Web and worker must agree or each writes somewhere the other cannot read.",
  },
  {
    name: "R2_FORCE_PATH_STYLE",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "boolean-ish",
    secret: false,
    shared: false,
    summary: "\"false\" disables path-style addressing (local MinIO verification).",
  },
  {
    name: "FIKIRTIVE_DATA_DIR",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Worker local storage root when the driver is local disk.",
  },

  // ── 计费 ──────────────────────────────────────────────────────────────────
  {
    name: "STRIPE_SECRET_KEY",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: true,
    shared: false,
    summary: "Stripe secret key (sk_live_… in production).",
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    surface: "web",
    readBy: "code",
    requirement: "conditional",
    requiredWhen: (env) => isSet(env.STRIPE_SECRET_KEY),
    when: "STRIPE_SECRET_KEY is set",
    format: "free",
    secret: true,
    shared: false,
    summary: "Webhook signing secret. The signature IS the authentication — wrong value means every credit grant 400s.",
  },

  // ── LLM / 搜索 ────────────────────────────────────────────────────────────
  {
    name: "ANTHROPIC_API_KEY",
    surface: "both",
    readBy: "library",
    requirement: "optional",
    format: "free",
    secret: true,
    shared: false,
    summary: "Read by @ai-sdk/anthropic inside packages/otto. Required for the Otto loop.",
  },
  {
    name: "ANTHROPIC_BASE_URL",
    surface: "both",
    readBy: "library",
    requirement: "optional",
    format: "url",
    secret: false,
    shared: false,
    summary: "Optional gateway base URL for the Anthropic SDK.",
  },
  {
    name: "OTTO_PROMPT_CACHE",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "boolean-ish",
    secret: false,
    shared: false,
    summary: "Prompt-cache toggle for the Otto model wrapper.",
  },
  {
    name: "TAVILY_API_KEY",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: true,
    shared: false,
    summary: "Primary web-search provider for the Otto research skill.",
  },
  {
    name: "BRAVE_SEARCH_API_KEY",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: true,
    shared: false,
    summary: "Fallback web-search provider.",
  },

  // ── 旧 cowork 规划器 ──────────────────────────────────────────────────────
  {
    name: "COWORK_PROVIDER",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "enum",
    values: ["mock", "fal", "modal"],
    secret: false,
    shared: false,
    summary: "Legacy cowork planner transport.",
  },
  {
    name: "COWORK_PAID_PROVIDERS_ALLOWED",
    surface: "web",
    readBy: "none",
    requirement: "optional",
    format: "boolean-ish",
    secret: false,
    shared: false,
    summary:
      "Documented but READ BY NOTHING today — effectiveCoworkProvider() has no production caller, so the paid planner is off by construction, not by this flag. Kept declared so the stale doc entry is visible instead of looking live.",
  },
  {
    name: "MODAL_LLM_ENDPOINT",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "url",
    secret: false,
    shared: false,
    summary: "Modal transport endpoint for the legacy cowork planner.",
  },
  {
    name: "MODAL_LLM_KEY",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: true,
    shared: false,
    summary: "Modal transport key.",
  },
  {
    name: "COWORK_VISION_ENABLED",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "boolean-ish",
    secret: false,
    shared: false,
    summary: "Vision kill-switch for the cowork planner. false is a hard override the DB cannot countermand.",
  },
  {
    name: "COWORK_VISION_MAX_IMAGES",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "integer",
    secret: false,
    shared: false,
    summary: "Vision image cap (clamped in code).",
  },
  {
    name: "COWORK_VISION_MAX_BYTES",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "integer",
    secret: false,
    shared: false,
    summary: "Vision byte cap (clamped in code).",
  },

  // ── worker 专属 ───────────────────────────────────────────────────────────
  {
    name: "WHISPER_MODEL_DIR",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Directory holding the whisper.cpp model. DIRECTORY only — the filename is derived in code.",
  },
  {
    name: "WHISPER_THREADS",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "integer",
    secret: false,
    shared: false,
    summary: "whisper.cpp thread count.",
  },
  {
    name: "WHISPER_MAX_SECONDS",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "integer",
    secret: false,
    shared: false,
    summary: "Caption job duration ceiling.",
  },

  // ── 运维可见性 ────────────────────────────────────────────────────────────
  {
    name: "SENTRY_DSN",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "url",
    secret: false,
    shared: false,
    summary: "Error monitoring. Everything is a no-op when unset.",
  },
  {
    name: "BYTEPLUS_RESOURCE_PACK_USD",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "number",
    secret: false,
    shared: false,
    summary: "Prepaid generation-capacity value on an effective-cost basis, for the admin capacity signal.",
  },
  {
    name: "BYTEPLUS_RESOURCE_PACK_USED_USD",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "number",
    secret: false,
    shared: false,
    summary: "Console-read used amount. Unset means admin estimates from frozen spend snapshots.",
  },
  {
    name: "BYTEPLUS_RESOURCE_PACK_ALERT_PCT",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "number",
    secret: false,
    shared: false,
    summary: "Remaining-capacity percentage at or below which the admin panel warns.",
  },
  {
    name: "FIKIRTIVE_ENV_CONTRACT",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "enum",
    values: ["enforce", "warn"],
    secret: false,
    shared: false,
    summary:
      "Boot-check mode. Default enforce: a production process with contract problems exits instead of serving. \"warn\" logs and starts anyway — the escape hatch for the case where the CHECK is what is wrong, so a launch gate can never brick production with no way out.",
  },
  {
    name: "NODE_ENV",
    surface: "both",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Node environment. \"production\" is what turns presence requirements from warnings into hard failures.",
  },

  // ── 平台注入(仓库永不设置)────────────────────────────────────────────────
  {
    name: "NEXT_PHASE",
    surface: "web",
    readBy: "platform",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary:
      "Set by Next.js itself. \"phase-production-build\" means this is a BUILD, not a serving process — the boot check downgrades to a warning there, because a build machine has no reason to hold production secrets.",
  },
  {
    name: "NEXT_RUNTIME",
    surface: "web",
    readBy: "platform",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary:
      "Set by Next.js itself: \"nodejs\" or \"edge\". The boot check only runs on the Node server — the edge runtime sees a different slice of the environment.",
  },
  {
    name: "RAILWAY_GIT_COMMIT_SHA",
    surface: "both",
    readBy: "platform",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary:
      "Injected by the host at deploy time. Web and worker each report it on the deploy-fingerprint row; two different values mean the two services are running different code.",
  },
] as const;

/** 名字 → spec,便于查表。 */
export const ENV_CONTRACT_BY_NAME: ReadonlyMap<string, EnvVarSpec> = new Map(
  ENV_CONTRACT.map((spec) => [spec.name, spec]),
);

/* ────────────────────────── 格式校验 ────────────────────────── */

const HEX64 = /^[0-9a-fA-F]{64}$/;

/** 每种 format 的 zod 校验器。只在变量「有值」时跑——空值的处理是存在性那一层的事。 */
function formatSchema(spec: EnvVarSpec): z.ZodType<unknown> {
  switch (spec.format) {
    case "hex64":
      return z.string().regex(HEX64, "must be exactly 64 hex characters (openssl rand -hex 32)");
    case "url":
      return z.string().refine((v) => {
        try {
          const u = new URL(v);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      }, "must be an absolute http(s) URL");
    case "postgres-url":
      return z.string().refine((v) => {
        try {
          const u = new URL(v);
          return u.protocol === "postgres:" || u.protocol === "postgresql:";
        } catch {
          return false;
        }
      }, "must be a postgres:// or postgresql:// URL");
    case "email-list":
      return z
        .string()
        .refine(
          (v) =>
            v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .every((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)),
          "must be a comma-separated list of email addresses",
        );
    case "integer":
      return z.string().refine((v) => /^\d+$/.test(v.trim()), "must be a non-negative integer");
    case "number":
      return z.string().refine((v) => Number.isFinite(Number(v.trim())) && v.trim() !== "", "must be a number");
    case "boolean-ish":
      return z
        .string()
        .refine(
          (v) => ["true", "false", "1", "0", "yes", "no", "on", "off"].includes(v.trim().toLowerCase()),
          "must be true/false (1/0, yes/no, on/off also accepted)",
        );
    case "enum":
      return z.string().refine((v) => (spec.values ?? []).includes(v.trim()), `must be one of: ${(spec.values ?? []).join(", ")}`);
    case "free":
      return z.string().min(1, "must not be empty");
  }
}

export type EnvProblemKind = "missing" | "conditional-missing" | "invalid";

export type EnvProblem = {
  name: string;
  kind: EnvProblemKind;
  /** 人话说明。永远只含变量名与规则,绝不含值。 */
  message: string;
};

export type CheckEnvOptions = {
  /** 检查哪一侧的变量。worker 不需要 web-only 的变量,反之亦然。 */
  surface: "web" | "worker";
  /** true 时缺失也是问题;false 时只报格式错误。 */
  production: boolean;
};

const appliesTo = (spec: EnvVarSpec, surface: "web" | "worker") => spec.surface === "both" || spec.surface === surface;

/**
 * 检查一份 env 是否满足契约。纯函数,不读 process、不抛异常、不回显任何值。
 *
 * 返回的 problems 为空 = 通过。顺序稳定(按契约声明顺序),便于测试与日志对齐。
 */
export function checkEnv(env: EnvRecord, opts: CheckEnvOptions): EnvProblem[] {
  const problems: EnvProblem[] = [];
  for (const spec of ENV_CONTRACT) {
    if (!appliesTo(spec, opts.surface)) continue;
    // platform / library 读取的变量不参与存在性判定:前者由宿主注入,后者的缺失由 SDK 自己报。
    const raw = env[spec.name];
    const present = isSet(raw);

    if (!present) {
      if (!opts.production) continue;
      if (spec.requirement === "required" && spec.readBy === "code") {
        problems.push({ name: spec.name, kind: "missing", message: `${spec.name} is required in production but is not set` });
      } else if (spec.requirement === "conditional" && spec.requiredWhen?.(env)) {
        problems.push({
          name: spec.name,
          kind: "conditional-missing",
          message: `${spec.name} is required because ${spec.when} — set it, or unset the thing that turned it on`,
        });
      }
      continue;
    }

    const parsed = formatSchema(spec).safeParse(raw);
    if (!parsed.success) {
      const reason = parsed.error.issues[0]?.message ?? "has an invalid value";
      problems.push({ name: spec.name, kind: "invalid", message: `${spec.name} ${reason}` });
    }
  }
  return problems;
}

/**
 * 把问题列表渲染成一段可以直接贴进日志的报告。永不含值。
 * 调用方决定这是 warn 还是 exit——core 不替进程做生死决定。
 */
export function formatEnvProblems(problems: readonly EnvProblem[], surface: "web" | "worker"): string {
  const lines = problems.map((p) => `  • ${p.message}`);
  return [
    `[env-contract] ${problems.length} problem(s) with the ${surface} environment:`,
    ...lines,
    `  See .env.example and packages/core/src/env-contract.ts. Values are never printed.`,
  ].join("\n");
}

/* ────────────────────────── 开机决策 ────────────────────────── */

export type BootEnvDecision =
  | { action: "ok" }
  | { action: "warn"; report: string; problems: EnvProblem[] }
  | { action: "exit"; report: string; problems: EnvProblem[] };

/**
 * 开机时该怎么办。纯函数——决定写在这里,执行(console / process.exit)留给各自的宿主,
 * 于是 web 与 worker 的行为逐字相同,而 core 不替任何进程做生死决定。
 *
 * 规则:
 *   - 没问题 → ok。
 *   - 非生产 → 一律 warn。上线前大量能力刻意 inert,dev/CI 缺配置是正常态,
 *     把开发者的机器搞得起不来只会让人把整个检查关掉。
 *   - 生产 → exit,除非 FIKIRTIVE_ENV_CONTRACT=warn 明确要求降级。
 */
export function bootEnvDecision(env: EnvRecord, opts: CheckEnvOptions): BootEnvDecision {
  const problems = checkEnv(env, opts);
  if (problems.length === 0) return { action: "ok" };
  const report = formatEnvProblems(problems, opts.surface);
  const mode = (env.FIKIRTIVE_ENV_CONTRACT ?? "").trim().toLowerCase();
  if (!opts.production || mode === "warn") return { action: "warn", report, problems };
  return { action: "exit", report, problems };
}

/* ────────────────────────── .env.example 生成 ────────────────────────── */

/** 需要出现在 .env.example 里的变量:平台注入的除外(仓库永远不设置它们)。 */
export function documentedVars(): EnvVarSpec[] {
  return ENV_CONTRACT.filter((spec) => spec.readBy !== "platform");
}

/**
 * 为指定变量渲染 .env.example 片段。
 *
 * 刻意不整篇重生成 .env.example:那份文件里的上下文注释(为什么两边必须同值、
 * 漏配会怎么坏)是人写给人的资产,机器重写一次就没了。所以生成的是「缺哪几行、
 * 该长什么样」——契约测试发现漂移时把这段贴进报错,人复制粘贴即可。
 */
export function renderEnvExampleLines(specs: readonly EnvVarSpec[]): string {
  return specs
    .map((spec) => {
      const req =
        spec.requirement === "required"
          ? "REQUIRED"
          : spec.requirement === "conditional"
            ? `REQUIRED when ${spec.when}`
            : "optional";
      const prefix = spec.requirement === "required" ? "" : "# ";
      return `# ${req} · ${spec.surface} · ${spec.summary}\n${prefix}${spec.name}=""`;
    })
    .join("\n");
}

/* ────────────────────────── 配置指纹 ────────────────────────── */

/**
 * 域分隔常量。这不是密钥,也没打算当密钥用——指纹的输入里没有任何明文密钥值
 * (密钥先被 HMAC 成 8 位摘要才参与),所以这里要的是「本用途专属」而不是「保密」。
 * 两个进程必须用同一个常量,否则指纹永远对不上,那才是真正的故障。
 */
const FINGERPRINT_DOMAIN = "fikirtive/config-fingerprint/v1";

const digest8 = (input: string): string =>
  createHmac("sha256", FINGERPRINT_DOMAIN).update(input).digest("hex").slice(0, 8);

/** 进入指纹的变量:web 与 worker 必须携带同一个值的那一批。 */
export const FINGERPRINT_VARS: readonly string[] = ENV_CONTRACT.filter((s) => s.shared)
  .map((s) => s.name)
  .sort();

/**
 * 计算配置指纹:8 位十六进制。
 *
 * 输入的构造方式决定了它能抓什么:
 *   - 密钥类变量进的是 HMAC 后的 8 位摘要。于是「web 与 worker 拿的不是同一把
 *     TOKEN_ENCRYPTION_KEY」会让指纹不同(这正是 #569 那一类静默失败的形状),
 *     而 32 位摘要反推不出 256 位密钥,泄漏面为零。
 *   - 非密钥变量(provider、bucket、driver)进的是明文值——它们本来就不是秘密,
 *     明文让指纹在人眼里也可解释。
 *   - 未设置的变量进的是空串,所以「一边设了一边没设」同样会让指纹不同。
 *
 * 指纹只在鉴权后的 admin 面里显示,不进 /api/health 这类匿名端点。
 */
export function configFingerprint(env: EnvRecord): string {
  const canonical = FINGERPRINT_VARS.map((name) => {
    const spec = ENV_CONTRACT_BY_NAME.get(name);
    const raw = env[name];
    const value = isSet(raw) ? raw.trim() : "";
    const encoded = value === "" ? "" : spec?.secret ? digest8(value) : value;
    return `${name}=${encoded}`;
  }).join("\n");
  return digest8(canonical);
}

/** 本进程正在跑的 commit。平台注入;没有就是 null,绝不假造一个。 */
export function commitShaFrom(env: EnvRecord): string | null {
  const raw = env.RAILWAY_GIT_COMMIT_SHA;
  return isSet(raw) ? raw.trim() : null;
}

/** 短 sha,给人看。null 进 null 出。 */
export function shortSha(sha: string | null): string | null {
  return sha ? sha.slice(0, 8) : null;
}
