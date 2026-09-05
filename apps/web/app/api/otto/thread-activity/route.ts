/**
 * `/api/otto/thread-activity` —— 「有没有东西正在跑」这一句,两种问法。
 *
 * ① `?projectId=P` → `{ activity: [{ threadId, pending }] }`。一个 project 里每条对话
 *    各一行,owner+project 双闸(既有契约,一个字没动)。
 * ② **不带参数** → `{ pending: boolean }`。侧栏面板问的那一句:这次到访要不要因为
 *    「**这个商家**有进行中的面板对话」而展开(FRONT-A14,`docs/specs/frontend-baseline.md`
 *    §5)。口径是全店,不是「本页」——这里从前写的是后者(#1215 判官 P2-3),而②这一问
 *    根本不带 project,读者照文件头理解会读成一句它从未做过的判断。
 *    判据与租户口径写在 `lib/thread-activity.ts` 的 `hasPendingPanelThread` 上;这里没有
 *    project 参数是有意的——面板挂在每一个商家表面上,不属于任何一个 project。
 *
 * 两问共用一条路由而不是各开一条:它们问的是同一件事实(在途的生成),只是切法不同;
 * 分成两条会让「什么算在途」这条定义有两个门,而门后是同一个 `lib/thread-activity.ts`。
 *
 * 租户一律由 `requireOwner()` 在数据层收口,这一层不读、也不转发任何 `ownerId`。
 */
import { NextRequest } from "next/server";
import { hasPendingPanelThread, listProjectThreadActivity } from "@/lib/thread-activity";

export const dynamic = "force-dynamic";

function statusForError(message: string): number {
  if (/not authorized|sign in|session/i.test(message)) return 401;
  if (/not found/i.test(message)) return 404;
  return 400;
}

export async function GET(req: NextRequest): Promise<Response> {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    const panel = await hasPendingPanelThread();
    if ("error" in panel) return Response.json(panel, { status: statusForError(panel.error) });
    return Response.json(panel);
  }

  const result = await listProjectThreadActivity(projectId);
  if (!Array.isArray(result)) {
    return Response.json(result, { status: statusForError(result.error) });
  }

  return Response.json({ activity: result });
}
