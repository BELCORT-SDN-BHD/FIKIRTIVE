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
  /**
   * 生产环境下这个变量只允许取这几个值(未列的取值在生产是硬错,在 dev/CI 照旧合法)。
   *
   * 存在的理由:有些开关的**默认档就是一个只在开发机上成立的形状**。STORAGE_DRIVER 是标准
   * 例子——不设或设成 local,工厂落 LocalDiskStorage,文件写进容器自己的盘,容器一换就没了。
   * 那是「跑起来了、也没报错、但生产形状是错的」,正是这张票要消灭的东西。格式合法与生产可用
   * 是两件事,所以分成两个字段。
   */
  productionValues?: readonly string[];
  /** productionValues 的人话理由,进报错信息。 */
  productionReason?: string;
  /** 一行说明,渲染进 .env.example 的生成片段。 */
  summary: string;
};

export type EnvRecord = Record<string, string | undefined>;

const isSet = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";

// 下面两个谓词逐字比较、**不做 trim**,和消费方一模一样
// (packages/generation 的 `process.env.GENERATION_PROVIDER === "fal"`、
//  packages/storage 的 `process.env.STORAGE_DRIVER === "r2"`)。
// 契约在这里替代码做规范化,就等于开始描述一个代码并不存在的行为。带空白的值由上面那条
// 通用空白守卫直接判错,不会走到这里。

/** 生成 provider 选了要花钱的那一个。 */
const providerIs = (want: string) => (env: EnvRecord) => (env.GENERATION_PROVIDER ?? "") === want;

