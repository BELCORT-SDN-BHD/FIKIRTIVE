# scripts/ 三层结构(MASTERPLAN 7-12 / 7-13,2026-07-07)

## 分层

- **根目录 = CI 围栏**。被 `.github/workflows/ci.yml`、`package.json`、活文档引用的
  闸门脚本(`check-*.sh`、`check-parity.mjs`、`verify-auth-guards.mjs`、
  `blueprint.sha256`、`parity-debt-baseline.json`、`update-blueprint-hash.sh`)。
  **路径被外部引用,不得移动、不得改名。**
- **tools/ = 可复用运维/诊断工具**。会反复用到的:seed 数据、清理垃圾实体、
  R2 配置、各 tracer(mock $0 链路验证)、部署后 prod 验证、prod 登录等。
- **archive/ = 历史一次性验证**。为已合并 PR 做过的验证脚本(`local-*-verify`、
  `verify-phase*`、`prod-pass*`、各 `*-qa` / `*-journey` / e2e)。保留可查、
  可重跑,但不是日常工具。

## 确认锁(interlock)约定

会花真钱或碰 prod 的脚本,顶部必须挂 `scripts/tools/_interlock.mjs`:

- `I_UNDERSTAND_THIS_SPENDS=yes` —— 该脚本会产生真实供应商花费
  (fal / BytePlus / Anthropic / Stripe live)。
- `I_UNDERSTAND_THIS_TOUCHES_PROD=yes` —— 该脚本会读/写生产环境
  (LIVE 站点、prod Neon DB、prod R2、prod 队列)。

两者都占的要同时给两个 env。裸跑(不带 env)必须拒绝执行并打印它会
花什么/碰什么,exit 1。这对应宪法 2:每次真实花费都需 founder 逐次确认
—— env 变量就是"确认动作"本身,没有代码上限。

## 新脚本入哪层

1. 要进 CI / package.json / githooks 的闸门 → **根目录**。
2. 以后还会再用的工具(诊断、seed、配置、部署后验证)→ **tools/**。
3. 只为当前 PR 做一次性验证 → **archive/**(合并后即历史)。
4. 只要会花真钱或碰 prod,不论在哪层,都必须挂确认锁(见上)。
5. 相对路径注意:tools/ 与 archive/ 里的脚本 import 仓库代码要用
   `../../packages/...` / `../../apps/...`(比根目录多一层)。
