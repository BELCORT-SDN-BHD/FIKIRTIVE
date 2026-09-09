#!/usr/bin/env node
// mint-r2-token.mjs — R2 桶级钥匙的四件事：体检 / 铸 staging 钥匙 / 铸 production 钥匙 / 搬运对象。
//
// 安全约定（本脚本硬性遵守）：
//   * 秘密（Cloudflare API token、S3 Secret Access Key）只在进程内存里流转。
//   * 从不 console.log 秘密、从不写文件、从不放进 argv（Railway 写入走 stdin）。
//   * 打印的只有：HTTP 状态、权限组名字与 id、桶名、服务名、对象 key、
//     sha256 指纹前 12 位、以及 Access Key ID 的前 6 位。
//   * 搬运用的临时令牌在 finally 里删除；删不掉就把手工吊销指引落屏。
//
// 文档依据与操作顺序见 docs/runbooks/r2-bucket-token-rotation.md。
//
// 用法： node scripts/tools/mint-r2-token.mjs --help

import { execFileSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { interlock } from "./_interlock.mjs";

// ───────────────────────────── 常量 ─────────────────────────────

/**
 * 默认账号 = Tools@belcort.com's Account（三个 R2 桶都在这个账号下）。
 * 不是秘密（账号 id 会出现在每个 R2 endpoint 里）。别的账号用 --account-id 覆盖。
 */
const DEFAULT_ACCOUNT_ID = "ac42cba1bda978bd00f6c45d0e25dc24";
let ACCOUNT_ID = DEFAULT_ACCOUNT_ID;
const JURISDICTION = "default"; // 非 jurisdiction 桶固定为 default
const CF_API = "https://api.cloudflare.com/client/v4";

/** 搬运的源桶：生产现用的老桶。 */
const SOURCE_BUCKET = "artlio";
/** 账号里应该存在的三个桶（--check 逐个确认）。 */
const ALL_BUCKETS = [SOURCE_BUCKET, "fikirtive-staging", "fikirtive-production"];
/** 搬运令牌的名字。同名令牌 = 上一次跑留下的残留，--copy 开头会先清掉。 */
const MIGRATION_TOKEN_NAME = "fikirtive-migration-temp";

const ENVS = ["staging", "production"];
/**
 * `railway` CLI 在哪个目录里跑。railway 按目录记 link（项目绑定），
 * 所以这里必须是一个已经 `railway link` 过本项目的目录。
 * 默认当前工作目录；用环境变量 RAILWAY_LINKED_DIR 指到别处。
 */
const RAILWAY_LINKED_DIR = process.env.RAILWAY_LINKED_DIR || process.cwd();
const RAILWAY_SERVICES = ["web", "worker"];
/**
 * @aws-sdk/client-s3 只由 packages/storage 声明（根 package.json 与 scripts/ 都没有这个依赖，
 * scripts/ 也没有自己的 package.json），所以从它的 package.json 起解析 ——
 * 与 scripts/tools/r2-configure.mjs 同一个做法。
 */
const S3_PACKAGE = "@aws-sdk/client-s3";

/** 搬运并发度与单对象重试次数。 */
const COPY_CONCURRENCY = 4;
const COPY_RETRIES = 1;
/** 汇总时最多打印多少个 key（key 名不是秘密，但也没必要刷屏）。 */
const MAX_KEYS_PRINTED = 20;
/** 清点时最多打印多少组「第一段路径」汇总。 */
const MAX_PREFIXES_PRINTED = 15;
/** 复制后随机抽查几个对象比大小。 */
const VERIFY_SAMPLE = 5;
/**
 * 单对象大小上限。逐对象是「整块读进内存再写」，并发 COPY_CONCURRENCY 个一起吃内存，
 * 没有上限的话一个大对象就能把进程撑爆 —— 而进程被杀时 finally 不跑，搬运令牌会残留。
 * 超限对象按 failed 计并落屏，请单独处理。
 */
const MAX_OBJECT_BYTES = 256 * 1024 * 1024;
/**
 * 搬运令牌的存活上限（毫秒）。Ctrl-C／OOM 杀进程时 Node 不执行 finally，
 * 令牌回收不了；expires_on 是那条路径上唯一的兜底。
 */
const MIGRATION_TOKEN_TTL_MS = 3600e3;
/**
 * Cloudflare 的 expires_on 只收**秒级** RFC3339，带毫秒会被逐字拒绝：
 *   expires_on must be a valid date/time in the format "2005-12-30T01:02:03Z"
 * 而 toISOString() 一定带三位毫秒（…T01:02:03.000Z），所以这里把毫秒削掉。
 */
export const migrationExpiry = () =>
  new Date(Date.now() + MIGRATION_TOKEN_TTL_MS)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

// 按名字精确匹配权限组。Cloudflare 官方说名字是装饰性的、可能变
//（"the permission `name` is cosmetic and subject to change"），
// 所以这里是 fail-closed：名字对不上就报 FAIL、不铸造，不会误选权限组。
// 真变了的话，照 [2/4] 打印出来的 R2 权限组清单把下面两行改成当前名字即可。
const PG_READ = "Workers R2 Storage Bucket Item Read";
const PG_WRITE = "Workers R2 Storage Bucket Item Write";

// ───────────────────────────── 小工具 ─────────────────────────────

const log = (...a) => console.log(...a);
const ok = (label, extra = "") => log(`  OK    ${label}${extra ? "  " + extra : ""}`);
const fail = (label, extra = "") => log(`  FAIL  ${label}${extra ? "  " + extra : ""}`);
const warn = (label, extra = "") => log(`  WARN  ${label}${extra ? "  " + extra : ""}`);

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
/** 指纹：任何秘密都只以此形式露面。 */
const fp = (s) => (s ? sha256hex(s).slice(0, 12) : "(空)");
/** Access Key ID 前 6 位；它不是秘密，但也没必要整条打出来。 */
const maskId = (s) => (s ? s.slice(0, 6) + "…" : "(空)");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 取 URL 的 host；不是合法 URL 就返回 null（绝不抛）。 */
const hostOf = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
};

/** 本账号的 R2 S3 endpoint 默认形状。 */
const accountEndpoint = () => `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;

class Fatal extends Error {}

// ═════════════════════ 纯函数（mint-r2-token.plan.test.mjs 覆盖） ═════════════════════

/**
 * 环境名 → 这一次要动的东西。
 * otherBuckets 是「作用域反证」的候选：目标桶以外的桶，用来证明新钥匙碰不到它们。
 */
export function planFor(env) {
  if (!ENVS.includes(env)) {
    throw new Fatal(`不认识的环境 "${env}"，只能是 ${ENVS.join(" 或 ")}。`);
  }
  const bucket = `fikirtive-${env}`;
  return {
    env,
    bucket,
    tokenName: `fikirtive-${env}-web`,
    railwayEnv: env,
    otherBuckets: ALL_BUCKETS.filter((b) => b !== bucket),
  };
}

/** 桶资源键：com.cloudflare.edge.r2.bucket.<ACCOUNT_ID>_<JURISDICTION>_<BUCKET_NAME> */
export function bucketResourceKey(accountId, jurisdiction, bucket) {
  return `com.cloudflare.edge.r2.bucket.${accountId}_${jurisdiction}_${bucket}`;
}

/** 一条 policy：允许 groups 里的权限组作用在 buckets 这些桶上。 */
export function buildPolicy(accountId, jurisdiction, buckets, groups) {
  const resources = {};
  for (const b of buckets) resources[bucketResourceKey(accountId, jurisdiction, b)] = "*";
  return {
    effect: "allow",
    resources,
    permission_groups: groups.map((g) => ({ id: g.id, name: g.name })),
  };
}

/**
 * 搬运令牌的策略：源桶只读 + 目标桶可写，两条独立 policy。
 * Cloudflare 文档原文：「Each token can contain multiple policies.」
 * （https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/）
 */
export function buildMigrationPolicies({
  accountId,
  jurisdiction,
  sourceBucket,
  targetBucket,
  pgRead,
  pgWrite,
}) {
  return [
    buildPolicy(accountId, jurisdiction, [sourceBucket], [pgRead]),
    buildPolicy(accountId, jurisdiction, [targetBucket], [pgWrite]),
  ];
}

/**
 * 逐对象的复制决策，三态：
 *   "skip"     目标桶已有同名**同大小**的对象 —— 搬过了，跳过。
 *   "copy"     目标桶没有这个 key（或 HeadObject 读不到／形状不对）—— 宁可重传也不能漏传。
 *   "conflict" 两边都有这个 key 但**大小不同** —— 目标桶那一份可能是线上写进去的新版本，
 *              默认不动它、计为 conflict 并落屏点名；只有 --allow-overwrite-live 才用 artlio 版覆盖。
 * 这是按**对象**判定，不是按环境判定：目标桶独有的 key 永远不在这个函数的输入里，也就永远不会被碰。
 */
export function copyDecision(head, size, allowOverwrite) {
  if (!head) return "copy";
  if (typeof head.ContentLength !== "number") return "copy";
  if (typeof size !== "number") return "copy";
  if (head.ContentLength === size) return "skip";
  return allowOverwrite ? "copy" : "conflict";
}

/** key 的第一段路径（含斜杠）；没有斜杠的根对象归到 "(根)"。 */
export function firstSegment(key) {
  const i = String(key ?? "").indexOf("/");
  return i === -1 ? "(根)" : String(key).slice(0, i + 1);
}

/** 按第一段路径汇总 count 与 bytes，按 bytes 降序。 */
export function prefixSummary(objects) {
  const acc = new Map();
  for (const o of objects) {
    const p = firstSegment(o.Key);
    const cur = acc.get(p) ?? { prefix: p, count: 0, bytes: 0 };
    cur.count += 1;
    cur.bytes += o.Size ?? 0;
    acc.set(p, cur);
  }
  return [...acc.values()].sort((a, b) => b.bytes - a.bytes || a.prefix.localeCompare(b.prefix));
}

/**
 * 按 --exclude-prefix 把清点结果切成两半。空前缀列表 = 一个都不剔。
 * 剔掉的对象既不搬、也不进搬完的 key 集合差集校验（它们本来就不该在目标桶里）。
 */
export function partitionByPrefixes(objects, prefixes) {
  if (!prefixes?.length) return { kept: [...objects], excluded: [] };
  const kept = [];
  const excluded = [];
  for (const o of objects) {
    (prefixes.some((p) => String(o.Key ?? "").startsWith(p)) ? excluded : kept).push(o);
  }
  return { kept, excluded };
}

// ───────────────────────────── 钥匙串 ─────────────────────────────

/**
 * 从 macOS 钥匙串取 Cloudflare API token。返回值是秘密，绝不打印。
 * 失败时抛 Fatal，且错误信息里不含 security 命令的 stdout（那里可能带值）。
 */
function readTokenFromKeychain(service) {
  const account = process.env.USER;
  if (!account) throw new Fatal("环境变量 USER 为空，无法定位钥匙串条目。");
  let out;
  try {
    out = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-a", account, "-s", service, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    throw new Fatal(
      `钥匙串里找不到条目 service="${service}" account="${account}"，` +
        `或者读取被拒绝。没有发出任何网络请求。`,
    );
  }
  const secretFromKeychain = out.trim();
  if (!secretFromKeychain) throw new Fatal(`钥匙串条目 "${service}" 的值是空的。`);
  return secretFromKeychain;
}

// ───────────────────────────── Cloudflare API ─────────────────────────────

async function cf(token, method, path, body) {
  const res = await fetch(`${CF_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, raw: text };
}