/** 对象存储切到 R2:四件套必须齐,少一件 createStorage 直接抛。 */
const storageIsR2 = (env: EnvRecord) => (env.STORAGE_DRIVER ?? "") === "r2";

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
    // #795 —— 谁被限流器计数。取值空间是开放的(railway | xff:<hops> | dev),不是定值枚举,
    // 所以格式是 free;取值合法性由 apps/web/lib/caller-identity.ts 在开机时自己判(不认识的值
    // 拒绝启动,生产上的 "dev" 也拒绝)。契约不复述那条规则,只登记这个变量存在、谁读。
    name: "CALLER_IP_SOURCE",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Which header carries a trustworthy caller address: railway | xff:<hops> | dev. Unset = railway in production, dev elsewhere. Checked at boot — an unrecognised value refuses to start.",
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
    // 生产必填。不设 = 走 LocalDiskStorage,商家的每一张图、每一段视频写进容器自己的盘,
    // 下一次部署换掉容器就全没了,而且 web 与 worker 各写各的盘、彼此看不见对方的文件。
    // 这个形状不会报任何错,所以只能在开机时拦。
    requirement: "required",
    format: "enum",
    values: ["local", "r2"],
    // 格式合法 ≠ 生产可用:local 在开发机上完全正当,在生产是数据丢失。
    productionValues: ["r2"],
    productionReason:
      "local disk is dev-only — in production it scatters merchant media across ephemeral containers and web/worker cannot see each other's files",
    secret: false,
    shared: true,
    summary: "local (disk, dev only) | r2. REQUIRED in production and must be r2 — the boot check refuses to start a production process on local disk.",
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

  // ── 夜间备份:触发权与隔离凭据(#794)──────────────────────────────────────
  // 全组 optional,理由与 #796 那组相同:不设 = 今天这个形状(worker 自己的 5 分钟定时器 +
  // 与内容同一把 R2 钥匙),逐字节不变。改变触发权或换钥匙必须是一次明确的动作。
  //
  // R2_BACKUP_* 的「要么全设要么全不设」由 packages/storage 的 opsR2Config 硬拦(半配抛错,
  // 永不静默回落到共享凭据)。契约在这里只负责登记这四个名字存在、谁读、是不是密钥——把同一条
  // 组规则再写一遍,只会制造第二份可能与代码走散的真相。
  {
    name: "BACKUP_TRIGGER",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "\"cron\" hands the nightly backup to the Railway cron service; anything else (incl. unset) keeps the worker's own 5-minute timer. Set the same value on both services so exactly one runs it.",
  },
  {
    name: "R2_BACKUP_ACCESS_KEY_ID",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: true,
    shared: false,
    summary: "Backup-scoped R2 token id. Unset = backups reuse the content credential. Both halves of the credential or neither — a half-set family is a hard startup error.",
  },
  {
    name: "R2_BACKUP_SECRET_ACCESS_KEY",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: true,
    shared: false,
    summary: "Backup-scoped R2 token secret. Paired with R2_BACKUP_ACCESS_KEY_ID.",
  },
  {
    name: "R2_BACKUP_BUCKET",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Bucket the backups are written to. Defaults to R2_BUCKET (same bucket, different key prefix).",
  },
  {
    name: "R2_BACKUP_ENDPOINT",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "url",
    secret: false,
    shared: false,
    summary: "Endpoint the backup credential talks to. Defaults to R2_ENDPOINT.",
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

  // ── worker 拆分(#796)────────────────────────────────────────────────────
  // 同一个镜像按角色分成两种服务。全组都是 optional:不设 = `all` = 今天这个单服务,
  // 逐字节不变——拆分必须是一次明确的动作,不能是部署的副作用。
  //
  // shared: false 是有意的。这一组正是 web 与 worker **本来就该不同**的东西(web 根本
  // 不读它们),所以它们不进部署指纹;把它们算进去,只会让每次调并发都误报成「两边配置不一致」。
  {
    name: "WORKER_ROLE",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "enum",
    values: ["compute", "wait", "all"],
    secret: false,
    shared: false,
    summary: "Which half of the worker this service runs. Unset = all = today's single service. An unrecognised value exits at boot.",
  },
  {
    name: "GEN_CONCURRENCY",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "integer",
    secret: false,
    shared: false,
    summary: "Job slots for the gen queue. Only takes effect when WORKER_ROLE=wait.",
  },
  {
    name: "REFGEN_CONCURRENCY",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "integer",
    secret: false,
    shared: false,
    summary: "Job slots for the refgen queue. Only takes effect when WORKER_ROLE=wait.",
  },
  {
    name: "RESEARCH_CONCURRENCY",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "integer",
    secret: false,
    shared: false,
    summary: "Job slots for the research queue. Only takes effect when WORKER_ROLE=wait.",
  },
  {
    name: "PUBLISH_CONCURRENCY",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "integer",
    secret: false,
    shared: false,
    summary: "Job slots for the publish queue. Only takes effect when WORKER_ROLE=wait.",
  },
  {
    name: "PROVIDER_MAX_CONCURRENT_REQUESTS",
    surface: "worker",
    readBy: "code",
    requirement: "optional",
    format: "integer",
    secret: false,
    shared: false,
    summary: "Process-wide ceiling on concurrent PAID provider requests, shared by gen and refgen. Not the job slots — one image job fans out one request per image.",
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

  // ── 生成队列指标(admin Queue health,#779)────────────────────────────────
  // 只读、全组 optional。不设 = /admin/queue 说「Not connected」什么都不读,零成本。
  {
    name: "QUEUE_METRICS_QUERY_URL",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "url",
    secret: false,
    shared: false,
    summary: "Prometheus-compatible query base, workspace path included. Unset switches the whole page off.",
  },
  {
    name: "QUEUE_METRICS_BASIC_AUTH",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: true,
    shared: false,
    summary: "\"user:password\" for the metrics endpoint. Omit when it needs no basic auth.",
  },
  {
    name: "QUEUE_METRICS_PREFIX",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "free",
    secret: false,
    shared: false,
    summary: "Namespace in front of each metric name, when the store uses one.",
  },
  {
    name: "QUEUE_METRICS_TIMEOUT_MS",
    surface: "web",
    readBy: "code",
    requirement: "optional",
    format: "integer",
    secret: false,
    shared: false,
    summary: "Per-request timeout. A slow store degrades the page, never blocks it.",
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

export type EnvProblemKind = "missing" | "conditional-missing" | "invalid" | "not-production-safe";

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
    const raw = env[spec.name];
    const present = isSet(raw);

    if (!present) {
      if (!opts.production) continue;
      // platform / library 读取的变量不参与存在性判定:前者由宿主注入,后者的缺失由 SDK
      // 自己报得更准。写成守卫而不是逐条判断,是为了将来有人把某个 library 变量标成
      // required 时,这条不变量仍然成立。
      if (spec.readBy !== "code") continue;
      if (spec.requirement === "required") {
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

    // 首尾空白一律拒绝,先于其它一切判断(判官 r2 P1-1)。
    //
    // 病因很具体:契约这边过去按 trim 后的值判断,而消费方按原值严格比较——
    // packages/storage/src/index.ts 的 `process.env.STORAGE_DRIVER === "r2"`、
    // packages/generation 的 `=== "fal"` 都是逐字比较。于是 STORAGE_DRIVER=" r2 " 在契约里
    // 一个问题都没有,工厂却落回本地盘:商家的文件写进容器自己的盘,而开机检查刚刚说过一切正常。
    // 这正是这张票要消灭的那一族「说的≠做的」,只不过它长在了检查器自己身上。
    //
    // 方向选的是「契约拒绝」而不是「消费方 trim」,两个理由:
    //   ① 消费方是数据路径上的模块,让 " r2 " 开始生效是行为变更,得单独论证;拒绝它是零行为变更。
    //   ② 契约的职责是描述代码实际怎么读,不是替代码做规范化。判断口径与消费方逐字对齐,
    //      这一族 bug 才是被消灭,而不是被挪了个地方。
    // 从控制台粘贴带尾空格是最常见的操作失误,现在它得到的是一条点名的开机错误,而不是一个静默的降级。
    if (raw !== raw.trim()) {
      problems.push({
        name: spec.name,
        kind: "invalid",
        message: `${spec.name} has leading or trailing whitespace — the code compares the raw value, so a padded value silently behaves like an unrecognized one`,
      });
      continue;
    }

    const parsed = formatSchema(spec).safeParse(raw);
    if (!parsed.success) {
      const reason = parsed.error.issues[0]?.message ?? "has an invalid value";
      problems.push({ name: spec.name, kind: "invalid", message: `${spec.name} ${reason}` });
      continue;
    }

    // 值合法,但这个档位只在开发机上成立。报的是变量名与允许档位——档位名不是秘密,
    // 而且不说清楚该改成什么,这条错误就没法照着修。
    if (opts.production && spec.productionValues && !spec.productionValues.includes(raw)) {
      problems.push({
        name: spec.name,
        kind: "not-production-safe",
        message:
          `${spec.name} is set to a value that is not allowed in production ` +
          `(allowed: ${spec.productionValues.join(", ")}) — ${spec.productionReason ?? "dev-only setting"}`,
      });
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
 *   - 值**逐字**进,不做 trim:两个进程一个带尾空格一个不带,消费方的严格比较会让它们行为
 *     不同,指纹就必须也不同。指纹要反映进程实际持有的东西,不是它整理过之后的样子。
 *
 * 指纹只在鉴权后的 admin 面里显示,不进 /api/health 这类匿名端点。
 */
export function configFingerprint(env: EnvRecord): string {
  const canonical = FINGERPRINT_VARS.map((name) => {
    const spec = ENV_CONTRACT_BY_NAME.get(name);
    const raw = env[name];
    const value = isSet(raw) ? raw : "";
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
