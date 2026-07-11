# 路线乙交接包 · 总入口(新总指挥 session 从这里开始)

> 2026-07-12。FIK-1(控制面)与 FIK-2(D7 审计+planning)联合交接。founder 已批:路线乙、总计划 v1.0 冻结、五答签认。
> **新 session 启动令(founder 复制即用)**:
> ```
> /orchestration 接管路线乙直建程序。先读 docs/ops/ROUTE-B-HANDOFF-README.md 全文与其指向的
> 执行合同,认领控制面 epoch(状态账「epoch 移交待新 session 首轮认领」),然后从 B0(发布契约
> 与覆盖矩阵)开始执行 ROUTE-B-MASTER-PLAN。判断过顾问、施工派舰队、每块出板块报告。
> ```

## 读序(严格按序)

1. `AGENTS.md` + `docs/BLUEPRINT.md`(法律与宪法,永不变)
2. `docs/ops/ORCHESTRATOR-STATE.md`(#238 终局版:epoch 移交条款、FIK-1 交接节 §六、递延池)
3. **`docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md`(执行合同 v1.0——范围宪章/六级状态/治理模型/改判表全在此)**
4. `docs/ops/FOUNDER-SUPPLY-MANIFEST-2026-07-12.md`(founder 供给,开跑前应已收齐;缺项=先向 founder 收齐再开工)
5. `docs/ops/FINAL-REPORT-STANDARD-2026-07-12.md`(交付合同:三件套+每章七节+15 步剧本)
6. `docs/review/ROUTE-B-EVIDENCE-2026-07-11/`(D7 审计全部证据:MATRIX-V0 地面真相、Gate1 双脑记分卡、9 份取证、旅程走查、Railway 生产事实、机器审计)
7. `docs/ops/APRIME-MANIFEST-2026-07-11.md`(A′ 舱单=UI 车道施工单)+ `docs/ops/CREDENTIAL-INVENTORY-2026-07-11.md`

## 十条硬约束(从两代控制面血泪中来,违者重蹈覆辙)

1. **B0 先行**:范围没冻成有限清单前,一行产品代码不写。
2. 六级状态制;「建毕/完成」无状态标签的报告一律退回。
3. 每功能出生即双执行器(人工+Otto);对等债随块清零,禁新增债。
4. 判断永不下放 worker;每块分解过顾问;Tier 1 双脑;advisor 降级协议照状态账。
5. 四权分离:block owner / 异族 reviewer / integrator / merger;自己编辑过的 diff 不得自合;founder-only 类别照 AGENTS.md。
6. 真实花费:信封 $300 内分项跟账,80% 提醒;信封外必停手问。
7. 意外 blocker:跳过、标注、继续,攒批报 founder(Q7);涉共享契约/钱/tenant/安全的例外立即进最近合并窗口。
8. **总指挥是办公室不是会话**:五本账(范围/依赖状态/决策/风险待裁/证据)全在 repo;第 1 块末尾做一次故意换届演练;worker 自评不算数,机器证据才算。
9. 每块报告随块定稿、增量投递 founder(只读);终验=确认不是发现。
10. 状态诚实:失败如实报,「Fable verified/incomplete/fallback」类标签纪律沿用;给 founder 的一切=人话+例子。

## 递延池(不阻开工,按机会处理)

- 电脑清理第二组(逐项等 founder,清单在 machine-audit/)+ Cloudflare 轮换(D5,最优先)+ Railway FAL_KEY 移除。
- 受保护 worktree 处置(d629 核对、serene-swartz 二选一、旧容器)。
- P2 可选优化:#234 评审提的 streamError 局部抑制;TOOL_STEP_LABELS 六技能意图确认。
- GM-05 文档与实况对齐(等 A′ 相应页落地时顺手)。

## 两代控制面收官记录

- FIK-1(epoch claude-20260711-02):L1 红测与修复(#229/#230)、A′ 切片 1(#236)、治理与状态账(#238)、repo sanitise(31 分支清、远端 3 条终态)。交接节=状态账 §六。
- FIK-2(本 session,无 claim):D7 全审计(143 行矩阵+走查)、Gate1 双脑记分卡、P0 三件(#234/#237/创作流失败诚实性验证)、机器审计+第一组清理(~8.3GB)、总计划 v1.0+本交接包。
- 两 session 在交接包 PR 合并、新 session 认领 epoch 后**收官退役**;不再作为可恢复控制面。