/** Cloudflare 的 errors[] 不含秘密，可以原样打印。 */
function printCfErrors(r) {
  const errs = r.json && Array.isArray(r.json.errors) ? r.json.errors : [];
  if (!errs.length) {
    log(`        (无 errors[]，HTTP ${r.status})`);
    return;
  }
  for (const e of errs) {
    log(`        errors[]: code=${e.code ?? "?"} message=${e.message ?? "?"}`);
    if (Array.isArray(e.error_chain)) {
      for (const c of e.error_chain) {
        log(`          chain: code=${c.code ?? "?"} message=${c.message ?? "?"}`);
      }
    }
  }
}

/**
 * 建令牌：先试账号级，失败回退用户级。
 * 返回 { id, value, delPath(id), pathKind }；value 是秘密。
 */
async function createToken(token, body) {
  // cf() 是裸 fetch：请求已经发出去、响应还没回来时断线会直接抛，
  // 而令牌可能已经在 Cloudflare 那边建好了。抛之前先把名字落屏，
  // 否则那把令牌就是一把没人知道的孤儿。名字不是秘密。
  try {
    return await createTokenInner(token, body);
  } catch (e) {
    warn(
      "可能已在 Cloudflare 建好令牌",
      `名字 ${body.name} —— 请到后台按名字核对并删除，再重跑`,
    );
    throw e;
  }
}

async function createTokenInner(token, body) {
  let created = await cf(token, "POST", `/accounts/${ACCOUNT_ID}/tokens`, body);
  let delPath = (id) => `/accounts/${ACCOUNT_ID}/tokens/${id}`;
  let pathKind = "账号级（Manage Account → Account API Tokens）";
  if (!created.ok) {
    const first = created.status;
    fail("账号级令牌创建", `HTTP ${first}`);
    printCfErrors(created);
    log("        → 回退到用户级令牌 POST /user/tokens");
    log(
      "        （账号级创建需要账号的 Super Administrator + 'API Tokens Write'；" +
        "用户级令牌会随该用户被移出账号而失效。）",
    );
    created = await cf(token, "POST", "/user/tokens", body);
    delPath = (id) => `/user/tokens/${id}`;
    pathKind = "用户级（My Profile → API Tokens）";
    if (!created.ok) {
      fail("用户级令牌创建", `HTTP ${created.status}`);
      printCfErrors(created);
      return { ok: false, created };
    }
    ok("用户级令牌已创建", `HTTP ${created.status}`);
  } else {
    ok("账号级令牌已创建", `HTTP ${created.status}`);
  }
  const id = created.json?.result?.id;
  const value = created.json?.result?.value; // 秘密
  if (!id || !value) {
    // HTTP 200 却缺 id/value —— 令牌很可能已经建好了，只是拿不到凭据。
    warn(
      "可能已在 Cloudflare 建好令牌",
      `名字 ${body.name} —— 请到后台按名字核对并删除，再重跑`,
    );
    return { ok: false, created, missing: true };
  }
  return { ok: true, id, value, delPath, pathKind };
}

/**
 * 列令牌：账号级与用户级**两条路径都扫**，合并去重后返回。
 * 只有两条都一页都没列成才返回 null（区别于「一个都没有」）。
 *
 * 为什么不能「第一条通了就返回」：账号级**建**令牌需要 Super Administrator，
 * 而**列**令牌只要 API Tokens Read。手上这把令牌完全可能列得动账号级、却建不动，
 * 于是 createToken 回退把令牌建在 /user/tokens —— 只扫账号级就永远看不见它，
 * 清残留会打出一条假 OK。
 */
async function listAllTokens(token) {
  const all = [];
  let anySuccess = false;
  for (const base of [`/accounts/${ACCOUNT_ID}/tokens`, "/user/tokens"]) {
    for (let page = 1; page <= 20; page++) {
      const r = await cf(token, "GET", `${base}?per_page=50&page=${page}`);
      if (!r.ok) {
        if (page > 1) {
          warn(
            `列令牌 ${base} 第 ${page} 页`,
            `HTTP ${r.status} —— 这条路径可能列不全`,
          );
        }
        break; // 这条路径到此为止，继续扫下一条
      }
      anySuccess = true;
      const arr = Array.isArray(r.json?.result) ? r.json.result : [];
      all.push(...arr);
      if (arr.length < 50) break;
    }
  }
  if (!anySuccess) return null;
  const seen = new Set();
  return all.filter((r) => {
    if (!r?.id || seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

// ───────────────────────────── Railway ─────────────────────────────

function railway(args, opts = {}) {
  return execFileSync("railway", args, {
    cwd: RAILWAY_LINKED_DIR,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...opts,
  });
}

/**
 * 读取一个服务的变量。返回 { KEY: value }。
 * 输出含明文值 —— 只在进程内使用，绝不打印。
 * CLI 的 JSON 形状在不同版本间有差异，这里做宽容归一化。
 */
function readRailwayVars(railwayEnv, service) {
  let out;
  try {
    out = railway([
      "variables",
      "--environment",
      railwayEnv,
      "--service",
      service,
      "--json",
    ]);
  } catch (e) {
    throw new Fatal(
      `railway variables 读取失败（environment=${railwayEnv} service=${service}）。` +
        `请先在 ${RAILWAY_LINKED_DIR} 里确认 railway login / railway link 正常。` +
        (e.status != null ? ` 退出码=${e.status}` : ""),
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Fatal(
      `railway variables --json 输出不是合法 JSON（environment=${railwayEnv} service=${service}）。`,
    );
  }
  return normalizeVars(parsed);
}

function normalizeVars(parsed) {
  const map = {};
  if (Array.isArray(parsed)) {
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const k = row.name ?? row.key ?? row.Name ?? row.Key;
      const v = row.value ?? row.Value;
      if (typeof k === "string") map[k] = v == null ? "" : String(v);
    }
    return map;
  }
  if (parsed && typeof parsed === "object") {
    // 可能是 {KEY: "value"}，也可能是 {variables: {...}} 之类的包裹
    const inner =
      parsed.variables && typeof parsed.variables === "object"
        ? parsed.variables
        : parsed;
    for (const [k, v] of Object.entries(inner)) {
      if (v == null) continue;
      if (typeof v === "object") {
        const vv = v.value ?? v.Value;
        if (vv != null) map[k] = String(vv);
      } else {
        map[k] = String(v);
      }
    }
    return map;
  }
  throw new Fatal("railway variables --json 输出形状无法识别。");
}

/** 写一个变量。秘密走 stdin，绝不进 argv（argv 在 ps 里全机可见）。 */
function setRailwayVar(railwayEnv, service, key, value, { secret }) {
  const base = [
    "variable",
    "set",
    "--environment",
    railwayEnv,
    "--service",
    service,
    "--skip-deploys",
  ];
  try {
    if (secret) {
      railway([...base, "--stdin", key], { input: value });
    } else {
      railway([...base, `${key}=${value}`]);
    }
  } catch (e) {
    throw new Fatal(
      `railway variable set 失败（environment=${railwayEnv} service=${service} key=${key}）` +
        (e.status != null ? ` 退出码=${e.status}` : ""),
    );
  }
}

// ───────────────────────────── S3 ─────────────────────────────

const require_ = createRequire(
  new URL("../../packages/storage/package.json", import.meta.url),
);

function makeS3(endpoint, accessKeyId, secretAccessKey) {
  const { S3Client } = require_(S3_PACKAGE);
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

/** 列一个桶的全部对象（翻页）。返回 [{Key, Size}]。 */
async function listAllObjects(client, bucket) {
  const { ListObjectsV2Command } = require_(S3_PACKAGE);
  const out = [];
  let cont;
  do {
    const r = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: cont }),
    );
    for (const o of r.Contents ?? []) out.push({ Key: o.Key, Size: o.Size });
    // 说还有下一页却不给游标 = 清单不完整。默默退出会让下游拿被截断的源清单去自我校验，
    // 必过 —— 漏搬就这样一路打「通过」。宁可炸也不能给假绿。
    if (r.IsTruncated && !r.NextContinuationToken) {
      throw new Fatal(
        `ListObjectsV2 ${bucket} 说还有下一页却没给 ContinuationToken，` +
          "清单不完整，拒绝据此校验。",
      );
    }
    cont = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (cont);
  return out;
}

/** ListObjectsV2(MaxKeys=1) 通不通；带传播重试。通过返回 true。 */
async function listProbe(client, bucket, { retries = 6, label = "" } = {}) {
  const { ListObjectsV2Command } = require_(S3_PACKAGE);
  let last = null;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }),
      );
      ok(
        `ListObjectsV2 ${bucket} (MaxKeys=1)${label ? " " + label : ""}`,
        `HTTP ${r.$metadata?.httpStatusCode ?? "?"} KeyCount=${r.KeyCount ?? 0}`,
      );
      return true;
    } catch (e) {
      last = e;
      if (i < retries - 1) {
        log(
          `        (等待令牌生效，第 ${i + 1} 次 ListObjectsV2 ${bucket} HTTP ${e?.$metadata?.httpStatusCode ?? "?"}，5s 后重试)`,
        );
        await sleep(5000);
      }
    }
  }
  fail(
    `ListObjectsV2 ${bucket}${label ? " " + label : ""}`,
    `HTTP ${last?.$metadata?.httpStatusCode ?? "?"} ${last?.name ?? ""}`,
  );
  return false;
}

/**
 * 作用域反证：拿一把凭据去碰一个它**本不该碰得到**的桶，期望被拒。
 * 三态措辞与 probeCredentials 一致：401/403 = 已证实；200 = 越权，抛 Fatal 停手；
 * 404 / 其他状态 / 网络错误 = 未证实（不算越权，也不算证实）。
 * 只读、免费，正反两侧都用 ListObjectsV2，结论才可比。
 */
async function denyProbe(client, denyBucket, role) {
  const { ListObjectsV2Command } = require_(S3_PACKAGE);
  const label = `搬运凭据作用域反证·${role} ListObjectsV2 ${denyBucket}`;
  let over = false;
  try {
    await client.send(new ListObjectsV2Command({ Bucket: denyBucket, MaxKeys: 1 }));
    over = true;
  } catch (e) {
    const code = e?.$metadata?.httpStatusCode;
    if (code === 401 || code === 403) {
      ok(label, `HTTP ${code}（对 ${denyBucket} 被拒，已证实）`);
    } else if (code === 404) {
      warn(label, "HTTP 404 —— 不算越权，但没证明是被权限拒的（未证实）");
    } else {
      warn(label, `HTTP ${code ?? "?"} ${e?.name ?? ""} —— 不算越权，但未证实`);
    }
  }
  if (over) {
    fail(label, "HTTP 200 —— 搬运令牌能碰到别的桶，作用域没生效");
    throw new Fatal("搬运凭据的作用域超出预期，什么都没搬。");
  }
}

