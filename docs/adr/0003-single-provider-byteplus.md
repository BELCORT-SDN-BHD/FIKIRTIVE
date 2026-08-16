# 3. 单一生成供应商:byteplus

Date: 2026-08-16
Status: Accepted

## 背景

Phase 2 引入图片/视频生成能力时，`packages/generation` 同时接了两条付费适配器：`byteplus`
（Ark，Seedream 图片 / Seedance 视频）与 `fal`（fal.ai 的同步端点，Seedream 图片 / 一批视频
模型）。当初建 `fal` 这条备胎的理由是供应商风险对冲——单一供应商如果涨价、限流、下线接口，
产品完全没有退路；`fal` 被设计成"万一 byteplus 出问题，切一个 env 变量就能续命"的应急通道。

这条备胎从未真正上线过一次真实生成。生产环境的 `GENERATION_PROVIDER` 从部署第一天起就是
`byteplus`，`fal` 的代码路径只在测试里被真实调用过。与它绑定的还有：

- 一张"备用适配器不兑现画幅 / 不兑现组图 / 不收元素照"的声明表（`EXECUTED_SPEC` 里的
  `fallbackAdapterAspectHonoured` / `fallbackAdapterCoherentSetHonoured`，以及
  `imageAspectHonoured()` / `imageCoherentSetHonoured()` / `videoElementReferencesHonoured()`
  里按 `GENERATION_PROVIDER === "fal"` 分支的特例判断）——每次这三个函数改动，都要多想一遍
  "备用路那边呢"，即便备用路从未跑过一次真实请求；
- 一张已经在 `#647 T6` 被裁定下架的 12 台视频模型的 fal 接线表；
- 一个更早、独立于图片/视频生成的"cowork 规划器"LLM 传输层（`COWORK_PROVIDER=mock|fal|modal`），
  它的实现（`getTransport`）在 batch-3 7-10 就已经删除，但配置旋钮、admin UI（Otto provider
  下拉）、权限门（`model.self_hosted.mutate`）、写时凭据校验、审计记录整套管理机器留到了现在——
  自己承认"INERT"却继续存在，每次读到这段代码都要重新确认一遍"这真的没在跑"。

这就是"备胎税"：一条从未走过生产流量的路径，靠留着代码本身收着每次开发的注意力成本，
而它真正要防的风险（byteplus 出问题）一次都没发生过，即便发生了，也没人验证过切换到 `fal`
真的能顶上——它的模型清单、定价、参数格式都是当年调研时抄的，从未在真实流量下验证过。

## 决定

Founder 2026-08-16 裁定：`fal` 供应商适配器、其声明表特例、以及已经自认 INERT 的
`cowork_provider` 管理旋钮家族（admin UI + 权限/审计/凭据校验机器）**整族删除**，不保留、
不注释、不降级为"以后再启用"的开关。删除范围与实测证据见 #952；本条裁决的审计留档见 #850。

理由：

1. **从未上线**——零生产流量、零真实调用，不是"用得少"，是"从未用过"。
2. **每次开发收声明税**——即便完全不用，`fal` 分支仍然出现在画幅/组图/元素照的披露判据里，
   出现在环境契约、admin 后台、权限表、Otto 技能围栏测试里，每一次改动这些系统都要多算一条
   从未被验证过的分支。
3. **真要对冲供应商风险，等真的要换供应商时，按当时的供应商现实重写**——比现在维护一条
   过时、未验证的备胎路径更便宜也更安全。当年抄下来的模型 ID、参数名、计价方式随时间推移
   只会越来越不可信；一条从不运行的代码不会因为"放在那里"而保持新鲜。

## 若重建看什么

如果未来真的需要第二个生成供应商（无论是风险对冲还是产品需要），重新引入时应该看：

- **当时的供应商 API 现实**——不要复用这次删除前 `fal` 适配器里的模型 ID、参数名或计价假设；
  它们是 2026 年中的快照，供应商的接口、模型阵容、计价方式到那时大概率已经变了。
  `packages/generation/src/byteplus.ts` 是目前唯一活跃、被真实计费流量验证过的适配器实现，
  新适配器应该参照它的money-safety 形状（`chargedError` / `permanentInputError` 的划分、
  `providerRequestGate` 的并发闸、4xx-only-is-provably-free 的判定），而不是复用 fal 那条
  从未验证过的实现。
- **这次「备胎税」的教训**——多供应商抽象本身不是免费的：每加一个可选分支，`EXECUTED_SPEC`
  这类"说的必须等于做的"披露判据就要多一层按 provider 分支的特例，环境契约、admin 面板、
  权限表都要跟着长一份。如果新供应商不会立刻承接真实流量，考虑先把它限定在一个更窄的接口
  （例如"能力探测 + 手动切换"而不是"自动分支判断"），避免声明面在从未跑过的代码路径上分叉。
- **集中配置产品法**——价格、模型清单、供应商选择必须继续走 `packages/core/src/env-contract.ts`
  与 `GENERATION_PROVIDER` 这类集中注册的单一权威（本仓库的产品法：不把供应商身份或价格字面量
  散落进业务逻辑或 UI），新供应商的加入应该复用这套契约机制，而不是另起一套。

本 ADR 不涉及、也不应涉及商家侧看到的任何供应商身份信息——生成引擎对商家始终是白标的
(见 `packages/core/src/provider-secrecy.ts`)，这条边界与选用哪家供应商无关，删除 `fal`
不改变它。
