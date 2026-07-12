# 快审裁定 memo

结论：应采 **A\***——任务范围按 A 解读，但“完成 13 个 PR”应理解为完成其最终处置，不是强行把 13 个现有 head 全部合入，更不构成作者自合授权。B 可继续起草修复，但不得自行冻结；C 超出授权。

## 1. 自批、自合与当轮明示

分三层裁定：

1. **Founder 当轮明示：是。**  
   该句紧接具名的 13 PR、体量包和三个裁定之后，足以构成本轮批量明示，满足 [B0-CONTRACT.md](/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0/docs/ops/route-b/B0-CONTRACT.md:47) 的本机安全闸。范围只覆盖当时披露的对象和实质不变的机械 rebase；新增实质内容不自动获批。

2. **技术放行：不是。**  
   明示不能替代 current-head CI、独立复审和阻断清零。[AGENTS.md](/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0/AGENTS.md:15) 的这些条件仍然有效。尤其 #250 当前被 D-018 判为 NO-GO，不能以“founder 已批整包”为由照原 head 合入。

3. **作者自合：否。**  
   “自己批准”可解释为对已呈现选项作批量决定，不能扩大成“亲手执行自己 diff 的 merge”。这是蓝图级禁令：[BLUEPRINT.md](/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0/docs/BLUEPRINT.md:142)、[REVIEWER-PLAYBOOK.md](/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0/docs/review/REVIEWER-PLAYBOOK.md:11) 和 AGENTS 三处一致。2026-07-10 工程卫生先例也明确排除了修宪、钱路和产品实质，不能覆盖 #241/#250/#252。

因此：

- #241、#250、#252，以及控制面若实质编辑过的 #253，不得由该控制面执行 merge。
- #241 属治理解释，#250 属共享架构/schema 契约，#252 属 B0 修宪；均不是普通工程卫生件。
- 若 founder 希望连这些也由 agent 执行，需要一条明确指向“作者自合禁令/founder-only 执行权”的例外或正式修订；现句不够精确。

## 2. “做完全部任务”的边界

**忠实解读是 A\***：

- 处理 13 PR 至正确终态：合并、修订后合并、被替代关闭或明确阻断；
- 按已展示的控制面建议完成 B8 圈档；
- 采纳三个一句话裁定；
- 五本账、状态账和正式交接包收口。

不是“13 个现有 head 一个不少地 merge”。

B2/B9 v0.3 可作为 #250 的必要整改继续起草、取证、复审；但最终文本尚未存在，当前授权不可能构成对未来契约的 informed approval。其 **spec freeze / spec-ready / merge 仍须 founder 对最终版明示 acknowledgment**，这也是 [DECISION-LOG.md](/Users/winnin/Desktop/FIKIRTIVE/.claude/worktrees/route-b-orchestration-handoff-1894c0/docs/ops/route-b/DECISION-LOG.md:25) D-018 的明确结论。

C 超界：

- 七条 ESLint 行为类修复会改变 effect/render 时序；
- lint 翻硬属于 CI/merge-policy 改变；
- 广义 split-brain 清理可能含强推、删分支或处置受保护 worktree。

这些须另行报批。仅为当前 stack 做的精确 rebase、retarget、`--force-with-lease` 可视为 A 的正常合并操作。

## 3. 仍须保留的 founder-only

你的清单正确但不完整。还应加入：

- 所有 schema/migration 的合并与执行，不只破坏性 DROP；
- money path、tenant path、真实 voucher/奖励等外部财务效果；
- 凭据、权限、角色、KYC/2FA、密钥轮换；
- 治理/merge policy、产品身份/品牌、不可逆架构；
- 外部 publish、delete、申请递交及生产数据写入；
- unusually large、存在争议或风险等级不确定的 PR；
- 最终 `release-certified` 产品验收；
- 作者自合禁令及 current-head CI/独立复审门。

B0-104 目前只是把 NextAuth DROP 纳入冻结清单，不等于批准创建迁移、合并迁移，更不等于批准生产执行。三者必须分开。

## 4. B8 圈档

采用“**控制面建议为产品深度结论，SOL 已证实的安全/诚实底线为硬约束**”，不是按顾问票数决定：

- Campaign：B，附 pack hash、逐项状态、稳定幂等键和 money review。
- CRM：A；B5/B6、identity/consent 未成立前不得宣称 respond.io 平齐。
- 口碑：拆行；63=A 实、64=两平台真源的 B-lite，若真源未到则保持 listed、65=A-lite、66=A 最薄、67=只读。
- Marketplace：68=B、69=A、71=B；70/72 保持 listed。
- 第一米：62=B、73=B、74=A 并入 MicrositePage、75=B；76 保持 listed。

三个一句话裁定：

- UTM 采用结构化 schema，对齐既有 `utmJson`。
- GBP 薄试继续；AEO 维持出程，不捆绑翻案。
- 接受 S1–S8 的归属方向，但它们只是设计归属，不预先冻结 B2 的 tenant、consent、identity 或 live-event 接口。

## 5. 正式交接包最小件

一次性交接至少包含：

1. 最终 `main` SHA、生产 SHA，以及“未部署/未花费/未外递”的声明。
2. #241–#253 处置表：批准 head、最终 head、merge/close SHA、CI、独立复审、执行者。
3. B8 圈档和三个裁定的最终表。
4. B2/B9、B0 修宪及所有 listed 项的真实状态，禁止用“完成”覆盖 NO-GO。
5. 五本账已同步证明、epoch 释放/下一控制面认领说明。
6. 尚需 founder 亲做的最短清单及对应一键入口。
7. post-merge 组合验证、回滚点和残余风险。

## 建议执行顺序

1. 固定放行清单的 head SHA、作者、类别和 CI；#250 先标 HOLD。
2. B10 栈：#242 squash → 将 #243 以旧父 tip 为界 rebase 到新 main → 新 head CI/复审 → merge；再 rebase #246、解决 `ci.yml`/矩阵冲突并重跑。
3. 合并 #244/#245/#247/#248/#249 五份独立设计输入。
4. #251 squash → #252 用 `--onto` 去掉旧父提交、重新生成冻结快照并验证；#252 走 founder-only。
5. #250 完成 v0.3 后再做最终 founder acknowledgment；当前 v0.2 不合。
6. 账本最后收口。优先让 #253 **替代并关闭 #241**，避免 main 短暂落入已被 D-018 否定的 D-016；若坚持两者都合，则必须 #241、#253 紧邻执行。
7. 合并后对 main 跑组合三关、矩阵校验和最终 tree 对账，再出交接包。

Squash 后对子 PR 必须 retarget + rebase + `--force-with-lease`，用 `git range-diff` 证明逻辑 delta 不变；任何冲突解决造成内容变化，都视为新 head，旧绿灯与旧复审失效。父分支在子 PR 完成 retarget/rebase 前不要删除。

总体置信度：**91%**。作者不得自合与 C 超界约 97%；A\* 范围约 90%；主要剩余歧义仅在 founder 是否主观意图临时废除宪法级四权分离——现有措辞不足以作该解释。