/**
 * 实测一把 S3 凭据，返回三态结果：
 *   { pass: false }                        —— 正向门没过，或反证桶返回 200（越权）。
 *   { pass: true,  denialProven: false }   —— 目标桶可用，但「别的桶碰不到」**未证实**
 *                                             （404 / 其他状态 / 网络错误 / 压根没有反证桶）。
 *   { pass: true,  denialProven: true }    —— 反证桶明确 401/403，作用域已证实。
 * 只有 401/403 算「已证实拒绝」：404 可能只是桶不存在，证明不了权限边界。
 *
 * 正反两侧都用 ListObjectsV2（对象级操作），结论才可比。
 */
async function probeCredentials(
  endpoint,
  akid,
  secretAccessKey,
  bucket,
  otherBucket,
  { retries = 6 } = {},
) {
  const { HeadBucketCommand, ListObjectsV2Command } = require_(S3_PACKAGE);
  const client = makeS3(endpoint, akid, secretAccessKey);
  const DENY = { pass: false, denialProven: false };

  // 1) 正向门：ListObjectsV2(MaxKeys=1)。这是**对象级**操作，Bucket Item Read/Write
  //    权限组逐字写着 "Can read and list objects in buckets"，一定覆盖得到。
  //    新令牌有传播延迟，带重试。
  if (!(await listProbe(client, bucket, { retries }))) return DENY;

  // 2) HeadBucket —— **桶级**操作，只当信息行。Cloudflare 没有承诺 Bucket Item 权限组
  //    覆盖桶级操作（列桶/看桶配置归在账号级的 Workers R2 Storage Read），
  //    所以这里失败不代表凭据不可用，绝不作为门。
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    ok(`HeadBucket ${bucket}（信息行，不作为门）`, "HTTP 200");
  } catch (e) {
    warn(
      `HeadBucket ${bucket}（信息行，不作为门）`,
      `HTTP ${e?.$metadata?.httpStatusCode ?? "?"} ${e?.name ?? ""} —— 桶级操作，对象级令牌拿不到属正常`,
    );
  }

  // 3) 反证：对另一个**确认存在**的桶做同一个动词，必须被拒。
  if (!otherBucket) {
    warn(
      "作用域反证",
      "没有可用的反证桶（见 [3/4]）—— 本次无法证实作用域，按「未证实」处理",
    );
    return { pass: true, denialProven: false };
  }
  try {
    await client.send(new ListObjectsV2Command({ Bucket: otherBucket, MaxKeys: 1 }));
    fail(
      `作用域反证 ListObjectsV2 ${otherBucket}`,
      "HTTP 200 —— 令牌能碰到别的桶，作用域没生效",
    );
    return DENY;
  } catch (e) {
    const code = e?.$metadata?.httpStatusCode;
    if (code === 401 || code === 403) {
      ok(
        `作用域反证 ListObjectsV2 ${otherBucket}`,
        `HTTP ${code}（对 ${otherBucket} 被拒，已证实）`,
      );
      return { pass: true, denialProven: true };
    }
    if (code === 404) {
      warn(
        `作用域反证 ListObjectsV2 ${otherBucket}`,
        "HTTP 404 —— 不算越权，但没证明是被权限拒的（未证实）",
      );
    } else {
      warn(
        `作用域反证 ListObjectsV2 ${otherBucket}`,
        `HTTP ${code ?? "?"} ${e?.name ?? ""} —— 不算越权，但未证实`,
      );
    }
    return { pass: true, denialProven: false };
  }
}

// ───────────────────────────── --check ─────────────────────────────

/**
 * 读一个 Railway 环境的两个服务，打指纹，并定下这次要写的 R2_ENDPOINT。
 * 返回 { current, endpoint, ok }。
 */
function inspectRailwayEnv(railwayEnv) {
  let envOk = true;
  const current = {};
  const epBySvc = {};
  log(`        ── environment=${railwayEnv} ──`);
  for (const svc of RAILWAY_SERVICES) {
    try {
      const vars = readRailwayVars(railwayEnv, svc);
      current[svc] = vars;
      const ep = vars.R2_ENDPOINT ?? "";
      epBySvc[svc] = ep;
      log(`        [${railwayEnv}/${svc}]`);
      log(`          R2_BUCKET            = ${vars.R2_BUCKET ?? "(未设)"}`);
      log(`          R2_ENDPOINT          = ${ep || "(未设)"}`);
      log(
        `          R2_ACCESS_KEY_ID     指纹 ${fp(vars.R2_ACCESS_KEY_ID)}  前缀 ${maskId(vars.R2_ACCESS_KEY_ID ?? "")}`,
      );
      log(`          R2_SECRET_ACCESS_KEY 指纹 ${fp(vars.R2_SECRET_ACCESS_KEY)}`);
      ok(`读取 railway ${railwayEnv}/${svc} 变量`);
    } catch (e) {
      fail(`读取 railway ${railwayEnv}/${svc} 变量`, e.message);
      envOk = false;
    }
  }

  // R2_ENDPOINT 不是「只读、假设它已经对」的旁观者：
  //   * 两个服务都读到、值完全一致、且属于本账号 —— 沿用现值；
  //   * 只要为空、两边不一致，就用本账号的默认形状；
  //   * 无论走哪条，--mint 都会把它当**非秘密键**一起写进去（写完还要读回比对），
  //     免得出现「钥匙换了、endpoint 还缺着或还指着别的账号」的半配置。
  const defaultEndpoint = accountEndpoint();
  const readSvcs = RAILWAY_SERVICES.filter((svc) => current[svc]);
  const epValues = readSvcs.map((svc) => epBySvc[svc] ?? "");
  const epUniq = [...new Set(epValues)];
  let endpoint;
  if (readSvcs.length === RAILWAY_SERVICES.length && epUniq.length === 1 && epUniq[0]) {
    endpoint = epUniq[0];
    ok(`R2_ENDPOINT ${railwayEnv}（两个服务一致，沿用现值）`, endpoint);
  } else {
    const why = !readSvcs.length
      ? "两个服务都没读出来"
      : readSvcs.length < RAILWAY_SERVICES.length
        ? "有服务没读出来"
        : epUniq.length === 1
          ? "两个服务都没设"
          : "两个服务的值不一致（或有一边为空）";
    endpoint = defaultEndpoint;
    warn(`R2_ENDPOINT ${railwayEnv} ${why}`, `本次改用账号默认值 ${defaultEndpoint}`);
    for (const svc of readSvcs) {
      const cur = epBySvc[svc] ?? "";
      const h = cur ? hostOf(cur) : null;
      if (cur && (!h || !h.startsWith(ACCOUNT_ID))) {
        warn(
          `${railwayEnv}/${svc} 现有 R2_ENDPOINT 不属于账号 ${ACCOUNT_ID}`,
          `host=${h ?? "(不是合法 URL)"} —— 将被上面的默认值覆盖`,
        );
      }
    }
  }
  log(
    `        → --mint ${railwayEnv} 会把 R2_ENDPOINT=${endpoint} 当非秘密键一起写进两个服务。`,
  );

  // 账号归属校验：endpoint 的 host 必须以本账号 id 开头。
  // 对不上就是「钥匙铸在 A 账号、桶配置指着 B 账号」，怎么重跑都认证不过。
  const epHost = hostOf(endpoint);
  if (!epHost) {
    fail(`${railwayEnv} 的 R2_ENDPOINT 不是合法 URL`, endpoint);
    envOk = false;
  } else if (!epHost.startsWith(ACCOUNT_ID)) {
    fail(`${railwayEnv} 的 R2_ENDPOINT 不属于本账号`, `host=${epHost}`);
    log(`        ⚠️ Railway ${railwayEnv} 现有 endpoint 不属于账号 ${ACCOUNT_ID}，`);
    log("        ⚠️ 本脚本铸的令牌在那里永远认证不过（不管重跑多少次）。");
    log(`        ⚠️ 先决定 ${railwayEnv} 到底该连哪个账号：要么把 R2_ENDPOINT 改成`);
    log(`        ⚠️ ${defaultEndpoint}，要么改用那个账号的令牌并同步改脚本顶部的 ACCOUNT_ID。`);
    envOk = false;
  } else {
    ok(`${railwayEnv} 的 R2_ENDPOINT 属于本账号`, `host=${epHost}`);
  }

  return { current, endpoint, ok: envOk };
}

/**
 * 只读体检。envs 决定读哪几个 Railway 环境。
 * 返回 { allOk, pgRead, pgWrite, bucketNames, byEnv }。
 */
