/**
 * /api/meta/data-deletion — Meta 的 Data Deletion Request 回调(2026-07-04 法务
 * 盲区修复;Meta App 转 Live 的合规前置)。Meta 在用户于 Facebook 侧移除本应用
 * 时 POST form-encoded 的 signed_request 过来。
 *
 * 鉴权 = signed_request 的 HMAC 签名(proxy.ts 已放行本路径,无 session)。
 * 有效签名 → 删除 metaUserId 匹配的 MetaConnection(加密 token 随行删除 = 我们
 * 持有的 Meta 侧凭据即刻清除)+ 每个受影响 org 记一条 ActionEvent 审计,并按
 * Meta 规范返回 { url, confirmation_code }(用户可凭 code 在状态页核对)。
 * 找不到匹配也返回 200 + code —— "无可删"是合法结果,Meta 只要求可追溯。
 * 反过来说:可追溯是发码的前提,审计写不进去就不发码(5xx,Meta 重试)。
 */
import { prisma } from "@fikirtive/db";
import { runAsSystem, runAsTenant } from "@fikirtive/db/principal";
import { newId } from "@fikirtive/core";
import { parseMetaSignedRequest } from "@/lib/meta-signed-request";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// #463: no session by construction (the HMAC is the auth), and ONE request legitimately writes
// to N different tenants. That is the two-phase shape: the handler runs under the named system
// identity "meta-data-deletion", and each per-org transaction re-enters under that org.
export async function POST(req: NextRequest | Request): Promise<Response> {
  return runAsSystem("meta-data-deletion", () => handleDataDeletion(req));
}

async function handleDataDeletion(req: NextRequest | Request): Promise<Response> {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return Response.json({ error: "not configured" }, { status: 400 }); // fail-closed

  let signedRequest = "";
  try {
    const form = new URLSearchParams(await req.text());
    signedRequest = form.get("signed_request") ?? "";
  } catch {
    /* fall through to 400 */
  }
  const parsed = signedRequest ? parseMetaSignedRequest(signedRequest, secret) : null;
  if (!parsed) return Response.json({ error: "invalid signed_request" }, { status: 400 });

  const confirmationCode = newId();
  // 删除范围(founder 可复核):只删 MetaConnection 行 = 我们持有的 Meta 侧凭据
  // (加密 token + 连接身份)。用户自己在 FIKIRTIVE 里的工作产物(排期帖、campaign、
  // 生成素材)是他们的资产,不随一次"Meta 数据删除"销毁 —— 删除整个账户走
  // privacy 页的 tao@belcort.com 流程。若 founder 认为合规要求更宽,在此扩展。
  // metaUserId 是 Meta 侧的 app-scoped user id;一个 Meta 用户可能连过多个 org。
  const matches = await prisma.metaConnection.findMany({
    where: { metaUserId: parsed.userId },
    select: { id: true, ownerId: true },
  });
  for (const m of matches) {
    // per-org phase: the scan above is cross-tenant, this write is not
    await runAsTenant(m.ownerId, () => prisma.$transaction(async (tx) => {
      await tx.metaConnection.delete({ where: { id: m.id } });
      await tx.actionEvent.create({
        data: {
          id: newId(),
          ownerId: m.ownerId,
          type: "meta.data_deletion",
          payload: { metaUserId: parsed.userId, connectionId: m.id, confirmationCode },
        },
      });
    }));
  }
  if (matches.length === 0) {
    // 无匹配也留一条平台级痕迹。
    // #573:确认码照发(Meta 规范要求幂等,「无可删」是合法结果),但审计行必须
    // 如实说明发码时**一行都没删** —— matched: 0 显式写进 payload,而不是让审计
    // 读者从 type 后缀去推断。匹配>0 的事务内审计原样不动。
    // #573 复审:这条写入不是 best-effort。确认码是「本次回调已入账、日后可查」的
    // 凭据,痕迹落不了盘(founder org 缺失、库故障)就不能发码 —— 吞掉失败等于发一张
    // 背后什么都没有的码。改为 fail-closed 回 5xx,Meta 会按规范重试。
    try {
      await prisma.actionEvent.create({
        data: { id: newId(), ownerId: "founder", type: "meta.data_deletion.nomatch", payload: { metaUserId: parsed.userId, confirmationCode, matched: 0 } },
      });
    } catch {
      return Response.json({ error: "audit unavailable" }, { status: 503 });
    }
  }

  const origin = process.env.APP_ORIGIN ?? new URL(req.url).origin;
  return Response.json({
    url: `${origin}/legal/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}
