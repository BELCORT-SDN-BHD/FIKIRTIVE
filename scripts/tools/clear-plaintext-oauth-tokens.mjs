#!/usr/bin/env node
/**
 * #795 —— 存量明文 OAuth 令牌的清理(**手动**,不进 migration)。
 *
 * 背景。Google 登录的 access/refresh/id 令牌此前明文存在 `ba_account` 里。#795 打开了
 * Better Auth 的 `account.encryptOAuthTokens`,从此 access/refresh 的**新写入**一律走库自己的
 * 对称加密(XChaCha20-Poly1305,密钥取 BETTER_AUTH_SECRET 的 SHA-256;**我们是单密钥形态,
 * 密文就是裸十六进制、不带 `$ba$` 信封** —— 信封只出现在多密钥/轮换形态里);但已经躺在库里
 * 的旧行不会因为开关而自己变样 —— Better Auth 读到「看起来不像密文」的
 * 值会原样放行(向后兼容),所以旧行会一直是明文,直到那个账号下次用 Google 登录。
 *
 * `idToken` 不在那个开关的覆盖范围内,而且**库外也加不了密**:库把这一列原样返回、从不解密,
 * 所以在外面加密等于让端点把密文当令牌交出去。它因此仍是明文 —— 这条残余风险登记在 PR 与
 * #795 上,本脚本提供的是缓解:`--expired-id-tokens` 清掉那些**自己已经过期**的 ID 令牌。
 *
 * ── 两种模式 ──────────────────────────────────────────────────────────────────────────────
 *
 * ① 默认:清空**明文**的 access/refresh/id 三列(「是不是密文」照抄库自己的判定,见下面的
 *    `looksEncrypted`)。
 *    为什么是「清空」而不是「就地加密」:就地加密要在脚本里复刻库的信封格式,复刻错了的后果是
 *    「库里有一列谁也解不开的字符串」,而且要到很久以后才会有人发现;清空之后该账号下次用
 *    Google 登录时库会重新写入,那一次就是密文。
 *    **代价要说清**:清空之后到该商家再次用 Google 登录之前,库的 `/get-access-token`、
 *    `/refresh-token` 对这个账号答不出令牌(这个产品自己不调这两个端点,商家登录本身也不依赖
 *    这三列 —— 会话不在这里)。
 *
 * ② `--expired-id-tokens`:只清 `idToken`,而且只清能证明**已经过期**的那些(解析 JWT 自己的
 *    `exp`,不看别的列)。解析不出来的一律不动 —— 说不清的数据不删。
 *
 * 为什么不是 migration。migration 在部署时自动执行,而这是一次**数据改动**。按项目规矩,
 * 生产上的存量转换要由 Founder 先确认备份与恢复方案,再单独执行 —— 所以它是一个要人明确
 * 敲下去的脚本,不是一次静默的部署副作用。
 *
 * 用法(默认 DRY RUN,只数数不改):
 *   pnpm --filter "./packages/*" build
 *   DATABASE_URL=... node scripts/tools/clear-plaintext-oauth-tokens.mjs
 *   DATABASE_URL=... node scripts/tools/clear-plaintext-oauth-tokens.mjs --confirm
 *   DATABASE_URL=... node scripts/tools/clear-plaintext-oauth-tokens.mjs --expired-id-tokens
 *   DATABASE_URL=... node scripts/tools/clear-plaintext-oauth-tokens.mjs --expired-id-tokens --confirm
 *
 * 脚本本身不打印任何令牌值,一个字符都不打印。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const distUrl = pathToFileURL(path.join(root, "packages/db/dist/src/index.js")).href;

let prisma;
try {
  ({ prisma } = await import(distUrl));
} catch {
  console.error('[oauth-tokens] packages/db 未构建 —— 先跑:pnpm --filter "./packages/*" build');
  process.exit(1);
}

const confirmed = process.argv.includes("--confirm");
const expiredIdTokensOnly = process.argv.includes("--expired-id-tokens");

/** JWT 的 `exp`(秒)。解析不出来就返回 null —— 说不清的数据不删。令牌值不出现在任何输出里。 */
function expiryOf(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload?.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

if (expiredIdTokensOnly) {
  const rows = await prisma.betterAuthAccount.findMany({
    where: { idToken: { not: null } },
    select: { id: true, providerId: true, idToken: true },
  });

  const expired = [];
  let unparseable = 0;
  let live = 0;
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const row of rows) {
    const exp = expiryOf(row.idToken);
    if (exp === null) unparseable += 1;
    else if (exp <= nowSeconds) expired.push({ id: row.id, idToken: row.idToken });
    else live += 1;
  }

  console.log(`[oauth-tokens] 带 idToken 的账号行:${rows.length}`);
  console.log(`[oauth-tokens]   已过期(可清):${expired.length}`);
  console.log(`[oauth-tokens]   仍在有效期:${live}`);
  console.log(`[oauth-tokens]   解析不出有效期(不动):${unparseable}`);

  if (expired.length === 0 || !confirmed) {
    if (!confirmed) console.log("[oauth-tokens] DRY RUN —— 什么都没改。加 --confirm 才会执行。");
    await prisma.$disconnect();
    process.exit(0);
  }

  // 同一个时间差在这里更要命:一次刚发生的登录会写入一个**没过期**的新 idToken,而它的 id
  // 还在上面那张单子上。所以 WHERE 里带上刚才读到的那个值 —— 值变了就不动。
  let cleared = 0;
  let skipped = 0;
  for (const row of expired) {
    const result = await prisma.betterAuthAccount.updateMany({
      where: { id: row.id, idToken: row.idToken },
      data: { idToken: null },
    });
    if (result.count === 1) cleared += 1;
    else skipped += 1;
  }
  console.log(`[oauth-tokens] 已清空 ${cleared} 行的过期 idToken。`);
  if (skipped > 0) {
    console.log(`[oauth-tokens] ${skipped} 行在扫描之后被改过(多半是刚登录过),这一轮跳过。`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

/**
 * 「这一列是不是密文」的判定,**照抄库自己的那条**(better-auth 1.6.20,
 * `oauth2/utils.mjs` 的 `isLikelyEncrypted`):
 *
 *     $ba$ 开头  →  密文(带信封的多密钥形态)
 *     否则:长度为偶数且全是十六进制字符  →  密文(**单密钥形态没有信封,就是裸十六进制**)
 *
 * r5 更正:上一版只认 `$ba$` 前缀,把裸十六进制的**有效密文当成了明文**。我们用的正是单密钥
 * 形态(`symmetricEncrypt` 收到字符串密钥时走 `rawEncrypt`,直接返回 hex,不套信封),所以那
 * 一版的 `--confirm` 会把已经加密好的令牌一并清掉 —— 判定要和库的判定是同一条,否则脚本和库
 * 对同一个字符串会有两种看法。
 *
 * 一个真实的 OAuth 令牌不会被误判成密文:Google 的 access token(`ya29.…`)、refresh token
 * (`1//…`)和 ID token(JWT,带 `.`)都含非十六进制字符。
 */
const looksEncrypted = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  (value.startsWith("$ba$") || (value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value)));

const TOKEN_COLUMNS = ["accessToken", "refreshToken", "idToken"];
const isPlaintextValue = (value) => typeof value === "string" && value.length > 0 && !looksEncrypted(value);

// 判定要看值本身,SQL 里表达不了,所以扫描在内存里做(令牌值只进比较,不进任何输出)。
const candidates = await prisma.betterAuthAccount.findMany({
  select: { id: true, providerId: true, accessToken: true, refreshToken: true, idToken: true },
});

const rows = candidates.filter((row) => TOKEN_COLUMNS.some((column) => isPlaintextValue(row[column])));

const byProvider = rows.reduce((acc, r) => {
  acc[r.providerId] = (acc[r.providerId] ?? 0) + 1;
  return acc;
}, {});

const encryptedRows = candidates.filter(
  (row) => !rows.includes(row) && TOKEN_COLUMNS.some((column) => looksEncrypted(row[column])),
).length;

console.log(`[oauth-tokens] 账号行合计:${candidates.length}`);
console.log(`[oauth-tokens]   至少有一列是明文(会被清):${rows.length}`);
console.log(`[oauth-tokens]   全部已加密(不动):${encryptedRows}`);
for (const [provider, count] of Object.entries(byProvider)) {
  console.log(`[oauth-tokens]   明文行 · ${provider}: ${count}`);
}

if (rows.length === 0) {
  console.log("[oauth-tokens] 没有要清的行。");
  await prisma.$disconnect();
  process.exit(0);
}

if (!confirmed) {
  console.log("[oauth-tokens] DRY RUN —— 什么都没改。确认备份与恢复方案之后,加 --confirm 再跑一次。");
  console.log("[oauth-tokens] 影响:这些账号下次用 Google 登录时,Better Auth 会重新写入令牌(那一次是密文)。");
  console.log("[oauth-tokens]       在那之前,库的 /get-access-token、/refresh-token 对这些账号答不出令牌。");
  console.log("[oauth-tokens]       登录本身不受影响 —— 会话不依赖这三列。");
  await prisma.$disconnect();
  process.exit(0);
}

/**
 * 逐行更新,而且 WHERE 里**带上刚才读到的那三个值**(r5:扫描和更新之间有时间差 —— 这中间
 * 商家可能刚登录过一次,库会写入新的、已经加密的令牌。按 id 盲更新会把那份新密文一起清掉,
 * 商家下次用到 Google 令牌时才会发现)。值没变才更新;变了就跳过,并且报出来。
 */
let cleared = 0;
let skipped = 0;
for (const row of rows) {
  const guard = { id: row.id };
  for (const column of TOKEN_COLUMNS) guard[column] = row[column];
  const result = await prisma.betterAuthAccount.updateMany({
    where: guard,
    data: { accessToken: null, refreshToken: null, idToken: null },
  });
  if (result.count === 1) cleared += 1;
  else skipped += 1;
}
console.log(`[oauth-tokens] 已清空 ${cleared} 行的三列令牌。`);
if (skipped > 0) {
  console.log(`[oauth-tokens] ${skipped} 行在扫描之后被改过(多半是刚登录过),这一轮跳过 —— 重跑一次即可。`);
}
await prisma.$disconnect();