async function runCheck(token, { envs = ENVS } = {}) {
  const state = { pgRead: null, pgWrite: null, bucketNames: [], byEnv: {} };
  let allOk = true;

  log("\n[1/4] 令牌验证 (verify)");
  // 账号级令牌用 /accounts/{id}/tokens/verify；用户级令牌用 /user/tokens/verify。
  let v = await cf(token, "GET", `/accounts/${ACCOUNT_ID}/tokens/verify`);
  if (v.ok) {
    ok("GET /accounts/{id}/tokens/verify", `HTTP ${v.status} status=${v.json?.result?.status}`);
  } else {
    const first = v.status;
    v = await cf(token, "GET", "/user/tokens/verify");
    if (v.ok) {
      ok(
        "GET /user/tokens/verify",
        `HTTP ${v.status} status=${v.json?.result?.status}（账号级 verify 先返回 HTTP ${first}）`,
      );
    } else {
      fail("令牌验证", `账号级 HTTP ${first}，用户级 HTTP ${v.status}`);
      printCfErrors(v);
      allOk = false;
    }
  }

  log("\n[2/4] R2 权限组 (permission groups)");
  let pg = await cf(
    token,
    "GET",
    `/accounts/${ACCOUNT_ID}/tokens/permission_groups?per_page=1000`,
  );
  let pgSource = `/accounts/${ACCOUNT_ID}/tokens/permission_groups`;
  if (!pg.ok) {
    const first = pg.status;
    pg = await cf(token, "GET", "/user/tokens/permission_groups?per_page=1000");
    pgSource = `/user/tokens/permission_groups（账号级先返回 HTTP ${first}）`;
  }
  if (!pg.ok) {
    fail("列权限组", `HTTP ${pg.status}`);
    printCfErrors(pg);
    allOk = false;
  } else {
    const groups = Array.isArray(pg.json?.result) ? pg.json.result : [];
    const r2 = groups.filter((g) => typeof g?.name === "string" && /R2/i.test(g.name));
    ok(`GET ${pgSource}`, `HTTP ${pg.status}，共 ${groups.length} 个，其中 R2 相关 ${r2.length} 个`);
    for (const g of r2) log(`        ${g.id}  ${g.name}`);
    state.pgRead = r2.find((g) => g.name === PG_READ) ?? null;
    state.pgWrite = r2.find((g) => g.name === PG_WRITE) ?? null;
    const pgSelfHelp =
      "Cloudflare 说权限组名字可能变；对照上面这份 R2 权限组清单，" +
      "把脚本顶部的常量改成当前名字，再重跑。";
    if (!state.pgRead) {
      fail(`找权限组 "${PG_READ}"`, "没找到");
      log(`        → ${pgSelfHelp}`);
      allOk = false;
    } else {
      ok(`权限组 "${PG_READ}"`, `id=${state.pgRead.id}`);
    }
    if (!state.pgWrite) {
      fail(`找权限组 "${PG_WRITE}"`, "没找到");
      log(`        → ${pgSelfHelp}`);
      allOk = false;
    } else {
      ok(`权限组 "${PG_WRITE}"`, `id=${state.pgWrite.id}`);
    }
  }

  log("\n[3/4] 三个桶的存在性（源桶 + 两个目标桶）");
  const list = await cf(token, "GET", `/accounts/${ACCOUNT_ID}/r2/buckets?per_page=1000`);
  let names = (list.json?.result?.buckets ?? [])
    .map((x) => x?.name)
    .filter((n) => typeof n === "string");
  if (list.ok) {
    ok("GET /accounts/{id}/r2/buckets", `HTTP ${list.status}，账号共 ${names.length} 个桶`);
  } else {
    warn("列桶失败，改为逐桶单查", `HTTP ${list.status}`);
    names = [];
    for (const b of ALL_BUCKETS) {
      const one = await cf(token, "GET", `/accounts/${ACCOUNT_ID}/r2/buckets/${b}`);
      if (one.ok) names.push(b);
    }
  }
  for (const b of ALL_BUCKETS) {
    if (names.includes(b)) ok(`桶 ${b} 存在`);
    else {
      fail(`桶 ${b}`, "在本账号里找不到");
      allOk = false;
    }
  }
  state.bucketNames = names;

  log("\n[4/4] Railway 现状（只读；打印的是指纹，不是值）");
  if (!envs.length) {
    log("        （本次跳过：--copy 不碰 Railway，endpoint 用账号默认形状。）");
  }
  for (const env of envs) {
    const plan = planFor(env);
    const r = inspectRailwayEnv(plan.railwayEnv);
    // 反证桶必须**确认存在**：桶不存在时 404 会让「别的桶碰不到」这条断言静默失效。
    const otherBucket = plan.otherBuckets.find((b) => names.includes(b)) ?? null;
    if (otherBucket) {
      ok(`${env} 的作用域反证桶`, otherBucket);
    } else {
      warn(
        `${env} 没有可用的作用域反证桶`,
        `候选 ${plan.otherBuckets.join(" / ")} 都不在账号里 —— 反证不可做`,
      );
    }
    state.byEnv[env] = { ...r, otherBucket, plan };
    if (!r.ok) allOk = false;
  }

  log("\n[汇总]（上面是四项检查，这一节只做汇总）");
  if (allOk) {
    ok(envs.length ? "四项检查全部通过" : "前三项检查全部通过（第四项本次跳过）");
    log("        注意：--check 只验「能不能铸」这四件事，全程不发任何 S3 请求 ——");
    log("        它**不**验证 Railway 现在这几把 R2 钥匙还能不能用。");
  } else {
    fail("四项检查里有失败项，--mint / --copy 不会执行");
  }
  log("");
  return { allOk, ...state };
}

// ───────────────────────────── 幂等判断 ─────────────────────────────

/** 如果 Railway 里已经是一把可用且作用域正确的凭据，就不再重复铸造。 */
async function alreadyDone(token, plan, envState) {
  const web = envState.current?.web;
  const worker = envState.current?.worker;
  if (!web || !worker) return false;
  if (web.R2_BUCKET !== plan.bucket || worker.R2_BUCKET !== plan.bucket) return false;
  if (!web.R2_ACCESS_KEY_ID || !web.R2_SECRET_ACCESS_KEY) return false;
  if (fp(web.R2_ACCESS_KEY_ID) !== fp(worker.R2_ACCESS_KEY_ID)) return false;
  if (fp(web.R2_SECRET_ACCESS_KEY) !== fp(worker.R2_SECRET_ACCESS_KEY)) return false;

  log(
    `\n[幂等检查] Railway ${plan.railwayEnv} 两个服务的 R2_BUCKET 已是 ${plan.bucket} 且凭据指纹一致，验证它是否已经够用。`,
  );
  const t = await cf(
    token,
    "GET",
    `/accounts/${ACCOUNT_ID}/tokens/${encodeURIComponent(web.R2_ACCESS_KEY_ID)}`,
  );
  if (t.ok) {
    ok(
      "现存令牌可在账号令牌列表里查到",
      `name=${t.json?.result?.name ?? "?"} status=${t.json?.result?.status ?? "?"}`,
    );
  } else {
    warn(
      "现存 Access Key ID 在账号令牌里查不到",
      `HTTP ${t.status}（可能是用户级令牌，继续做 S3 探针）`,
    );
  }
  const probe = await probeCredentials(
    envState.endpoint,
    web.R2_ACCESS_KEY_ID,
    web.R2_SECRET_ACCESS_KEY,
    plan.bucket,
    envState.otherBucket,
    { retries: 1 },
  );
  if (!probe.pass) return false;
  // 只有「已证实被拒」才敢短路。未证实时宁可多铸一把窄钥匙，
  // 也不能把一把可能是宽权限的旧钥匙判成「已完成」。
  if (!probe.denialProven) {
    warn(
      "幂等短路不成立",
      "现存凭据能用，但没证实它只管目标桶（反证未确证）—— 继续走铸造流程",
    );
    return false;
  }
  return true;
}

// ───────────────────────────── --mint ─────────────────────────────

const R2_KEYS = ["R2_BUCKET", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];

/**
 * 写入/读回出问题时，把「现在到底是个什么半成品状态」讲清楚。
 * 令牌**不回收**（回收会把已写进去的一半配置变成死配置），
 * 但必须告诉人怎么收拾，否则重跑会因为指纹不一致而绕过幂等、再铸一把孤儿令牌。
 */
function printHalfDone(why, plan, tokenId, pathKind, written) {
  log(`\n[半成品状态] ${why}`);
  log("        ⚠️ 令牌已经建好且验证通过，但这次跑没有干净收尾。");
  log("        ⚠️ 未回收令牌（避免把已写进去的一半配置搞成死配置）。");
  log(`        本次新令牌：名字 ${plan.tokenName}，id 前缀 ${maskId(tokenId)}，路径 ${pathKind}`);
  for (const svc of RAILWAY_SERVICES) {
    const done = written[svc] ?? [];
    const undone = R2_KEYS.filter((k) => !done.includes(k));
    log(
      `        [${plan.railwayEnv}/${svc}] 已写：${done.join(" / ") || "（无）"}` +
        `   未写：${undone.join(" / ") || "（无，四个键都写了）"}`,
    );
  }
  log(`        ⚠️ 重跑 --mint ${plan.env} 之前，先到 Cloudflare 后台（${pathKind}）把上面这个前缀`);
  log(`        ⚠️ ${maskId(tokenId)} 的令牌删掉 —— 否则每失败一次就多一把同名孤儿令牌。`);
}

/**
 * 收尾提醒：旧的那把宽权限钥匙。两条路径都要打，不能只挂在「铸造成功」这一条上。
 *   minted=true  —— 刚铸完，akid 是铸造**之前** Railway 里的值，就是那把旧宽钥匙。
 *   minted=false —— 幂等短路，akid 是 Railway 现值，也就是那把**已经就位的窄钥匙**；
 *                   脚本这时认不出旧宽钥匙是哪一把，只能让人按「除它以外」去找。
 */
async function printOldKeyReminder(token, plan, akid, { minted }) {
  // 后台列表是按**名字**展示的，名字比 6 位 id 前缀好认得多 —— 顺手取一次。
  let name = null;
  if (akid) {
    try {
      const t = await cf(
        token,
        "GET",
        `/accounts/${ACCOUNT_ID}/tokens/${encodeURIComponent(akid)}`,
      );
      if (t.ok) name = t.json?.result?.name ?? null;
    } catch {
      /* 查不到就只报前缀，不影响主流程 */
    }
  }
  if (minted) {
    log("\n还没做完 —— 旧的那把宽权限钥匙仍然活着：");
    log(`  旧令牌名      ${name ?? "(查不到，可能是用户级令牌；只能按前缀认)"}`);
    log(`  旧 AKID 前缀  ${maskId(akid)}   （旧 AKID 指纹 ${fp(akid)}）`);
    log(`  1. 先重新部署 ${plan.railwayEnv} 的 web 和 worker，确认一切正常；`);
    log("  2. 确认正常之后，再去 Cloudflare 后台按上面的名字＋前缀找到**旧**令牌并吊销。");
    log("  顺序不能颠倒 —— 旧钥匙是唯一还能证明旧配置存在过的东西，吊销早了就没有退路了。");
  } else {
    log("\n还没做完 —— 旧的那把宽权限钥匙可能仍然活着：");
    log(
      `  Railway 现值    名字 ${name ?? "(查不到)"}，前缀 ${maskId(akid)} —— 这把是**窄**钥匙，别删它。`,
    );
    log("  本次没有新建令牌，所以脚本认不出旧的宽钥匙是哪一把。");
    log(`  1. 先重新部署 ${plan.railwayEnv} 的 web 和 worker，确认一切正常；`);
    log("  2. 再去 Cloudflare 后台，把**除上面这个前缀以外**的旧 R2 令牌找出来吊销。");
    log("  不吊销旧的那把，这次换钥匙就等于白做 —— 它仍然能碰账号里所有桶。");
  }
}

