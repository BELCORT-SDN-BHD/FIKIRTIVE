/**
 * 租户围栏 —— 尚未开工的切片，各自的验收占位。
 *
 * 规格: docs/specs/tenant-isolation.md（已冻结 · v1，#1369）§1.8 按面分片：
 * ①钱面 → ②商家动作面 → ③CRM 面 → ④后台 staff 帧 → ⑤裸外键回填。
 *
 * 切片①（#1376）交付的是 TENANT-A1 / A3 / A4（见 `tenant-guard-money-slice1.test.ts`
 * 与 `apps/web/lib/__tests__/tenant-money-frames-slice1.test.ts`）。切片②（#1377）交付的是
 * TENANT-A2（见 `apps/web/lib/__tests__/tenant-action-cross-tenant-slice2.test.ts`：真实数据库、
 * 真实动作函数 —— renameCollection / getCollection / deleteCanvasNode 各一次改名/读取/删除，
 * 用 A 的会话打 B 的 id 三次全部失败，B 的行数一字未改，A 自己的同一动作正常成功）。切片③
 * （#1378，CRM 面）再交付一遍 TENANT-A2 / A1（见
 * `apps/web/lib/__tests__/tenant-action-cross-tenant-slice3.test.ts`：同样真实数据库、真实动作
 * 函数 —— updateContact / deleteSegment / getContact 各一次改名/删除/读取，外加一条真正证闸的
 * 用例：篡改查询的 `where.ownerId` 指向另一家，断言运行时守卫本身抛出 tenant-guard 签名错误，
 * 不靠动作层自带的显式过滤）。
 * 用 A 的会话打 B 的 id 三次全部失败，B 的行数一字未改，A 自己的同一动作正常成功）。切片④
 * （#1379）交付的是 TENANT-A6（见 `tenant-guard-staff-slice4.test.ts`：staff 帧的结构规则
 * 与双身份对照；`apps/web/lib/__tests__/tenant-actions-staff-frame-slice4.test.ts`：真实数据库、
 * 真实动作函数 —— grantTenantCredits / closeReconcileObservation / abandonManualRefund 三次都在
 * staff 帧内发生，帧的 actorEmail/ownerId 由 `getPrincipal()` 当场证明；grantCreditsAction 的
 * 跨租户铸币仍要求 requireRole("tenants","mutate") 才放行，帧从未建立）。
 * 这个文件把**其余**编号按它们归属的切片摆在这里，每条一句话写清「哪一片会把它变成真测试」——
 * 一张看得见的欠账表，不是一堆空壳：接手的那一片删掉自己那一行，换成真的行为测试。
 */
import { it } from "vitest";

// 切片⑤（75 条裸外键回填 + 迁移）交付:TENANT-A7 见
// packages/db/src/tenant-fk-backfill.test.ts —— 机器闸(裸外键剩余数 == 豁免清单长度)+ DB 级
// 同租户成功/跨租户被拒(P2003)代表用例(ScheduledPostMedia、PublishAttempt)。

// worker 七条队列那一片（规格 §4 异议栏点名单独一片、单独复审）交付的是 TENANT-A8 / A9，
// 两条欠账到此结清，占位已换成真库行为测试：
//   · TENANT-A8 见 apps/worker/src/jobs/tenant-queue-frames-a8-db.test.ts —— caption / gen /
//     ingest / publish / refgen / render / research 各跑一单，真 handler、真库、真守卫、离线
//     mock 引擎，七条全部走到各自的正常终态；每一单的帧内（探针挂在该 handler 帧内必经的那个
//     边界上，所以注入发生在 handler 自己的帧里）再对本队列受守卫的那张表发两笔点名异租户的
//     读写，十四笔全被值比对拒掉，拒绝原话逐字断言。
//   · TENANT-A9 见 apps/worker/src/jobs/tenant-transcript-cache-a9-db.test.ts —— 同一段音频同一
//     模型在两个租户各跑一次：第二次命中全局缓存（whisper-cli 调用次数不增）、DONE 无错、两家
//     账本行数与余额分毫未动；同一个帧里点名另一家的 Asset / Generation，两笔跨租户读被拒。

// 收尾片（#464）交付的是 TENANT-A10 的 requireOwner 半题（见
// apps/web/lib/__tests__/tenant-requireowner-frame-scan.test.ts：「apps/web 生产代码里文件内
// 零 runAsUser 的 requireOwner 站点数 = 0」，真扫描测试，含两处结构性排除）。A10 的另外
// 两句仍未交付，留给最后一片：
it.todo(
  "TENANT-A10 机器计数（requireRole 半题）：apps/web 生产代码里未建帧的 requireRole 站点数 = 0 —— 最后一片交付",
);
it.todo(
  "TENANT-A10 机器计数（挡位删除）：守卫里的迁移期挡位已从代码中删除 —— 最后一片交付",
);
