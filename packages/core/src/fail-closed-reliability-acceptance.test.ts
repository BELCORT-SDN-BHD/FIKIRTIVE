/**
 * 出问题不装没事(docs/specs/fail-closed-reliability.md §2 验收表)—— 验收↔测试的落点登记。
 *
 * 规格把施工切成两段,两张票:
 *   **A 段(#1383,本 PR)** = 引擎缺配置／明写 mock 一律拒绝 ＋ 退款。RELY-A1…A5 的真测试已经
 *   在树上,不在本文件里 —— 它们住在被测代码旁边:
 *     · RELY-A1 / A3 / A5(端口工厂)`packages/generation/src/understanding.test.ts`、
 *       `packages/generation/src/index.test.ts`
 *     · RELY-A1 / A2(钱守恒)/ A3(真库、真钱路、真 handler)
 *       `apps/worker/src/jobs/understand-unconfigured-provider-db.test.ts`
 *     · RELY-A4 / A5(env 契约开机闸)`packages/core/src/env-contract.test.ts`
 *
 *   **B 段(#1384)** = 报警送达确认 ＋ 备份启动检查 ＋ 运维文档。它的编号今天只在这里占位:
 *   编号在测试树里有落点(机器闸 M3 认),但**不假装已经验过** —— `it.todo` 不会绿,也不会
 *   被读成「这条已经做完」。B 段那张票落地时把它们逐条转正到各自被测代码旁边,并撤掉这里的占位。
 */
import { describe, it } from "vitest";

describe("RELY B 段(#1384)—— 报警送达确认 ＋ 备份启动检查 ＋ 运维文档:待转正", () => {
  it.todo("RELY-A6 §2 — SENTRY_DSN 形状不对的生产进程开机拒绝并点名该变量;形状合法的照常启动,全程不做启动探测外呼");
  it.todo("RELY-A7 §2 — 邮件与 Telegram 双双失败时不写「已喊过」的永久标记,下一趟巡检再试,Sentry 每趟照收");
  it.todo("RELY-A8 §2 — 同一天同一条缺口:人工渠道当天只响一次,之后走 repeat,Sentry 仍计数");
  it.todo("RELY-A9 §2 — Stripe webhook 仍回 200;台账记 alertDelivered=false,送达后翻 true 且不再重试");
  it.todo("RELY-A10 §2 — 备份 cron 缺必需 env 时退出码非 0 并点名缺项;补齐后照常完成当日备份");
  it.todo("RELY-A11 §2 — 两份运维文档里的告警 key 与代码里的 founderAlert key 逐条对得上,且没有明文 token 示例");
});
