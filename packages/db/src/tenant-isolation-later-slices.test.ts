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
 * 用 A 的会话打 B 的 id 三次全部失败，B 的行数一字未改，A 自己的同一动作正常成功）。
 * 这个文件把**其余**编号按它们归属的切片摆在这里，每条一句话写清「哪一片会把它变成真测试」——
 * 一张看得见的欠账表，不是一堆空壳：接手的那一片删掉自己那一行，换成真的行为测试。
 */
import { it } from "vitest";

// 切片④（后台 staff 帧，#479 并案）
it.todo(
  "TENANT-A6 后台员工发积分／退款／对账三次都在 staff 帧内发生，审计行的操作者与目标租户由帧带出 —— 切片④交付",
);

// 切片⑤（75 条裸外键回填 + 迁移）
it.todo(
  "TENANT-A7 全新数据库跑完全部迁移后，把 A 租户的子行挂到 B 租户的父行被数据库直接拒绝 —— 切片⑤（裸外键回填）交付",
);

// worker 七条队列（规格 §4 异议栏点名单独一片、单独复审）
it.todo(
  "TENANT-A8 七条队列各跑一单全部跑通，帧建立之后的读写都经过值比对（异租户 id 注入被拒） —— 队列那一片交付",
);
it.todo(
  "TENANT-A9 同一段音频同一模型在两个租户各转写一次：第二次命中全局缓存、不重复计费；其它表的跨租户读被拒 —— 队列那一片交付",
);

// 全部切片落地之后的收口
it.todo(
  "TENANT-A10 机器计数：apps/web 生产代码里无帧 requireOwner 站点数与未建帧 requireRole 站点数都是 0，且守卫里的迁移期挡位已从代码中删除 —— 最后一片交付",
);
