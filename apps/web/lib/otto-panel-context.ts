"use server";
/**
 * otto-panel-context.ts —— 上下文 chip 上那个**对象的真名字**。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4;票 #995(W2-8)。
 *
 * 为什么要一次取数:chip 上写的是「On this page: Raya promo」,那是商家自己给这条战役起的
 * 名字。地址里只有 id,名字只有数据库知道 —— 在界面上按 id 编一个名字,或者退而写死
 * 「On this page: Campaign」,都是在 chip 上说一句不是事实的话。
 *
 * 租户:`requireOwner()` 决定 ownerId,查询逐条带 ownerId。客户端只递一个 id,递别人的
 * id 拿回的是 null(不是别人的名字,也不是一句「无权访问」——面板只会不画 chip)。
 */
import { prisma } from "@fikirtive/db";
import { runAsUser } from "@fikirtive/db/principal";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";

/** 面板认得的对象种类。与 `panel-page.ts` 的对象路由表一一对应。 */
type PanelContextObjectKind = "campaign";

/**
 * 读一个对象在 chip 上该显示的名字。
 *
 * 读不到就是 `null`(没登录、不是自己的、已删除、id 形状不对都算读不到)——面板据此
 * 不画 chip,而不是画一个空的或猜出来的。
 */
export async function loadOttoPanelContextName(
  kind: PanelContextObjectKind,
  objectId: string,
): Promise<{ name: string } | null> {
  if (typeof objectId !== "string" || !objectId || objectId.length > 64) return null;
  const gate = await requireOwner();
  if ("error" in gate) return null;

  // `runAsUser` 帧 —— 与同族的 `otto-panel-seed.ts` 同一条 B1 缝(#464 ②-B)。
  // 这一条查询本身已经带 ownerId,开帧是为了让面板这一族的读**全部**在同一个身份上下文里:
  // 一族里有一处例外,下一个人就会照着那一处写。
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async () => {
    try {
      if (kind === "campaign") {
        const row = await prisma.campaign.findFirst({
          where: { id: objectId, ownerId: gate.ownerId, deletedAt: null },
          select: { name: true },
        });
        return row?.name ? { name: row.name } : null;
      }
      return null;
    } catch {
      return null;
    }
  });
}
