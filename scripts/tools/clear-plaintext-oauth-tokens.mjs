#!/usr/bin/env node
/**
 * #795 —— 存量明文 OAuth 令牌的清理(**手动**,不进 migration)。
 *
 * 背景。Google 登录的 access/refresh/id 令牌此前明文存在 `ba_account` 里。#795 打开了
 * Better Auth 的 `account.encryptOAuthTokens`,从此**新写入**的令牌一律 AES-256-GCM 落库;
 * 但已经躺在库里的旧行不会因为开关而自己变样 —— Better Auth 读到「看起来不像密文」的值
 * 会原样放行(向后兼容),所以旧行会一直是明文,直到那个账号下次用 Google 登录。
 *
 * 为什么是「清空」而不是「就地加密」。
 *   ① 全仓扫描(2026-08-11)显示**没有任何代码**读取 ba_account 的 accessToken /
 *      refreshToken / idToken —— Google 在这个产品里只用来证明「你是你」,不用来调 Google
 *      的任何 API。存着的是一把我们从不使用的钥匙。
 *   ② 就地加密要在脚本里复刻 Better Auth 的密钥封装格式($ba$ 信封 + 版本号)。复刻错了
 *      的后果是「库里有一列谁也解不开的字符串」,而且要到很久以后才会有人发现。
 *   ③ 清空之后,该账号下次用 Google 登录时 Better Auth 会重新写入 —— 那一次就是密文。
 *   不使用的钥匙,最安全的形态是不存在。
 *
 * 为什么不是 migration。migration 在部署时自动执行,而这是一次**数据改动**。按项目规矩,
 * 生产上的存量转换要由 Founder 先确认备份与恢复方案,再单独执行 —— 所以它是一个要人明确
 * 敲下去的脚本,不是一次静默的部署副作用。
 *
 * 用法(默认 DRY RUN,只数数不改):
 *   pnpm --filter "./packages/*" build
 *   DATABASE_URL=... node scripts/tools/clear-plaintext-oauth-tokens.mjs
 *   DATABASE_URL=... node scripts/tools/clear-plaintext-oauth-tokens.mjs --confirm
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

/**
 * Better Auth 写出来的密文带 `$ba$` 信封前缀。选中的条件是「**任意一列**非空且不带这个
 * 前缀」—— 也就是至少有一列还是明文。三列一起清空:把一列已经加密的也清掉是无害的
 * (那把钥匙我们本来就不用),而少清一列不是。
 */
const isPlaintext = (column) => ({
  AND: [{ [column]: { not: null } }, { NOT: { [column]: { startsWith: "$ba$" } } }],
});
const PLAINTEXT = { OR: [isPlaintext("accessToken"), isPlaintext("refreshToken"), isPlaintext("idToken")] };

const rows = await prisma.betterAuthAccount.findMany({
  where: PLAINTEXT,
  select: { id: true, providerId: true },
});

const byProvider = rows.reduce((acc, r) => {
  acc[r.providerId] = (acc[r.providerId] ?? 0) + 1;
  return acc;
}, {});

console.log(`[oauth-tokens] 带明文令牌的账号行:${rows.length}`);
for (const [provider, count] of Object.entries(byProvider)) {
  console.log(`[oauth-tokens]   ${provider}: ${count}`);
}

if (rows.length === 0) {
  console.log("[oauth-tokens] 没有要清的行。");
  await prisma.$disconnect();
  process.exit(0);
}

if (!confirmed) {
  console.log("[oauth-tokens] DRY RUN —— 什么都没改。确认备份与恢复方案之后,加 --confirm 再跑一次。");
  console.log("[oauth-tokens] 影响:这些账号下次用 Google 登录时,Better Auth 会重新写入令牌(那一次是密文)。");
  console.log("[oauth-tokens]       登录本身不受影响 —— 会话不依赖这三列。");
  await prisma.$disconnect();
  process.exit(0);
}

const result = await prisma.betterAuthAccount.updateMany({
  where: PLAINTEXT,
  data: { accessToken: null, refreshToken: null, idToken: null },
});
console.log(`[oauth-tokens] 已清空 ${result.count} 行的三列令牌。库里不再有明文 OAuth 令牌。`);
await prisma.$disconnect();
