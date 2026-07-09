---
name: fleet-orchestration
description: FIKIRTIVE 舰队编排官方手册 —— 凡多 agent 作业(全城建造/大规模审计/迁移/多区并行)或派单 Codex 时必读;含分档用工表、标准舰队形状、worker 施工样板、教训清单
---

# 舰队编排(fleet-orchestration)

> 性质:FIKIRTIVE 多 agent 作业的**官方施工手册**(华语,宪法 9)。来源 = founder 永久指令"Fable 编排策略"(2026-07-09)+ 历次舰队实战教训。任何模型的会话要开舰队,照本手册执行;与蓝图/playbook 冲突时蓝图赢。

## 一、分档用工表

| 角色 | 谁 | 干什么 |
|---|---|---|
| 总指挥 | 会话主脑(Fable 时必须亲任) | 只做四件事:架构/流程设计、**写流程级工单**、终审关键 diff、和 founder 拍板。**不亲自铺代码** |
| 灵魂工人 | Opus | 体验关键件(壳/连通/canvas/旗舰页/钱路形态),拿完整施工图(状态机+每步交互) |
| 量产工人 | Sonnet | 读盘/审计文档/mock 数据/重复变体/文档/清单 |
| 编外对抗队 | Codex(`codex exec`,GPT-5.5) | ①异族对抗审查(soul 件/钱路大 diff 的第四闸)②Claude 限额时顶班③疑难第二意见。**进不了 Workflow 舰队**,由总指挥经 Bash 单独派单 |
| 质检官 | Opus(不降档) | 逐区打分 A/B/C + 逐条 file+issue 缺陷;founder 定过"不要掉质量" |

**晋升铁律**:任何模型(含未来新模型)进哪个档,不听发布会,只看**试工打分** —— 同一张工单、同一质检官、同一把尺;量产件拿 A 进量产档,灵魂件拿 A 才碰体验件。("Sonnet 盖楼被退货"教训的普适化。)

**质量三闸**:① 总指挥终审 ② 机器闸(typecheck/围栏/CI)③ founder staging 眼睛。工人失败先升级工单,再考虑升级模型 —— "表面"产出的根因是工单浅。

## 二、标准舰队形状(五段)

```
Foundation(串行,承重墙:共享数据/store/壳,后续全员依赖)
  → Zones(并行,一区一 Opus;只动自己区,共享文件只许尾部追加)
  → Integration(1 Opus:跨区缝合+四关全绿 typecheck/fence/tests/build)
  → Audit(并行质检官打分 → <A 派修复队 → 复检一次)
  → Ship(部署+验证+人话手册;soul/钱路 diff 加 Codex 对抗审查第四闸)
```

Workflow 工具要点:`meta` 纯字面量;默认 `pipeline()`,只有真需要全量结果才 `parallel()` 加栅栏;脚本内禁 `Date.now()/Math.random()`;中断后用 `resumeFromRunId` 吃缓存;体验件 `{model:'opus', effort:'high'}`;质检官带 JSON schema(grade/summary/defects[file,issue])。

## 三、worker 施工样板(写进每张工单)

1. `git fetch origin <branch>` → `git worktree add <scratch>/wt-<name> origin/<branch> --detach`(锁冲突 sleep 5 重试 ×5)
2. `pnpm install --prefer-offline`(失败去掉 flag 重试一次)
3. 必读文档按序列全(总令 → 分区契约 → 设计法 → store 规则),写明路径
4. 铁律写死:目录围栏(只动哪些路径)/一切状态经 store(共享文件**只许尾部追加**并注明区名)/禁 fork useState 持 mock 副本/图片只从已验证目录取
5. 自验:围栏脚本 + `tsc --noEmit` 必绿才许 push
6. push 重试循环 ×6:`git pull --rebase && git push --no-verify origin HEAD:<branch>`(--no-verify 仅限 worktree 缺依赖挡 hook 且已自验过;rebase 冲突"尾部追加型"= 两段都保留)
7. `git worktree remove --force` 收尾;最终文本只返回 SHA+改动数+建成清单+自验结果

## 四、教训清单(血泪,一条都不许丢)

1. **部署前必核 SHA**:`git rev-parse HEAD` 与 `origin/<branch>` 完全一致才许部署,打印两者(shipper 曾部署过时代码)。
2. **弃半成品优于抢救**:worker 中途死掉留下未提交文件 → worktree 整个丢弃重跑,不捡。
3. **worktree 清理权威 = gh PR 状态(MERGED)**,不是 git 祖先测试(squash merge 会骗人)。
4. **图片/外链 URL 逐条 `curl -sI` 验 200** 才入库,禁编造(hallucinated Unsplash ID = 全城裂图)。
5. Codex `effort=minimal` 与 image_gen/web_search 冲突报 400,**最低用 low**。
6. 前台 sleep 被禁 → `run_in_background` 或 Monitor until-loop;临时脚本用 python3 一行,少用易错的 `node -e`。
7. 限额/断线打断舰队 → 等 reset 后 `resumeFromRunId` 续跑(已完成 agent 吃缓存);被杀 agent 查分支有无半推,清掉再原单重发(工单里写"push 网络失败重试 ×3")。
8. 并行舰队撞同一文件(MASTERPLAN 行/verdicts 尾/同名测试)→ 临时 worktree 手工合并,保双方意图。
9. **给 founder 的汇报 = 人话 + 可查证据**(部署 SHA、逐页 HTTP 状态、测试输出),不说"我验证过了";禁内部代号。
10. 机器闸不许因赶工跳过;CI 红 = 本地三关复现(见 `docs/runbooks/local-ci.md`)+ founder 批准才可动。

## 五、Codex 派单配方

```bash
codex exec --skip-git-repo-check -c model_reasoning_effort=<low|medium|high|xhigh> "<工单>"
```

**第四闸标准流程(每次大舰队 Ship 前平行点火,实战版 2026-07-09)**:
1. 时机:质检打分收尾后、founder 验收前,与部署收尾**平行**跑(不占关键路径);Bash `run_in_background` 发射。
2. 工单形状(实战验证过的五类靶子,按严重度排):①**状态该写没写**(UI 文案宣称效果但 store 从未落数据 = 表面联通,founder 最恨)②断头链接/不存在的路由与参数 ③引用不存在的 mock id / 写死数字与数据源打架 ④React 正确性(unstable key/依赖缺失/hydration)⑤持 useState 私藏 mock 副本违反 store 单源。
3. 硬约束写进工单:READ ONLY 不许改代码;唯一允许的写 = 把发现输出到指定报告文件;**禁风格意见、禁重构建议**;每条 = file:line + 缺陷 + 用户点击时会踩到的具体失败场景;结尾按严重度计数。
4. 交卷后**总指挥逐条甄别**:真缺陷 → 修复工单(走城/上线前修掉);误报 → 驳回。给 founder 的汇报带"采纳/驳回判决"。

- 计费走 founder 的 ChatGPT 订阅(priority tier),非逐笔钱路;**重活(整分支审查/长跑)先跟 founder 打一声招呼**,别烧光他的 plan 限额。
- repo 规矩对 Codex 一视同仁:永不推 main、PR+CI 绿灯、playbook 检查单。
- plugin 命令(`/codex:review` 等)需重启会话才注册;CLI `codex exec` 永远直接可用。
