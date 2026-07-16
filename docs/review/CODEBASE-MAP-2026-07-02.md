# 全库审查地图(2026-07-02) — historical tombstone

> 原文件是 6 个只读 mapper 对当时 main(含 #99)的数百行测绘。它包含已漂移的路径、
> 行号、数量、队列和实现判断,因此 sanitation 不再把正文留在 active tree 伪装成 current map。
> 完整原文由 Git history 保留;本文件不再维护或恢复为平行代码索引。

当前使用方式:

- 从根 `AGENTS.md` 加载项目入口与 authority。
- 对当前 commit 用 `rg`/测试重新证明所需代码事实;不要引用本快照的旧行号。
- 安全审查可按 [REVIEWER-PLAYBOOK.md](REVIEWER-PLAYBOOK.md) 的相关清单执行,同时以当前代码/项目法校验。
- 只有考据 2026-07-02 当时状态时,才从 Git history 读取本文件旧版本并明确标注 commit。