async function runMint(token, env, { yesProduction, expectObjects = null }) {
  const plan = planFor(env);
  if (plan.env === "production" && !yesProduction) {
    throw new Fatal(
      "production 切换须 Founder 明说。\n" +
        "  --mint production 会把 production 的 web 和 worker 指向 fikirtive-production，\n" +
        "  这是真正的切换动作。Founder 明确说「切」之后，才加 --yes-production 重跑。",
    );
  }

  const chk = await runCheck(token, { envs: [env] });
  if (!chk.allOk) throw new Fatal("四项检查没有全部通过，拒绝铸造。先修好上面的 FAIL 项。");
  const envState = chk.byEnv[env];

  if (await alreadyDone(token, plan, envState)) {
    // production 的两道内容闸不能被幂等短路跳过。这条路径同样打绿色收尾，
    // 而 --expect-objects 是编排者显式要求的机器比对 —— 静默丢掉就是一条假绿。
    // 用 Railway 现值这把**刚刚探针通过**的凭据数一遍即可：不新建令牌，也就没有 destroy 的问题。
    if (plan.env === "production") {
      log("\n[切换前闸] 幂等路径：用 Railway 现值这把凭据数一遍目标桶的对象数");
      let objects;
      try {
        const client = makeS3(
          envState.endpoint,
          envState.current.web.R2_ACCESS_KEY_ID,
          envState.current.web.R2_SECRET_ACCESS_KEY,
        );
        objects = await listAllObjects(client, plan.bucket);
      } catch (e) {
        throw new Fatal(
          `数不出 ${plan.bucket} 的对象数（${e?.name ?? e?.message ?? "?"}）。` +
            "本次没有新建令牌，Railway 未被改动。",
        );
      }
      if (objects.length === 0) {
        fail(`${plan.bucket} 对象数 = 0`, "空桶不能算切好 —— 先跑 --copy production");
        throw new Fatal(
          `${plan.bucket} 里一个对象都没有。先跑 node scripts/tools/mint-r2-token.mjs --copy production ` +
            "把 artlio 的对象搬过去。本次没有新建令牌，Railway 未被改动。",
        );
      }
      if (expectObjects != null && objects.length !== expectObjects) {
        fail(
          `${plan.bucket} 对象数 = ${objects.length}`,
          `与 --expect-objects ${expectObjects} 对不上`,
        );
        throw new Fatal(
          `目标桶有 ${objects.length} 个对象，与 --expect-objects ${expectObjects} 不符。` +
            "本次没有新建令牌，Railway 未被改动。请先确认 --copy production 是否干净收尾。",
        );
      }
      ok(`${plan.bucket} 对象数 = ${objects.length}`, "非空");
      if (expectObjects != null) {
        ok("对象数与 --expect-objects 一致", `${expectObjects}`);
      } else {
        log("        → 请与 --copy production 的汇总行对照：两边数字应当一致（或本次更多）。");
      }
    }

    log("\n已完成，无需重复铸造：");
    log(`  桶            ${plan.bucket}`);
    log(`  服务          ${RAILWAY_SERVICES.join(", ")}（environment=${plan.railwayEnv}）`);
    log(`  AKID 前缀     ${maskId(envState.current.web.R2_ACCESS_KEY_ID)}`);
    log(`  AKID 指纹     ${fp(envState.current.web.R2_ACCESS_KEY_ID)}`);
    log(`  Secret 指纹   ${fp(envState.current.web.R2_SECRET_ACCESS_KEY)}`);
    log(
      `  作用域反证    对象是 ${envState.otherBucket ?? "(无)"}（该桶被 401/403 拒绝，已证实）`,
    );
    log("\n  ⚠️ 如果你上一次跑到一半失败过，请照当时屏幕上的「半成品状态」，");
    log("  ⚠️ 把多出来的那把令牌和旧的宽权限令牌一并清掉 —— 本次跑不会替你做。");
    await printOldKeyReminder(token, plan, envState.current.web.R2_ACCESS_KEY_ID, {
      minted: false,
    });
    log("\n告诉编排者：写好了（本次没有新建令牌）。");
    return;
  }

  log("\n[回滚参照] 铸造前的旧值指纹（只能用来对照，不能用来还原）：");
  for (const svc of RAILWAY_SERVICES) {
    const v = envState.current[svc] ?? {};
    log(
      `        [${plan.railwayEnv}/${svc}] R2_BUCKET=${v.R2_BUCKET ?? "(未设)"}  ` +
        `AKID指纹=${fp(v.R2_ACCESS_KEY_ID)}  Secret指纹=${fp(v.R2_SECRET_ACCESS_KEY)}  ` +
        `ENDPOINT=${v.R2_ENDPOINT ?? "(未设)"}`,
    );
  }
  log("        ⚠️ 指纹是单向的，反推不出原值；Cloudflare 也只在创建时显示一次 secret。");
  log("        ⚠️ 凭据没有「值级回滚」：真要能改回旧值，必须你自己在跑 --mint 之前先备份现值；");
  log("        ⚠️ 没备份的话，出问题的恢复路径是重跑 --mint 再铸一把新的（见 runbook「回滚」节）。");

  const policies = [
    buildPolicy(ACCOUNT_ID, JURISDICTION, [plan.bucket], [chk.pgRead, chk.pgWrite]),
  ];

  log("\n[铸造] POST /accounts/{id}/tokens");
  log(`        name      = ${plan.tokenName}`);
  log(`        resource  = ${bucketResourceKey(ACCOUNT_ID, JURISDICTION, plan.bucket)}`);
  log(`        perms     = ${PG_READ} (${chk.pgRead.id}) + ${PG_WRITE} (${chk.pgWrite.id})`);

  const made = await createToken(token, {
    name: plan.tokenName,
    policies,
    // 不设 expires_on —— 令牌不过期，按任务要求。
  });
  if (!made.ok) {
    throw new Fatal(
      made.missing
        ? "创建响应里缺 result.id 或 result.value，无法推导 S3 凭据。"
        : "两条创建路径都失败，没有产生任何令牌，Railway 未被改动。",
    );
  }

  // Cloudflare 文档：Access Key ID = 令牌 id；Secret Access Key = 令牌 value 的 SHA-256。
  const accessKeyId = made.id;
  const secretAccessKey = sha256hex(made.value);
  const pathKind = made.pathKind;

  log(`        token id  = ${maskId(made.id)}  （即 Access Key ID）`);
  log(`        AKID 指纹  = ${fp(accessKeyId)}`);
  log(`        Secret 指纹 = ${fp(secretAccessKey)}`);

  const manualRevoke = () => {
    log(
      `        ⚠️ 请到 Cloudflare 后台手工吊销名为 "${plan.tokenName}" 的令牌（id 前缀 ${maskId(made.id)}）。`,
    );
    log(`        ⚠️ 后台路径：${pathKind}`);
  };

  // destroy 自己绝不能抛：它里面的 cf() 是裸 fetch，断网就是 TypeError，
  // 一抛就把下面那句手工吊销指引吞掉，刚建的令牌就成了没人知道前缀的孤儿。
  const destroy = async (why) => {
    log(`\n[回收] ${why} → DELETE ${made.delPath("<token id>")}`);
    try {
      const d = await cf(token, "DELETE", made.delPath(made.id));
      if (d.ok) ok("刚建的令牌已删除", `HTTP ${d.status}`);
      else {
        fail("删除刚建的令牌", `HTTP ${d.status}`);
        printCfErrors(d);
        manualRevoke();
      }
    } catch (e) {
      fail("删除刚建的令牌", `网络错误 ${e?.name ?? "?"} —— 令牌很可能还活着`);
      manualRevoke();
    }
  };

  log("\n[验证] 用推导出的 S3 凭据实测");
  log(`        endpoint = ${envState.endpoint}`);
  let good;
  try {
    good = await probeCredentials(
      envState.endpoint,
      accessKeyId,
      secretAccessKey,
      plan.bucket,
      envState.otherBucket,
    );
  } catch (e) {
    await destroy(`S3 探针抛错：${e.message}`);
    throw new Fatal("S3 验证失败，已回收令牌，Railway 未被改动。");
  }
  if (!good.pass) {
    await destroy("S3 探针不达标");
    throw new Fatal("S3 验证失败，已回收令牌，Railway 未被改动。");
  }
  // 结论行按「反证是否已证实」措辞，不把未证实说成已证实。
  if (good.denialProven) {
    ok(`S3 验证通过（目标桶可读可列，其他桶 ${envState.otherBucket} 被拒 —— 已证实）`);
  } else {
    ok("S3 验证通过（目标桶可读可列；其他桶未见越权，但作用域反证未确证）");
  }

  // production 专属闸：切过去之前，目标桶必须已经有对象。
  // 空桶切换 = 生产瞬间丢图，而且旧钥匙已经删了、artlio 读不回来。
  if (plan.env === "production") {
    log("\n[切换前闸] 用新令牌数一遍目标桶的对象数");
    let objects;
    try {
      const client = makeS3(envState.endpoint, accessKeyId, secretAccessKey);
      objects = await listAllObjects(client, plan.bucket);
    } catch (e) {
      await destroy(`数目标桶对象失败：${e?.name ?? e?.message ?? "?"}`);
      throw new Fatal("数不出目标桶的对象数，已回收令牌，Railway 未被改动。");
    }
    if (objects.length === 0) {
      fail(`${plan.bucket} 对象数 = 0`, "空桶不能切 —— 先跑 --copy production");
      await destroy("目标桶是空的");
      throw new Fatal(
        `${plan.bucket} 里一个对象都没有。先跑 node scripts/tools/mint-r2-token.mjs --copy production ` +
          "把 artlio 的对象搬过去，再回来跑 --mint production --yes-production。",
      );
    }
    // 给了 --expect-objects 就由脚本自己比，不再靠编排者肉眼对数字。
    if (expectObjects != null && objects.length !== expectObjects) {
      fail(
        `${plan.bucket} 对象数 = ${objects.length}`,
        `与 --expect-objects ${expectObjects} 对不上`,
      );
      await destroy("目标桶对象数与 --expect-objects 不符");
      throw new Fatal(
        `目标桶有 ${objects.length} 个对象，与 --expect-objects ${expectObjects} 不符。` +
          "已回收令牌，Railway 未被改动。请先确认 --copy production 是否干净收尾。",
      );
    }
    ok(`${plan.bucket} 对象数 = ${objects.length}`, "非空，可以切");
    if (expectObjects != null) {
      ok("对象数与 --expect-objects 一致", `${expectObjects}`);
    } else {
      log(`        → 请与 --copy production 的汇总行对照：两边数字应当一致（或本次更多）。`);
    }
  }

  const written = {};

  log(`\n[写入] Railway ${plan.railwayEnv}`);
  for (const svc of RAILWAY_SERVICES) {
    written[svc] = [];
    try {
      setRailwayVar(plan.railwayEnv, svc, "R2_BUCKET", plan.bucket, { secret: false });
      written[svc].push("R2_BUCKET");
      // R2_ENDPOINT 是非秘密，但必须一起写：钥匙换了 endpoint 还缺着或指着别的账号，
      // 服务一样连不上，而且屏幕会误报「写好了」。
      setRailwayVar(plan.railwayEnv, svc, "R2_ENDPOINT", envState.endpoint, {
        secret: false,
      });
      written[svc].push("R2_ENDPOINT");
      setRailwayVar(plan.railwayEnv, svc, "R2_ACCESS_KEY_ID", accessKeyId, { secret: true });
      written[svc].push("R2_ACCESS_KEY_ID");
      setRailwayVar(plan.railwayEnv, svc, "R2_SECRET_ACCESS_KEY", secretAccessKey, {
        secret: true,
      });
      written[svc].push("R2_SECRET_ACCESS_KEY");
      ok(`写入 ${plan.railwayEnv}/${svc}`, R2_KEYS.join(" / ") + "（--skip-deploys）");
    } catch (e) {
      fail(`写入 ${plan.railwayEnv}/${svc}`, e.message);
      printHalfDone("Railway 写入中途失败", plan, made.id, pathKind, written);
      throw new Fatal("Railway 写入失败，见上。");
    }
  }

  log("\n[读回] 比对指纹");
  let mismatch = false;
  // 整段包起来：读回这一步**自己读不出来**时，readRailwayVars 会抛 Fatal 直接穿出去，
  // 那样四个键其实已经写好了，屏幕却只有一句「读取失败」——半成品状态必须落屏。
  try {
    for (const svc of RAILWAY_SERVICES) {
      const v = readRailwayVars(plan.railwayEnv, svc);
      const epNow = v.R2_ENDPOINT ?? "";
      const bOk = v.R2_BUCKET === plan.bucket;
      const aOk = fp(v.R2_ACCESS_KEY_ID) === fp(accessKeyId);
      const sOk = fp(v.R2_SECRET_ACCESS_KEY) === fp(secretAccessKey);
      const eOk = epNow === envState.endpoint;
      (bOk && aOk && sOk && eOk ? ok : fail)(
        `读回 ${plan.railwayEnv}/${svc}`,
        `R2_BUCKET=${v.R2_BUCKET ?? "(未设)"}  AKID指纹=${fp(v.R2_ACCESS_KEY_ID)}  Secret指纹=${fp(v.R2_SECRET_ACCESS_KEY)}`,
      );
      if (!eOk) fail(`${svc} 的 R2_ENDPOINT 与本次写入的不一致`, `现值=${epNow || "(未设)"}`);
      if (!(bOk && aOk && sOk && eOk)) mismatch = true;
    }
  } catch (e) {
    printHalfDone("读回时连 Railway 都读不出来", plan, made.id, pathKind, written);
    throw e;
  }
  if (mismatch) {
    printHalfDone("读回的指纹与写入的不一致", plan, made.id, pathKind, written);
    throw new Fatal("读回的指纹与写入的不一致，请人工检查 Railway。");
  }

  log("\n完成：");
  log(`  令牌名        ${plan.tokenName}`);
  log(`  令牌 id 前缀  ${maskId(made.id)}   （= Access Key ID）`);
  log(`  AKID 指纹     ${fp(accessKeyId)}`);
  log(`  Secret 指纹   ${fp(secretAccessKey)}`);
  log(`  桶            ${plan.bucket}`);
  log(`  endpoint      ${envState.endpoint}   （本次已写入两个服务）`);
  log(
    `  写入服务      ${RAILWAY_SERVICES.join(", ")}（environment=${plan.railwayEnv}，--skip-deploys）`,
  );
  log(`  写入的键      ${R2_KEYS.join(" / ")}`);

  const oldAkid = envState.current?.web?.R2_ACCESS_KEY_ID ?? "";
  await printOldKeyReminder(token, plan, oldAkid, { minted: true });

  log("\n告诉编排者：写好了。");
}

