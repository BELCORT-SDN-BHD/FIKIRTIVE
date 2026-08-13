/**
 * /api/ops/dlq — 死信巡检探针(#793,上线债#1「仪表盘点亮」).
 *
 * 免鉴权(proxy.ts matcher 已排除),和 /api/health 同一个理由:外部 uptime 服务没有
 * session。它只答三个字:clear / backed-up / unknown —— 没有条数、没有队列名、没有任何
 * 商家数据,能被外人读出来的只有「这套系统此刻有没有被放弃的活」,与 /api/health 已经
 * 公开的 worker up/stale 同一量级。真正的明细走 Sentry(已鉴权)。
 *
 * 约定(状态码即告警,任何免费探针零配置就能用):
 *   200 = 七条死信队列**全部查得到,且一条不剩**
 *   503 = 有死信(backed-up),或有队列查不到 / 计数不可信 / 库读不到(unknown)
 *
 * 只有「查得到且是空的」才配 200:一个证明不了自己看得见的探针报平安,比没有探针更坏
 * (r2 — 判官 r1 P1-1)。
 *
 * 这条路径是**只读**的:一次 SELECT,不建队列、不写任何一行(r2 — 见 lib/dlq-watch.ts)。
 *
 * 接法与生产残留清单见 docs/ops/dashboards.md。
 */
import { checkDeadLetters } from "@/lib/dlq-watch";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const census = await checkDeadLetters();
    const clear = census.status === "clear";
    return Response.json(
      { ok: clear, deadLetters: census.status },
      { status: clear ? 200 : 503 },
    );
  } catch {
    // 队列句柄拿不到(DB 不可达、pooler 重启、句柄冷却中)。不把原因回给外面 —— 免鉴权
    // 路由不吐内部错误;要看原因去 Sentry 与 Railway 日志。
    return Response.json({ ok: false, deadLetters: "unknown" }, { status: 503 });
  }
}
