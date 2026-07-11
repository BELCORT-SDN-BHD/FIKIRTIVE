# Otto 静默失败修复 —— 验收清单(编排官逐条亲验,任一不过即退回)

## ✅ 已合入 main(2026-07-11):founder 一句话放行,#234 随批次(#230/#233/#234/#235)落地。FIK-1 合并后健康核查全绿(worker 138/138、core 492/492、web 120/120、typecheck 0)。防呆闸+lane split 随 #235 入 docs/ops/ORCHESTRATOR-STATE.md §五。**P0 第一件收官。**

## 验收结果:全过 ✅(2026-07-11 21:10)→ PR #234 CI 三关全绿、mergeable CLEAN(21:28)→ 独立异族评审 PASS → 合入 main

- **CI**:next build ✅ / typecheck+fences ✅ / unit+integration tests ✅;mergeStateStatus=CLEAN,mergeable=MERGEABLE。
- **分权合并前置**:AGENTS.md 要求 delegated merge 需独立异族评审无 P0/P1 → **codex 异族评审完成:六维全 PASS,零 P0/P1**(21:33)。①正确性 PASS(覆盖 onData 漏/submit 清/edit-retry 清三类;onFinish 后底部框仍可见)②无重复渲染 PASS(`!streamError` vs `streamError` 互斥)③React key PASS(distinct keys 无冲突)④范围/副作用 PASS(纯呈现层,零钱路/租户)⑤类型强转 PASS(只投影已用字段)⑥无更简写法;仅提一个 P2 可选优化(把全局 `!streamError` 抑制改成"仅当当前消息含同一持久 error 时才抑制底部框",多错误边缘更优雅——非缺陷,记为可选 follow-up)。codex 沙箱只读跑不了 git fetch,改用 git show/ls-tree 读分支树核范围——但 diff 范围我已用 `git diff --name-only` 独立确认过,一致。
- **分权合并全条件已满足**(AGENTS.md):①FIK-1 非作者 ✅ ②CI 全绿 ✅ ③异族评审无 P0/P1 ✅ ④无 founder-only 类别(纯 UI 呈现修复)✅ ⑤mergeStateStatus CLEAN ✅ → **FIK-1 可按 delegated merge 合并;或 founder 合。FIK-2 作者方不自合。**
- **交接完成(2026-07-11 21:35)**:FIK-1 回复已接手 #234——它另派自己的独立异族评审(codex gpt-5.6-sol/high),并会连同 #230/#233/#235 进它给 founder 的下一批放行清单。**FIK-1 本 session 安全闸要求合并须 founder 当轮明示,故最终点头在 founder。** #234 完全在 FIK-1 合并管线,FIK-2 侧此件收官。

- **A 边界**✅:diff 只含 OttoChatStream.tsx + otto-status-helpers.ts + 测试;无 FIK-1 文件;单 commit `e33c9967`;未自合。
- **B 根因**✅:worker 用**已安装 SDK v6 源码 + 真实运行时复现**推翻我的 4 个候选(onData 其实会触发),定真因=持久 data-error part 被消息渲染器丢弃 + 临时 streamError 会被下条消息清掉/浏览器漏 onData 即无处显示。源码引证 `ai@6.0.208 processUIMessageStream:6208-6239`。
- **C 测试**✅:编排官亲跑 `vitest run` otto 三文件 = **66 passed**(含 5 新 dataErrorOf 单测);worker 侧 tsc/eslint 绿。
- **D 运行时(最硬)**✅ **决定性**:编排官亲起 fix worktree dev server(无 key/mock/DB 5433),浏览器复现同一会话 → **两条失败消息现在都浮出错误框**("Otto hit a snag... Reference: OTTO-7W04Z3YY / OTTO-K1EQM0F5")。`OTTO-K1EQM0F5` 正是修复前 raw-fetch 抓到那条被吞的 data-error → **证实现象属"onData 漏/临时态清"类,修复精确覆盖**(非 worker 担心的流挂起另类问题)。
- **E 钱路**✅:diff 零 reserve/settle/refund/幂等键;唯一"credit"命中=insufficient_credits 显示链接。纯呈现层。
- **F**:PR #234 开;CI 全绿 + 独立评审后 **founder/FIK-1 合并,FIK-2 不自合**。
- **清理**✅:throwaway DB 容器 fik2-otto-pg 删;fix worktree 临时 env/.data 清;审计 worktree tracked 改动=0;fix worktree 保留承载 PR 分支。

---


> founder 2026-07-11「请确保进展过程无误、顺利」。worker 自评不算数,以下每条我亲自机器复核。

## A. 边界与纪律(防越界/防碰撞 FIK-1)
- [ ] `git -C <wt-otto-fix> diff --name-only origin/main` **只含**:OttoChatStream.tsx / otto-status-helpers.ts / otto-stream-bridge.ts / route.ts + 对应 __tests__。**绝不含** OttoSchedule.tsx / app/northstar/** / lib/actions.ts / lib/upload-actions.ts(FIK-1 在施工)。
- [ ] 无 merge、无 push:`git -C <wt-otto-fix> log origin/main..HEAD` 是本地未推 commit;`git branch -r` 无该分支远端(除非我方后续显式推)。
- [ ] 改动是**最小**修复,不引新依赖、不改文案、不夹带无关重构("while I'm here"零容忍)。

## B. 根因确认(防瞎修)
- [ ] worker 报告的根因**引了已安装 AI SDK v6 源码文件:行**(node_modules/ai 或 @ai-sdk/react),不是凭空推断。
- [ ] 修法与根因**一一对应**(只改根因那一处,不是 route+client+helper 三处都动"以防万一")。

## C. 测试(防假绿)
- [ ] 我**亲自**在 fix worktree 跑 `pnpm --filter @fikirtive/web test`(相关文件)→ 亲眼见绿,不信 worker 转述。
- [ ] 新增测试**真的覆盖**"data-error 流 → 用户可见错误"这条路径(读测试断言确认,不只看文件名)。

## D. 运行时自证(最硬的一关 —— 这才是 bug 的现场)
- [ ] 我**亲自**起 fix worktree 的 dev server(无 ANTHROPIC_API_KEY、mock provider、DB 5433),浏览器复现走查场景:登录→发 Otto 消息→**8 秒内必须看到明确错误框**(不再静默转圈)。截图存证。
- [ ] 反向确认:错误框文案对用户友好(不泄供应商细节)、有 reference id、"Edit and retry" 可用。
- [ ] 回归:确认修复没把正常流(有 key 时)搞坏——至少确认 data-status/data-step/data-tool-propose 仍走原路(读 diff 判断,不必真跑有 key 流,因为那要花钱)。

## E. 钱路/安全无副作用(Otto 流碰钱)
- [ ] diff 不碰 withLlmBudget/reserve/settle/refund/幂等键——纯呈现层修复,零钱路影响(读 diff 确认)。

## F. 收尾
- [ ] 通过 → 我方开 PR(标题+body 说明根因与验证证据),CI 全绿后 **founder/FIK-1 合并,我不自合**。
- [ ] 不通过 → 带具体不过项 SendMessage 退回 worker,不自己接手瞎补。

## 清理(验收后)
- [ ] 拆 throwaway DB 容器 fik2-otto-pg、fix worktree 的临时 env/.data;fix worktree 本身保留(承载 PR 分支)。
