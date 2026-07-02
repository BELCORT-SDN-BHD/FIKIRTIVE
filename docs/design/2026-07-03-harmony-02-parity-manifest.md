# Harmony 02 —— Parity Manifest 设计(第九条扩建缝)

> **性质**:harmony 交付物 2/6。把宪法第 7 条"Otto 可 100% 操控"从条文变成 CI 拦截器 —— 和技能围栏(check-skill-imports.sh)同一哲学:**不靠自觉,靠结构**。

## 一、它是什么

一张**机器可读、人可读**的对照表:每个 server action ↔ 暴露它给 Otto 的 skill,或**明示豁免**。CI 扫描:出现没登记的 action → 红灯,合并不进去。

```ts
// packages/otto/src/parity-manifest.ts —— 单一来源,可读文件(file-system 宪法)
export const PARITY_MANIFEST = {
  // ── 已配对(action → skill)──
  "gen-actions.startGen":            { skill: "generate" },
  "storyboard-actions.editShotPrompt": { skill: "edit-storyboard" },   // 示例:动工时补
  "canvas-actions.createCanvasNode": { skill: "canvas-place" },        // 示例
  // ── 豁免(必须给 reason,四类之一)──
  "billing-actions.createCheckoutSession": { exempt: "MONEY_IN",   reason: "充值 Otto 永不代办(宪法 7)" },
  "tenant-actions.impersonateTenant":      { exempt: "ADMIN",      reason: "市政厅永久豁免" },
  "canvas-actions.moveCanvasNode":         { exempt: "VISUAL",     reason: "纯像素微操;等价能力=canvas-arrange skill" },
  "auth 相关全部":                          { exempt: "ACCOUNT_SECURITY", reason: "人亲自来" },
} as const;
```

## 二、CI 围栏怎么工作(scripts/check-parity.sh)

1. **枚举**:扫 `apps/web/lib/*-actions.ts` + `app/api/**/route.ts` 里的导出(`"use server"` 文件的 export = 动作面)。
2. **比对**:每个导出必须在 manifest 里(配对或豁免);manifest 里的 skill 名必须真实存在于 registry。
3. **反向查**:manifest 不许引用已删除的 action(防僵尸行)。
4. **豁免只有四类**:`ADMIN` / `VISUAL` / `MONEY_IN` / `ACCOUNT_SECURITY` —— 新豁免类 = 修宪(founder 批)。

**读的对等**同一张表管:列表/详情的读 action 配对到 free/read skill(`meta-insights` 模式)。原则:**人在页面上看得到的数据,Otto 一定问得到。**

## 三、上下文桥(宪法 7 第四层)的最小规范

每轮 Otto 对话注入一个只读 `viewContext`:`{ view, selectedIds, campaignId?, projectId }`(client 声明、server 按 ownerId 复核后才用 —— D19 信任边界不变)。"把这个改成 9:16"的"这个"= `selectedIds[0]`。已有雏形(附图 sourceGenerationId、canvas bridge),推广为标准字段。

## 四、落地三步(rollout)

1. **盘点回填**:把现有全部 actions 登记(能配对的配对,配不上的先记 `TODO_SKILL` 状态 —— 这是欠账清单,不是豁免)。
2. **CI warn-only 上线**:红名单可见但不拦,给一个迭代期清 TODO。
3. **转硬闸**:TODO 清零后改 hard fail —— 从此新 action 不配 skill 就合并不进去。

## 五、第九缝声明(蓝图 v2 收录)

| # | 缝 | 一句话 | 加什么走这条 |
|---|---|---|---|
| 9 | **Parity Manifest** | 每个新 action 出生即配 skill 或明示豁免,CI 拦截 | 任何新 server action / 任何新页面数据读取 |

## 给审查员的钉子
- [ ] manifest 是纯字面量(和 SECTION_MATRIX 同风格),diff 一眼可审
- [ ] 豁免四类封闭,新增类别 = 修宪
- [ ] check-parity.sh 进 ci.yml 的 check job(warn→hard 两阶段)
- [ ] viewContext server 侧一律 ownerId 复核(永不信 client 声明的 id)