// ───────────────────────────── --copy ─────────────────────────────

/** 简易并发池：limit 个 worker 轮流领任务。 */
async function pool(items, limit, fn) {
  let idx = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/** 先清掉上一次跑留下的同名搬运令牌。返回删掉几把。 */
async function purgeStaleMigrationTokens(token) {
  log(`\n[清残留] 查找名为 ${MIGRATION_TOKEN_NAME} 的旧搬运令牌`);
  const rows = await listAllTokens(token);
  if (rows === null) {
    warn("列令牌失败", "无法确认有没有残留搬运令牌 —— 请稍后到 Cloudflare 后台自查");
    return 0;
  }
  const stale = rows.filter((r) => r?.name === MIGRATION_TOKEN_NAME && r?.id);
  if (!stale.length) {
    ok("没有残留搬运令牌", `（账号令牌共 ${rows.length} 把）`);
    return 0;
  }
  warn(`发现 ${stale.length} 把残留搬运令牌`, "逐个删除");
  let removed = 0;
  for (const r of stale) {
    log(`        残留 id 前缀 ${maskId(r.id)}  status=${r.status ?? "?"}`);
    let done = false;
    for (const p of [`/accounts/${ACCOUNT_ID}/tokens/${r.id}`, `/user/tokens/${r.id}`]) {
      try {
        const d = await cf(token, "DELETE", p);
        if (d.ok) {
          ok(`已删除残留 ${maskId(r.id)}`, `HTTP ${d.status}`);
          removed++;
          done = true;
          break;
        }
      } catch {
        /* 换下一条路径 */
      }
    }
    if (!done) {
      fail(`删除残留 ${maskId(r.id)}`, "两条路径都失败 —— 请到 Cloudflare 后台手工删除");
    }
  }
  return removed;
}

/**
 * 铸搬运凭据。首选一把令牌带两条 policy（源桶只读 + 目标桶可写）；
 * Cloudflare 若拒收多 policy，退回铸两把同名令牌各带一条。
 * 返回 { src, dst, ids, destroy }，src/dst 是 { akid, secret }（secret 是秘密）。
 */
async function mintMigrationCreds(token, plan, pgRead, pgWrite) {
  const ids = [];
  const delPaths = new Map();
  const expiry = migrationExpiry();

  const destroy = async () => {
    log("\n[回收搬运令牌]");
    if (!ids.length) {
      ok("没有需要回收的搬运令牌");
      return;
    }
    for (const id of ids) {
      let done = false;
      const candidates = [delPaths.get(id), `/accounts/${ACCOUNT_ID}/tokens/${id}`, `/user/tokens/${id}`]
        .filter(Boolean);
      for (const p of candidates) {
        try {
          const d = await cf(token, "DELETE", p);
          if (d.ok) {
            ok(`搬运令牌已删除`, `id 前缀 ${maskId(id)}  HTTP ${d.status}`);
            done = true;
            break;
          }
        } catch {
          /* 换下一条路径 */
        }
      }
      if (!done) {
        fail("删除搬运令牌", `id 前缀 ${maskId(id)} —— 很可能还活着`);
        log(`        ⚠️ 请到 Cloudflare 后台手工吊销名为 "${MIGRATION_TOKEN_NAME}"、id 前缀 ${maskId(id)} 的令牌。`);
      }
    }
  };

  const remember = (made) => {
    ids.push(made.id);
    delPaths.set(made.id, made.delPath(made.id));
  };

  // 整段包在 try 里：这里面每一个 await 都可能抛（cf() 是裸 fetch，断网就是 TypeError），
  // 而 destroy() 原先只挂在两条正常返回路径上 —— 异常一穿过去，
  // 已经建好的搬运令牌就成了没人回收的孤儿。destroy() 自己不抛，可以安全地放在 catch 里。
  try {
    log("\n[铸搬运令牌] 一把令牌两条 policy：源桶只读 + 目标桶可写");
    log(`        name       = ${MIGRATION_TOKEN_NAME}`);
    log(`        policy #1  = ${SOURCE_BUCKET} → ${PG_READ}`);
    log(`        policy #2  = ${plan.bucket} → ${PG_WRITE}`);
    log(`        expires_on = ${expiry}（一小时后自动到期，兜底 Ctrl-C／被杀的路径）`);
    const both = await createToken(token, {
      name: MIGRATION_TOKEN_NAME,
      expires_on: expiry,
      policies: buildMigrationPolicies({
        accountId: ACCOUNT_ID,
        jurisdiction: JURISDICTION,
        sourceBucket: SOURCE_BUCKET,
        targetBucket: plan.bucket,
        pgRead,
        pgWrite,
      }),
    });
    if (both.ok) {
      remember(both);
      const cred = { akid: both.id, secret: sha256hex(both.value) };
      log(`        token id  = ${maskId(both.id)}  （即 Access Key ID）`);
      log(`        AKID 指纹  = ${fp(cred.akid)}   Secret 指纹 = ${fp(cred.secret)}`);
      return { src: cred, dst: cred, single: true, ids, destroy };
    }

    warn("多 policy 令牌创建失败", "退回「铸两把各带一条 policy」");
    const one = async (bucket, group, role) => {
      log(`\n[铸搬运令牌·${role}] ${bucket} → ${group.name}`);
      const made = await createToken(token, {
        name: MIGRATION_TOKEN_NAME,
        expires_on: expiry,
        policies: [buildPolicy(ACCOUNT_ID, JURISDICTION, [bucket], [group])],
      });
      if (!made.ok) return null;
      remember(made);
      const cred = { akid: made.id, secret: sha256hex(made.value) };
      log(`        token id  = ${maskId(made.id)}`);
      log(`        AKID 指纹  = ${fp(cred.akid)}   Secret 指纹 = ${fp(cred.secret)}`);
      return cred;
    };
    const src = await one(SOURCE_BUCKET, pgRead, "读源桶");
    if (!src) {
      await destroy();
      return null;
    }
    const dst = await one(plan.bucket, pgWrite, "写目标桶");
    if (!dst) {
      await destroy();
      return null;
    }
    return { src, dst, single: false, ids, destroy };
  } catch (e) {
    await destroy();
    throw e;
  }
}

async function runCopy(token, env, { dryRun, allowOverwriteLive, excludePrefixes = [] }) {
  const plan = planFor(env);
  const { GetObjectCommand, PutObjectCommand, HeadObjectCommand } =
    require_(S3_PACKAGE);

  // 搬运不读也不改 Railway：目标桶是不是已经上线，由「按对象冲突」在搬运时逐个判定
  //（两边同 key 但大小不同 = 目标那份可能是线上写的，默认不覆盖），所以只要前三项。
  const chk = await runCheck(token, { envs: [] });
  if (!chk.allOk) throw new Fatal("前三项检查没有全部通过，拒绝搬运。先修好上面的 FAIL 项。");

  if (allowOverwriteLive) {
    warn(
      "[覆盖闸] 已给 --allow-overwrite-live",
      "两边同 key 但大小不同的对象会被 artlio 版本覆盖（线上写入的新版本会丢）",
    );
  }
  if (excludePrefixes.length) {
    log(`[排除] --exclude-prefix ${excludePrefixes.join(" · ")}（这些前缀的对象不搬、也不进校验）`);
  }

  await purgeStaleMigrationTokens(token);

  let exitBad = false;
  // 铸造必须在 try 之内：它一抛（裸 fetch 断网就是 TypeError），
  // 在 try 之外的话 finally 根本还没注册，已建好的令牌没人回收。
  let creds = null;
  try {
    creds = await mintMigrationCreds(token, plan, chk.pgRead, chk.pgWrite);
    if (!creds) throw new Fatal("搬运令牌铸造失败，什么都没搬。");

    // 搬运两端都在本账号，endpoint 用账号默认形状，不依赖 Railway 现值。
    const endpoint = accountEndpoint();
    const S = makeS3(endpoint, creds.src.akid, creds.src.secret);
    const D = makeS3(endpoint, creds.dst.akid, creds.dst.secret);

    log("\n[验通] 两端各做一次 ListObjectsV2(MaxKeys=1)");
    log(`        endpoint = ${endpoint}`);
    const srcOk = await listProbe(S, SOURCE_BUCKET, { label: "（源）" });
    const dstOk = await listProbe(D, plan.bucket, { label: "（目标）" });
    if (!srcOk || !dstOk) throw new Fatal("搬运凭据两端没有全部验通，什么都没搬。");

    // 作用域反证：两个正向门全绿也证明不了「碰不到别的桶」。挑一个既不是源桶
    // 也不是目标桶的第三个桶，用搬运凭据做同一个动词，必须被拒。只读、免费。
    // 单令牌形态下 S 与 D 是同一把，反证一次就覆盖读写两侧；两把令牌的回退形态里
    // D 是独立铸的「目标桶 Write」，不单独反证的话它的作用域一次都没被证伪过。
    const denyBucket = (chk.bucketNames ?? []).find(
      (b) => b !== SOURCE_BUCKET && b !== plan.bucket,
    );
    if (!denyBucket) {
      warn("搬运凭据作用域反证", "没有可用的第三个桶 —— 本次无法证实，按「未证实」处理");
    } else {
      const toProbe = creds.single
        ? [[S, "读写同一把"]]
        : [
            [S, "读源桶"],
            [D, "写目标桶"],
          ];
      for (const [client, role] of toProbe) {
        await denyProbe(client, denyBucket, role);
      }
    }

    log("\n[清点] 列源桶与目标桶");
    const srcAll = await listAllObjects(S, SOURCE_BUCKET);
    const dstBefore = await listAllObjects(D, plan.bucket);
    const srcAllBytes = srcAll.reduce((a, o) => a + (o.Size ?? 0), 0);
    ok(`源桶 ${SOURCE_BUCKET}`, `${srcAll.length} 个对象，共 ${(srcAllBytes / 1048576).toFixed(1)} MB`);
    ok(`目标桶 ${plan.bucket}（搬运前）`, `${dstBefore.length} 个对象`);

    const summary = prefixSummary(srcAll);
    log(`        按第一段路径汇总（共 ${summary.length} 组，按体积降序，最多列 ${MAX_PREFIXES_PRINTED} 组）：`);
    for (const s of summary.slice(0, MAX_PREFIXES_PRINTED)) {
      log(`          ${s.prefix}  ${s.count} 个对象  ${(s.bytes / 1048576).toFixed(1)} MB`);
    }
    if (summary.length > MAX_PREFIXES_PRINTED) {
      log(`          …… 还有 ${summary.length - MAX_PREFIXES_PRINTED} 组未列出`);
    }

    const { kept: srcObjs, excluded } = partitionByPrefixes(srcAll, excludePrefixes);
    if (excludePrefixes.length) {
      const exBytes = excluded.reduce((a, o) => a + (o.Size ?? 0), 0);
      ok(
        `已按前缀剔除 ${excluded.length} 个对象`,
        `共 ${(exBytes / 1048576).toFixed(1)} MB —— 前缀 ${excludePrefixes.join(" · ")}；` +
          `本次实际处理 ${srcObjs.length} 个对象`,
      );
    }

    log(`        前 ${MAX_KEYS_PRINTED} 个 key：`);
    for (const o of srcObjs.slice(0, MAX_KEYS_PRINTED)) log(`          ${o.Key}  (${o.Size} B)`);
    if (srcObjs.length > MAX_KEYS_PRINTED) {
      log(`          …… 还有 ${srcObjs.length - MAX_KEYS_PRINTED} 个未列出`);
    }

    let copied = 0;
    let skipped = 0;
    let failed = 0;
    let conflicted = 0;
    const failedKeys = [];
    const conflictKeys = [];

    log(
      dryRun
        ? "\n[清单] --dry-run：只判断每个对象要不要搬，绝不写目标桶"
        : `\n[搬运] 逐对象 Get→Put，并发 ${COPY_CONCURRENCY}，单对象失败重试 ${COPY_RETRIES} 次`,
    );
    await pool(srcObjs, COPY_CONCURRENCY, async (o) => {
      // 整块读进内存的路子没有天然上限：先按 Size 挡掉超大对象，
      // 别让 4 个并发一起把进程撑爆（进程被杀 = finally 不跑 = 搬运令牌残留）。
      if ((o.Size ?? 0) > MAX_OBJECT_BYTES) {
        failed++;
        failedKeys.push(o.Key);
        fail(
          `跳过超大对象 ${o.Key}`,
          `${o.Size} B 超过单对象上限 ${MAX_OBJECT_BYTES} B —— 请单独处理`,
        );
        return;
      }
      let head = null;
      try {
        head = await D.send(new HeadObjectCommand({ Bucket: plan.bucket, Key: o.Key }));
      } catch {
        head = null; // 不存在或读不到 —— 一律当作要搬
      }
      const decision = copyDecision(head, o.Size, allowOverwriteLive);
      if (decision === "skip") {
        skipped++;
        return;
      }
      if (decision === "conflict") {
        conflicted++;
        conflictKeys.push(o.Key);
        return; // 目标桶那一份可能是线上写的新版本 —— 不覆盖，只点名。
      }
      if (dryRun) {
        copied++; // dry-run 里这是「将要搬」的计数
        return;
      }
      for (let attempt = 0; attempt <= COPY_RETRIES; attempt++) {
        try {
          const g = await S.send(
            new GetObjectCommand({ Bucket: SOURCE_BUCKET, Key: o.Key }),
          );
          // 整对象读进内存再写：R2 的 PutObject 需要长度，流式转发反而要自己算。
          // transformToByteArray() 返回的已经是 Uint8Array，PutObject 的 Body 直接收 ——
          // 再套一层 Buffer.from 是整块拷贝，白白把在飞对象的峰值内存翻倍
          //（而 MAX_OBJECT_BYTES 那道闸正是为了控住这块内存）。
          const body = await g.Body.transformToByteArray();
          await D.send(
            new PutObjectCommand({
              Bucket: plan.bucket,
              Key: o.Key,
              Body: body,
              // 本仓库写 R2 时只设 ContentType，所以这几项对自家对象是空转；
              // artlio 里若有别的途径（后台手工上传、旧版本代码）传进去的对象，
              // 不带上就会在搬运中丢掉。
              ...(g.ContentType ? { ContentType: g.ContentType } : {}),
              ...(g.CacheControl ? { CacheControl: g.CacheControl } : {}),
              ...(g.ContentDisposition
                ? { ContentDisposition: g.ContentDisposition }
                : {}),
              ...(g.ContentEncoding ? { ContentEncoding: g.ContentEncoding } : {}),
              ...(g.Metadata && Object.keys(g.Metadata).length
                ? { Metadata: g.Metadata }
                : {}),
            }),
          );
          copied++;
          return;
        } catch (e) {
          if (attempt === COPY_RETRIES) {
            failed++;
            failedKeys.push(o.Key);
            fail(`复制 ${o.Key}`, `${e?.name ?? "?"} HTTP ${e?.$metadata?.httpStatusCode ?? "?"}`);
          } else {
            await sleep(1000);
          }
        }
      }
    });

    let verifyOk = true;
    if (dryRun) {
      log("\n[校验] --dry-run 不做搬运后校验（没搬东西，没什么好校验的）");
    } else {
      log("\n[校验] 源 key 一个不少 + 随机抽查大小");
      const dstAfter = await listAllObjects(D, plan.bucket);
      // 只比对象数是假闸：源清单一旦被截断，拿被截断的数去比自己必过。
      // 两份完整清单都在手上，直接做 key 集合差集。
      log(`        （信息行）目标 ${dstAfter.length} 个对象，源 ${srcObjs.length} 个对象`);
      const have = new Set(dstAfter.map((d) => d.Key));
      const missing = srcObjs.filter((o) => !have.has(o.Key));
      if (missing.length) {
        fail("完整性校验", `目标桶缺 ${missing.length} 个 key（最多列 ${MAX_KEYS_PRINTED} 个）`);
        for (const o of missing.slice(0, MAX_KEYS_PRINTED)) log(`    ${o.Key}`);
        verifyOk = false;
      } else {
        ok("完整性校验", `源 ${srcObjs.length} 个 key 在目标桶里一个不少`);
      }
      // 抽查的是「搬过去的那一份跟源一样大」。conflict 的对象是**故意没搬**的，
      // 它们两边不一样大正是被判成 conflict 的原因 —— 抽到就必然报一条假红，所以排除。
      const conflictSet = new Set(conflictKeys);
      const samplePool = srcObjs.filter((o) => !conflictSet.has(o.Key));
      const sample = [];
      const picked = new Set();
      const n = Math.min(VERIFY_SAMPLE, samplePool.length);
      while (sample.length < n) {
        const i = randomInt(samplePool.length);
        if (picked.has(i)) continue;
        picked.add(i);
        sample.push(samplePool[i]);
      }
      for (const o of sample) {
        try {
          const h = await D.send(new HeadObjectCommand({ Bucket: plan.bucket, Key: o.Key }));
          if (h.ContentLength === o.Size) {
            ok(`抽查 ${o.Key}`, `${o.Size} B 一致`);
          } else {
            fail(`抽查 ${o.Key}`, `源 ${o.Size} B ≠ 目标 ${h.ContentLength} B`);
            verifyOk = false;
          }
        } catch (e) {
          fail(`抽查 ${o.Key}`, `HeadObject ${e?.name ?? "?"}`);
          verifyOk = false;
        }
      }
    }

    log("\n[汇总]");
    log(
      `  ${dryRun ? "将复制" : "copied"} ${copied} / skipped ${skipped} / conflict ${conflicted}` +
        ` / failed ${failed}` +
        `   源 ${srcObjs.length} 个对象` +
        (excluded.length ? `（另有 ${excluded.length} 个按前缀剔除）` : "") +
        `  ${SOURCE_BUCKET} → ${plan.bucket}`,
    );
    if (conflictKeys.length) {
      log(`  冲突的 key —— 两边都有但大小不同，本次没动（最多列 ${MAX_KEYS_PRINTED} 个）：`);
      for (const k of conflictKeys.slice(0, MAX_KEYS_PRINTED)) log(`    ${k}`);
      if (conflictKeys.length > MAX_KEYS_PRINTED) {
        log(`    …… 还有 ${conflictKeys.length - MAX_KEYS_PRINTED} 个未列出`);
      }
    }
    if (failedKeys.length) {
      log(`  失败的 key（最多列 ${MAX_KEYS_PRINTED} 个）：`);
      for (const k of failedKeys.slice(0, MAX_KEYS_PRINTED)) log(`    ${k}`);
    }
    log(`  校验结果  ${dryRun ? "（dry-run 未校验）" : verifyOk ? "通过" : "不通过"}`);

    if (conflicted > 0) {
      exitBad = true;
      fail(
        `有 ${conflicted} 个对象冲突`,
        `目标桶 ${plan.bucket} 里这些对象与 ${SOURCE_BUCKET} 不同，可能是线上写入；` +
          `确需用 ${SOURCE_BUCKET} 版本覆盖再加 --allow-overwrite-live`,
      );
    }
    if (failed > 0 || !verifyOk) {
      exitBad = true;
      fail("搬运未干净收尾", "重跑 --copy 即可（已搬且大小相同的对象会自动跳过）");
    } else if (conflicted > 0) {
      // 冲突以外都干净：说清楚「除了冲突那些，其余都到位了」，免得看着 exit 1 以为全砸了。
      log(`  除冲突外全部到位（${dryRun ? "dry-run 未写入" : "已写入目标桶"}）。`);
    } else if (dryRun) {
      ok("dry-run 结束", `去掉 --dry-run 就会真的搬这 ${copied} 个对象`);
    } else {
      ok("搬运完成", `目标桶 ${plan.bucket} 已就位`);
      if (plan.env === "production") {
        log("\n  下一步：等 Founder 明说「切」，再跑");
        log("    node scripts/tools/mint-r2-token.mjs --mint production --yes-production");
        log("  那一步会先用新令牌数一遍目标桶对象数，应当与上面的数字对得上。");
      } else {
        log("\n  下一步：node scripts/tools/mint-r2-token.mjs --mint staging");
      }
    }
  } finally {
    if (creds) await creds.destroy();
  }

  if (exitBad) process.exitCode = 1;
}

// ───────────────────────────── CLI ─────────────────────────────

const help = () => `
mint-r2-token.mjs — R2 桶级钥匙与对象搬运。账号 ${ACCOUNT_ID}。
railway CLI 在 ${RAILWAY_LINKED_DIR} 里跑（环境变量 RAILWAY_LINKED_DIR，默认当前目录）。

用法
  node scripts/tools/mint-r2-token.mjs --check
      只读体检。验令牌 / 列 R2 权限组 / 确认三个桶（${ALL_BUCKETS.join(" · ")}）都在 /
      读 staging 与 production 四个服务的 R2_* 指纹并校验 endpoint 归属。全程不发 S3 请求。

  node scripts/tools/mint-r2-token.mjs --copy staging [--dry-run] [--exclude-prefix <前缀>]…
  I_UNDERSTAND_THIS_TOUCHES_PROD=yes node scripts/tools/mint-r2-token.mjs --copy production [--dry-run] […]
      把 ${SOURCE_BUCKET} 的对象搬进目标桶。临时铸一把只在进程内用的搬运令牌
      （名字 ${MIGRATION_TOKEN_NAME}，源桶只读 + 目标桶可写），跑完在 finally 里删掉。
      逐对象 Get→Put；--dry-run 只列清单不写。清点时先按第一段路径打一份体积汇总。
      逐对象三态：目标桶没有 → 搬；同名同大小 → 跳过；同名但大小不同 → conflict，
      默认**不覆盖**、点名落屏（最多 ${MAX_KEYS_PRINTED} 个），conflict > 0 就 exit 1 ——
      目标桶那一份很可能是线上写进去的新版本。确需用 ${SOURCE_BUCKET} 版覆盖才加 --allow-overwrite-live。
      目标桶独有的 key 永不触碰。不读也不改 Railway。
      搬完按 key 集合比对：源桶的每个 key 都必须出现在目标桶，缺一个就 FAIL 并 exit 1。
      单对象上限 256 MiB（整块读进内存的路子），超限的对象按 failed 计并落屏，请单独处理。
      搬运令牌带一小时 expires_on：进程被 Ctrl-C／被杀时 finally 不跑，靠它兜底自动到期。
      **--copy production 也要带 I_UNDERSTAND_THIS_TOUCHES_PROD=yes**：2026-09-09 切换完成后
      fikirtive-production 就是线上正在读的桶，往里写对象＝碰生产（--dry-run 一样要，路径同一条）。

  node scripts/tools/mint-r2-token.mjs --mint staging
  I_UNDERSTAND_THIS_TOUCHES_PROD=yes node scripts/tools/mint-r2-token.mjs --mint production --yes-production
      给目标桶铸一把只管这一个桶的 R2 钥匙，实测后写进 Railway 对应环境的 web + worker。
      写入的键：R2_BUCKET / R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY。
      production 必须带 --yes-production（Founder 明说「切」之后才加），
      而且必须带环境变量 I_UNDERSTAND_THIS_TOUCHES_PROD=yes（全仓统一的碰生产确认锁，
      scripts/tools/_interlock.mjs）—— 缺它在读钥匙串之前就退出，不发任何请求；
      而且目标桶对象数为 0 时直接 FAIL —— 先跑 --copy production。
      可选 --expect-objects <n>：把 --copy production 汇总行里的源对象数填进来，
      对不上就回收令牌并 FAIL，不再靠肉眼对数字。

  node scripts/tools/mint-r2-token.mjs --help
      本帮助

可选
  --dry-run                           只对 --copy 有效：只列清单，不写任何对象
  --allow-overwrite-live              只对 --copy 有效：冲突对象也覆盖（用 ${SOURCE_BUCKET} 版盖掉目标桶那份）
  --exclude-prefix <前缀>             只对 --copy 有效：这个前缀的对象不搬也不进校验；可重复给
                                      （staging 不该收生产库备份：--exclude-prefix backups/）
  --yes-production                    只对 --mint production 有效：确认这是 Founder 说的「切」
  --expect-objects <n>                只对 --mint production 有效：目标桶对象数必须正好等于 n
  --keychain-service <name>           改用别的钥匙串条目名（默认 cloudflare-api-token-belcort）
  --account-id <32 位十六进制>        改用别的 Cloudflare 账号（默认 ${DEFAULT_ACCOUNT_ID}）

它绝不会打印
  Cloudflare API token、S3 Secret Access Key、完整的 Access Key ID、任何对象的内容。
  打印的只有 HTTP 状态、权限组名字与 id、桶名、服务名、对象 key 与大小、
  sha256 指纹前 12 位、AKID 前 6 位。

顺序：--check → --copy staging --exclude-prefix backups/ → --mint staging
     → I_UNDERSTAND_THIS_TOUCHES_PROD=yes … --copy production（不排除）
     →（Founder 说「切」）→ I_UNDERSTAND_THIS_TOUCHES_PROD=yes … --mint production --yes-production --expect-objects <n>
文档依据见 docs/runbooks/r2-bucket-token-rotation.md。
`;

async function main() {
  const argv = process.argv.slice(2);
  // --account-id 先扫一遍：ACCOUNT_ID 被帮助文本和后面每一个 URL 用到，
  // 必须在任何输出与任何请求之前定下来。只读 argv，不动手。
  {
    const at = argv.indexOf("--account-id");
    if (at !== -1) {
      const raw = argv[at + 1];
      if (!/^[0-9a-f]{32}$/.test(raw ?? "")) {
        throw new Fatal("--account-id 后面要跟 32 位小写十六进制的 Cloudflare 账号 id。");
      }
      ACCOUNT_ID = raw;
    }
  }
  // --help 无条件短路：`--mint --help` 绝不能真的动手。
  if (argv.includes("--help") || argv.includes("-h")) {
    log(help().trim());
    return;
  }
  let mode = null;
  let env = null;
  let dryRun = false;
  let allowOverwriteLive = false;
  let yesProduction = false;
  let expectObjects = null;
  const excludePrefixes = [];
  let service = "cloudflare-api-token-belcort";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") {
      if (mode) throw new Fatal("一次只能给一个子命令。");
      mode = "check";
    } else if (a === "--mint" || a === "--copy") {
      if (mode) throw new Fatal("一次只能给一个子命令。");
      mode = a.slice(2);
      env = argv[++i];
      if (!env || env.startsWith("-")) {
        throw new Fatal(`${a} 后面要跟环境名：${ENVS.join(" 或 ")}。`);
      }
      planFor(env); // 提前校验，错的环境名不进网络
    } else if (a === "--dry-run") dryRun = true;
    else if (a === "--allow-overwrite-live") allowOverwriteLive = true;
    else if (a === "--yes-production") yesProduction = true;
    else if (a === "--expect-objects") {
      const raw = argv[++i];
      if (!/^\d+$/.test(raw ?? "")) {
        throw new Fatal("--expect-objects 后面要跟一个非负整数（--copy 汇总行里的源对象数）。");
      }
      expectObjects = Number(raw);
    } else if (a === "--exclude-prefix") {
      const raw = argv[++i];
      if (!raw || raw.startsWith("-")) {
        throw new Fatal("--exclude-prefix 后面要跟一个 key 前缀（例如 backups/）。可重复给。");
      }
      excludePrefixes.push(raw);
    }
    else if (a === "--account-id") {
      i++; // 值在 --help 短路之前已经预扫过（见下方 main 开头），这里只跳过它
    } else if (a === "--keychain-service") {
      service = argv[++i];
      if (!service) throw new Fatal("--keychain-service 后面要跟条目名。");
    } else throw new Fatal(`不认识的参数：${a}（用 --help 看用法）`);
  }
  if (!mode) {
    log(help().trim());
    return;
  }
  if (dryRun && mode !== "copy") throw new Fatal("--dry-run 只对 --copy 有效。");
  if (allowOverwriteLive && mode !== "copy") {
    throw new Fatal("--allow-overwrite-live 只对 --copy 有效。");
  }
  if (excludePrefixes.length && mode !== "copy") {
    throw new Fatal("--exclude-prefix 只对 --copy 有效。");
  }
  if (expectObjects != null && !(mode === "mint" && env === "production")) {
    throw new Fatal("--expect-objects 只对 --mint production 有效。");
  }

  // 碰生产确认锁（scripts/tools/_interlock.mjs 的统一约定，与 prod-* 脚本同一把）。
  // --mint production 会改 Railway production 上 web 与 worker 的 R2 凭据 —— 真正的切换动作。
  // --copy production 也在锁内：2026-09-09 切换完成之后，fikirtive-production 就是活生产桶，
  // 再跑 --copy production 是往线上正在读的桶里写对象（--dry-run 也一样要锁，路径同一条）。
  // --yes-production 证明「Founder 说过切」，这道锁证明「跑的人知道自己在碰生产」，两者都要。
  // 位置在读钥匙串之前：缺锁时一个秘密都不会被读出来，也不会发出任何请求。
  if (env === "production" && (mode === "mint" || mode === "copy")) {
    interlock({
      prod:
        mode === "mint"
          ? "Railway production 的 web 与 worker 的 R2 凭据（写完线上就用新桶新钥匙）"
          : "fikirtive-production 桶（切换完成后线上正在读的那个桶）",
    });
  }

  const target = env ? `${env}（桶 ${planFor(env).bucket}）` : "staging + production";
  log(`账号 ${ACCOUNT_ID}   本次目标 ${target}   钥匙串条目 ${service}`);
  log(`railway 目录 ${RAILWAY_LINKED_DIR}`);

  log("\n[0/4] 取 Cloudflare API token（钥匙串）");
  const cfToken = readTokenFromKeychain(service);
  ok("已从钥匙串取到令牌（值不打印）");

  if (mode === "check") await runCheck(cfToken);
  else if (mode === "mint") await runMint(cfToken, env, { yesProduction, expectObjects });
  else await runCopy(cfToken, env, { dryRun, allowOverwriteLive, excludePrefixes });
}

// 只有被直接 `node scripts/tools/mint-r2-token.mjs …` 跑起来时才动手；
// 被测试文件 import 时只暴露纯函数，什么都不执行。
const invokedDirectly = (() => {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((e) => {
    if (e instanceof Fatal) console.error(`\n错误：${e.message}`);
    else console.error(`\n未预期错误：${e?.message ?? e}`);
    process.exitCode = 1;
  });
}
