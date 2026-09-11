# Round 2 问题目录（findings-catalog）

> 编号 `FSE-2xx`，从 `FSE-201` 起递增，不复用第一轮 FSE-001–013。
> 每条六格：复现／预期／实际／证据／根因置信度（**已确认** 与 **假说** 分开写）／建议与复测口径。
> 严重度：P1＝阻塞受影响核心流程或付款确认可信度；P2＝可靠性／展示／辅助流程。**严重度是工程分诊意见，不是已批准的改动范围。**
> 走查环境：staging `web-staging-7901.up.railway.app`，部署 commit `2a96750e`（web 与 worker 同版），2026-09-11。
> 登记去向照 plan.md §6。

---

## FSE-201 · 码错 4 次之后码已作废，页面却还说「检查一下再试」 — P2

| 格 | 内容 |
|---|---|
| **复现** | ① 任一已有账号的邮箱走码门，收到码；② 连续输 4 个错码；③ 再输**那封邮件里真正的码**。 |
| **预期** | 规格 `sign-in.md` SIGNIN-A8 逐字：「第 4 次**要求重新发码**」。第 4 次失败之后，商家应被告知这个码已经不能用了、必须重发。 |
| **实际** | 第 1–4 次错码的提示**逐字相同**：`Code not accepted` / `That code didn't work. Check it and try again, or send it again.`；第 5 次输入**正确**的码仍被拒，提示**还是同一句**。点 `Send again` 拿新码后一次即进（恢复路径通）。即：服务端确实在第 4 次之后作废了这个码，但**商家看到的话从头到尾没变**——他会以为自己打错了，反复重抄同一个已死的码。 |
| **证据** | `run-ledger.md` §R2-05「SIGNIN-A8 ③」：四次错码的逐字回执、随后用**那封邮件里的真码**（值不落盘，见本行下方说明）被拒、`Send again` 后一次即进。夹具 `tools+r2a20260911@belcort.com`，UTC 2026-09-11T12:19–12:21。 |
| **根因** | **已确认（现象层）**：作废发生在服务端、文案不分岔。**假说（代码层）**：错码计数达到上限后返回的仍是通用 `invalid code` 分支，前端没有第二种文案。须在 `apps/web/app/login/` 与 better-auth email-otp 的失败分支上核实。 |
| **建议与复测口径** | 第 4 次失败改一句人话（例如「这个码已经用不了了，请按 Send again 拿新的」）。复测＝重跑本条三步，第 4 次的句子必须**与前三次不同**且点名要重发。登记去向：`docs/specs/sign-in.md` §5。 |

> **凭据脱敏（2026-09-11 第 2 轮修订）**：本条证据格原先抄了那次登录的 6 位真码原文，已删除。登录码属凭据值，任何走查产出都不落盘；判定所需的事实（第 4 次之后真码被拒）由 `run-ledger.md` §R2-05 的逐字回执与 `backend-evidence.md` §2.7 的两把计数器支撑，**不需要码值本身**。该码在 UTC 2026-09-11T12:21 已被服务端作废且未再使用。

---

## FSE-202 · 同一个 Billing 页面上，侧栏余额与正文余额不一致 — P2

| 格 | 内容 |
|---|---|
| **复现** | ① 同一账号开两个标签页：A 停在画布，B 停在 `/billing`（此后**不手动刷新** B）；② 在 A 花掉 1 credit（例如 `Create variations`）；③ 把 B 切到前台，读侧栏数字与正文 `Available balance`。 |
| **预期** | `frontend-baseline.md` §5 fb:202（FSE-010）逐字：另一个标签页的侧栏余额**不需手动刷新**即与 **Billing 正文**、DB 一致。 |
| **实际** | 切到前台 6 秒内**侧栏**自动更新为 `9,999,885.7`（正确、与 DB 一致）；但**同一屏的正文**仍是 `Available balance 9,999,886.7 credits`，`On hold` 仍写 `11 credits held`（那笔 11 credits 的视频早已结算），`Spend history` 仍是 `Video Held … -11`、`46 entries` 未变。**两个数字差 1 credit，并排显示。** 另：标签页处于**后台隐藏**时（`document.visibilityState === 'hidden'`）侧栏也不动，切前台才更新。 |
| **证据** | `run-ledger.md` §R2-13：12:46:44 与 12:47:20 两次隐藏态读数、12:47:37 前台读数（侧栏 `9,999,885.7` vs 正文 `9,999,886.7`）。 |
| **根因** | **已确认**：广播只驱动了侧栏余额组件，Billing 页正文（余额、hold、spend history）没有跟着重取。**假说**：正文是 server component 的一次性渲染，广播事件没有触发 `router.refresh()`。 |
| **建议与复测口径** | 广播落地时一并刷新 Billing 正文（或让正文与侧栏读同一个客户端源）。复测＝本条三步，切前台后**侧栏与正文必须是同一个数**，`On hold` 与 `Spend history` 同步。登记去向：`docs/specs/frontend-baseline.md` §5。 |

---

## FSE-203 · 「理解费」结算前，资产详情写的是「no credits charged」 — P2（观察项，建议 S5 裁）

| 格 | 内容 |
|---|---|
| **复现** | ① 在画布上传一张图；② 立刻在 Library 打开这张图的详情，读 `Cost:` 那一行；③ 等自动理解跑完（几十秒）再打开一次。 |
| **预期** | `creation-engine.md` §5 :169（FSE-009）口径：费用行显示**含理解费的合计**，不拆行，**不再写「no credits charged」**。 |
| **实际** | 理解结算**之后**显示 `Cost: 0.1 credits`（一行合计，**符合规格**）；但在上传成功到理解结算之间那几十秒，详情行写的是 `Cost: no credits charged`，而这笔钱随后一定会收（Billing 出现 `Understanding — -0.1`）。商家在这个窗口看到的是「免费」。 |
| **证据** | `run-ledger.md` §R2-14：同一张图前后两次打开的逐字回执 + Billing 行 `Understanding — Sep 11, 8:54 PM -0.1`。 |
| **根因** | **已确认**：费用行读的是已结算的账本行，理解未结算时自然为空，于是落到「no credits charged」这句默认文案。 |
| **建议与复测口径** | 未结算窗口改成「正在读取这张图，费用稍后结算」之类的诚实中间态。复测＝上传后立刻看详情，**不得**出现「no credits charged」。登记去向：`docs/specs/creation-engine.md` §5。**口径更新（第 3 轮）**：`:169` 的登记行原文含「**不再写 `no credits charged`**」，而本条逐字记录了它在结算前确实出现过 ⇒ `:169` 已由 PASS **改判 PARTIAL**（`coverage-matrix.md` R2-14 行）。结算**后**那半句（一行合计、不拆行）仍然成立。 |

---

## FSE-204 · 短边 80px 的参考图，两个入口都没有在付费前被拦；视频路一直走到供应商才失败 — P1（**根因已确认**，`backend §3.3`）

> **第 4 轮更新**：标题原写「P1（候选，待后端确认闸门位置）」—— 那是 W1 现场写下时的状态。W2 的 `backend-evidence.md §3.3` 已把闸门位置**确认到代码行**（闸只挂「`payload.kind==='video'` × `referenceGenerationIds`」一条路，函数体首两行早退），故本条不再是「候选」。**W1 原句一字未改，保留在下面六格里**，本轮只在标题与根因格补上已确认的那一层。

| 格 | 内容 |
|---|---|
| **复现** | ① 上传一张 **80×107** 的图（本轮用 `r2-20260911-tiny-80px.jpg`）；② 路 A：`@` 它 + 「用这张参考做一张白底商品图」→ 看确认卡 → 批准；③ 路 B：`@` 它 + 「5 秒 720p 无声视频」→ 看确认卡 → 批准。 |
| **预期** | `creation-engine.md` §5 :162 残留① 与 :176⑥：付费前尺寸闸**唯一一份**、**没有一条入口绕得过去**；短边 <100 的图应在**付费前**被诚实拒绝，且**拒绝文案要说出这张图现在多大**（门槛按能否放大分岔 100 / 300）。 |
| **实际** | 路 A：确认卡逐字 `1 image 1728 × 2304 · 3:4 · 1 image · Uses your attached image` / `1 credit`，**无任何尺寸提醒**；批准后**生成成功并真扣 1 credit**。路 B：确认卡逐字 `1 video 9:16 · 5s · 720p · No sound · Starts from your image` / `11 credits`，同样**无提醒**；批准后进入 `Rendering…`，约 3 分钟后节点变成 `That didn't finish / You weren't charged.`，Otto 只说 `That generation didn't go through — you can try again.` —— **没有说明是图太小**。钱路本身是干净的（全额不收费、余额一字未动）。 |
| **证据** | `run-ledger.md` §R2-23 与 §4 预算表第 10、12 行。UTC 2026-09-11T12:56–13:04。 |
| **根因** | **已确认（现象层）**：这两条入口在付费前没有任何尺寸判断或披露；视频那条一直走到供应商才失败，失败原因没有回给商家。**假说（代码层，须后端／代码取证）**：尺寸闸可能只挂在「商品参考进视频」这一条路径上，而「图生图的 base image」与「视频的 starting frame」两条路没有经过同一个闸；也可能闸门读的是 `Asset.width/height`，而这两条路读的是别的字段。**在闸门位置查清前，不把它写成「闸门失效」。**<br>**已确认（代码层，第 4 轮按 `backend §3.3` 同步；上面 W1 的原句保留不改）**：假说的**第一条成立、第二条不成立** —— 闸只挂「`payload.kind==='video'` × `referenceGenerationIds`」一条路（`reference-upscale-gate.ts` 函数体首两行即早退）；图生图卡是 `kind='image'`、视频起始帧那张图在 `sourceGenerationId` ⇒ **两条路都从未进过闸**。不是「读不出尺寸」那一档：`Asset.width=80/height=107` 早在 12:56:57Z 就落库，**早于**两次付费动作。 |
| **建议与复测口径** | 先由后端确认这两条路是否经过尺寸闸；若未经过，收成唯一一份。复测＝同一张 80px 图跑**四个入口**（画布确认卡、Library 动作、Otto 主动、分镜挂图），每个入口都必须在**付费前**拒绝并说出实际短边；再补一张短边 100–300 的图验「自动放大 + 独立一行披露句」（:176④）。登记去向：`docs/specs/creation-engine.md` §5。 |

---

## FSE-205 · 失败卡 `Edit and retry` 恢复草稿后，看不到 `retry-source` 那一行 — P2（**根因链已确认**，`backend §7`）

> **第 4 轮更新**：标题原写「P2（未复现，路径待确认）」—— 那是 W1 现场写下时的状态。W2 的 `backend-evidence.md §7` 已把根因链**逐行闭合**并给出一条可证伪的复现路，故不再是「路径待确认」。**W1 原句一字未改，保留在下面六格里。**

| 格 | 内容 |
|---|---|
| **复现** | ① 让一次生成真实失败；② 清空输入框，点失败卡上的 `Edit and retry`；③ 在输入框上方找 `Retrying: "…"` 那一行与它旁边的 `Remove`。 |
| **预期** | `creation-engine.md` §5 :163②：输入框上方有 `retry-source` 一行，念得出源消息原话（截断到 48 字）、念不出就说是更早的一条；旁边 `Remove` 只清这一格。 |
| **实际** | 草稿**正确恢复**（原句 + 引用芯片都回来了），但全页 `[data-slot="retry-source"]` **查无此元素**，屏幕上也没有任何 `Retrying:` 字样；只有引用芯片自己的 `Remove image`。 |
| **证据** | `run-ledger.md` §R2-12。UTC 2026-09-11T13:05。 |
| **根因** | **假说**：渲染条件是 `restoredDraft?.sourceMessageId`（`apps/web/components/otto/OttoChatStream.tsx:1299`）；本轮走的是**失败卡上的** `Edit and retry`，该路径若不带 `sourceMessageId`，这一行就永远不出现。也可能这一行只在**聊天消息**的重试路径上出现。**两种可能都没有验证，故不判 FAIL。**<br>**已确认（代码层，第 4 轮按 `backend §7` 同步；上面 W1 的原句保留不改）**：第一种可能成立 —— `liveRetryDraft()`（`OttoChatStream.tsx:610–613`）把 `sourceMessageId` **写死为 `null`**，而 `richerTurnReferenceDraft`（`turn-reference-draft.ts:239–241`）**只比「有没有引用」**，未刷新就重试时选中的正是直播那份 ⇒ `retrySourceId` 为 null、那一行永不渲染（`retrySourceNote()` 本身永不返回空串）。**可证伪的复现路**：先刷新再点 `Edit and retry`，那一行应当出现。 |
| **建议与复测口径** | 由代码侧确认 `sourceMessageId` 在失败卡重试路径上是否写入；若不写入，要么补上、要么把 :163② 的适用范围写清楚。复测＝两条重试路径（失败卡、聊天消息）各走一次，按规格判该行是否应出现。登记去向：`docs/specs/creation-engine.md` §5。 |

---

## FSE-206 · 产品「归档」说是「hidden from Otto」，但 Otto 的 @ 菜单照样搜得到、选得中 — P2

| 格 | 内容 |
|---|---|
| **复现** | ① Brand（`/brand/records` → Your products）对一件产品点 `Actions → Archive`；② 页面出现 `Archived (1) — hidden from Otto`；③ 回画布输入 `@<产品名的一段>`。 |
| **预期** | 页面自己许诺的就是判定口径：归档＝**对 Otto 隐藏**。`@` 菜单是 Otto 的引用入口，归档件不应出现在那里。（规格 `brand-product-identity.md` 没有单列归档的验收编号，故按页面许诺 + PRODID-A6 的同步精神判。） |
| **实际** | 归档后：`@RENAM` 仍然弹出 `R2 Coral Tumbler RENAMED / Product` 并可选入；Library `Elements → Products` 也仍然列着它。 |
| **证据** | `run-ledger.md` §R2-09「①′」。UTC 2026-09-11T13:24。（已 `Unarchive` 还原。） |
| **根因** | **已确认（现象层）**：归档标记没有传到 `@` 菜单与 Library Elements 的查询条件。**假说**：归档只改了 `BrandRecord` 的一个展示字段，Entity 侧的可见性未联动。 |
| **建议与复测口径** | 要么让归档真的从 `@` 与 Library 隐藏，要么把文案从「hidden from Otto」改成它实际做到的事。复测＝归档后 `@` 菜单搜不到、Library Elements 不列；取消归档后两处都回来。登记去向：`docs/specs/brand-product-identity.md` §5（接 `PRODID-R10` 往下排）。 |

---

## FSE-207 · 别的租户的画布深链，被**静默换成一张新画布**（无拒绝、有写入） — P2（含一条 P1 口径待裁）

| 格 | 内容 |
|---|---|
| **复现** | ① 租户 A 建一张画布，记下地址 `…/create/canvas?project=canvas_<A 的 id>`；② 登出，用**另一个租户**登录；③ 直接打开那个地址。 |
| **预期** | `creation-engine.md` §5 :172④：深链指向非本店对象时**整卡 fail closed、零写入、不静默回退造新对象**。 |
| **实际** | **没有泄漏**（租户 A 的节点、提示词、余额一个字都没出现 —— 隔离本身是好的）；但地址被**静默换成一个全新的 project**（`…?project=01M289WJEET9N9H30NB2ENYPW6`），呈现为一张空白新画布，**全程没有任何提示**。即：一次**未经请求的写入**（新建了一个画布对象），且商家不知道自己点的那条链接失效了。 |
| **证据** | `run-ledger.md` §R2-19。第二租户 `tools+r2f20260911@belcort.com`，UTC 2026-09-11T13:18。 |
| **根因** | **已确认（现象层）**：取不到目标 project 时走了「建一个默认 project」的兜底。**假说**：`getOrCreateDefaultProject` 类的兜底被放在了深链解析失败之后。 |
| **建议与复测口径** | 深链解析失败改成诚实拒绝页（「这条链接不属于你的工作区」）并**零写入**。复测＝跨租户打深链，地址不得被改写、不得新建 project、必须有一句人话。登记去向：`docs/specs/creation-engine.md` §5。**严重度**：无泄漏故记 P2；若 Founder 按「零写入」是硬口径来判，则升 P1 —— 留 S5 裁。 |

---

## FSE-208 · 「先合成首帧再动画」在**无人物**镜头上仍被主动提议 — 待 Founder 裁（暂记 P2）

| 格 | 内容 |
|---|---|
| **复现** | 让 Otto 出一张多镜分镜，其中一镜是**纯商品、无人物**。 |
| **预期** | `creation-engine.md` §5 :162④（#1307 第一批已修）：Otto 的两步计划与手艺文件里**不再出现**「先合成首帧再动画」的提议。Founder 2026-09-08 原话：「合成 first frame 的 idea 可以移除了，没有必要」。 |
| **实际** | 带演员的两镜：Otto 逐字 `Shots 1 & 3 are made in one step each (Xinyi's reference photos go straight to the video).`，镜头卡上还写 `Goes straight to video — the cast and product photos are its references, so there is no first frame to make or pay for.` —— **完全符合**。但**纯商品那一镜**：`Shot 2 needs a starting picture first, then animates — two steps, but the storyboard handles it.`，分镜卡上也确实有 `Generate all first frames (1)` 按钮。另外商家**明说**要两步时（R2-22），Otto 会劝退并解释，不出卡。 |
| **证据** | `run-ledger.md` §R2-24 与 §R2-20、§R2-22。UTC 2026-09-11T12:50–13:14。 |
| **根因** | **不适用**（这不是缺陷判定，是口径问题）：Founder 那句话是只针对**带演员**的场景，还是针对**所有**场景，走查者不替 Founder 解释。 |
| **建议与复测口径** | 请 Founder 在 S5 明确一句：无人物镜头的「首帧→动画」是保留还是一并移除。若保留，:162④ 的措辞应补上「仅指带演员的镜头」；若移除，复测＝任何分镜里都不得出现 `Generate all first frames` 与两步提议。登记去向：`docs/specs/creation-engine.md` §5。 |

---

## 不编号的观察（现象照录，不当 bug，供 S5 参考）

1. **开户赠金与 `+tag` 变体**：`tools+r2a20260911@belcort.com` 登录后余额为 **0**、`Spend history` 为 `No credit activity yet`。原因是归一化幂等键（`canonicalGrantEmail` 去掉 `+tag` 与点号）判定同一个真实收件箱已领过 —— 这**正是 SIGNIN-A17 要的行为**，不是缺陷。代价：本轮无法用 `tools+…` 系列夹具验证 SIGNIN-A10 的「赠金恰好一笔」。
2. **cap 拒绝被显示成「失败」**：Library 动作被自己的花费上限挡下后，按钮标签变成 `Failed — retry?`。
3. **刷新后 `Conversation` 计数变化**：直播态 34 → 刷新后 29（口径不同，内容无损）。
4. **Brand 页没有「删除产品」**：只有 `Archive`；真正的删除入口在 Library（`Remove from Library`），且删除后**没有任何恢复入口**（无 Undo、无回收站）。PRODID-A6 的两个「恢复」格因此本轮无从执行。
5. **Railway 崩溃告警**：Gmail 收到 `Deployment crashed for worker/web in FIKIRTIVE!`（UTC 11:40 / 11:45，紧接本次部署 11:39:15Z），当前两服务均 SUCCESS、健康检查绿。建议后端在日志里核一眼那两分钟是否有请求失败。

---

> **以下两条由 W3 于合成阶段收录**（W2 在 `backend-evidence.md` 里查出、未擅自编号，留给编排者裁）。六格素材全部出自 `backend-evidence.md`，**无新增现场事实**。收录理由与可推翻的口径见 `report-round2.md` §5「W3 的两处处置说明」。

## FSE-209 · 登录审计的租户归属全库写死 `founder`，别的租户查不到自己的登录记录 — P2

| 格 | 内容 |
|---|---|
| **复现** | ① 任一非 founder 租户的账号登录一次；② 按该租户的 `ownerId` 查 `ActionEvent` 里 `type='auth.signin'` 的行。 |
| **预期** | `sign-in.md` SIGNIN-A10 逐字：「登录审计各恰好一行」。审计行要挂在**发生这次登录的那个租户**名下，否则「各恰好一行」在租户维度上无从查起。**口径收紧（第 2 轮修订）**：本条只主张「按租户查审计查不到」，**不主张**商家面有一个可见的登录历史界面 —— 本轮没有取证过这样的界面，那句推断已删。 |
| **实际** | 行数是对的（取证窗口内 8 行，每次登录一行）；但 `ActionEvent.auth.signin` 的 `ownerId` **全库 26 行全部写死 `founder`**（26/26），包括本轮两个新租户的登录。payload 逐字只有 `{"email": …}`（`backend §2.8` 原文），**没有会话或令牌**。**但「没有泄漏」是一句整体断言，本轮没有证据支撑，因此不写**：已证的是**写路**把别的租户的登录事件写进了 founder 名下的行；**读路从未取证** —— 本轮没有找到、也没有查过任何按 `ownerId` 读 `ActionEvent` 的 founder 侧界面，所以只能说「**未发现读到别租户内容的暴露面**」，不能说「已证明没有」。 |
| **证据** | `backend-evidence.md` §2.8：窗口内逐行 ＋ 全表 `auth.signin` 的 `ownerId` 分布（26/26 `founder`）。走查窗口 UTC 2026-09-11T12:00–13:20，部署 `2a96750e`。 |
| **根因** | **已确认（数据层）**：写审计行时 `ownerId` 没有取当次登录的租户，而是落到了常量／默认值 `founder`。**假说（代码层）**：审计写入点在登录回调里拿不到刚建好的 org id，于是退回默认值 —— 未核实具体写入点，须在 `auth.signin` 的 ActionEvent 写入处确认。 |
| **建议与复测口径** | 审计行改挂当次登录的租户。复测＝两个不同租户各登录一次，各自按自己的 `ownerId` 查得到且**只查得到自己**那一行。登记去向：`docs/specs/sign-in.md` §5。**反向一面（第 2 轮补写，须一并复测）**：既然 26 行全落 `founder` 名下，**任何按 `ownerId` 读 `ActionEvent` 的 founder 侧界面都会读到别的租户的登录邮箱**。本轮没有找到也没有取证过这样的界面 ⇒ 现状是「未发现暴露面」，**不是「已证明没有暴露面」**；复测时必须同时确认 founder 侧读审计的路径。 |

---

## FSE-210 · `@` 选入的**产品**没有进入生成谱系（PRODID-A2 后半不成立） — P2

| 格 | 内容 |
|---|---|
| **复现** | ① 在画布输入 `@` 加产品名，从菜单选入那件产品（来源标签 `Product`）；② 让它进入一次生成；③ 查确认卡 payload 与 `GenJob` 的 `entityIds`／`approvedEntities`。 |
| **预期** | `brand-product-identity.md` PRODID-A2 逐字：「选入确认卡后，生成结果谱系的 `approvedEntities` 指向同一个 Entity id」。 |
| **实际** | 前半句成立（菜单出现、来源标签 `Product`、可选入并进入生成）；**后半句不成立**：那一轮 USER 消息的 `payload.entityIds` **有**产品 Entity id，但确认卡 `entityIds=[]`、`GenJob.entityIds={}`、`approvedEntities=NULL` ⇒ **产品只以提示词文字上路，没有进入生成谱系**。对照组：同一张画布上 `@Xinyi`（官方演员）那一轮，三格齐全。另：该消息 `referenceRefs` 为空。**「首页 composer 走 `canvas.create-handoff` 那条路会丢 typed ref」是假说，未核实** —— 本轮只有现象（seq 1 空、seq 7/17/21 有），没有核过那条代码路径。 |
| **证据** | `backend-evidence.md` §4.5（USER 消息 payload、GEN_CARD payload、`GenJob` 三处逐格对照；对照组见 §3.1）。走查窗口 UTC 2026-09-11T12:33–12:40，部署 `2a96750e`。 |
| **根因** | **已确认（数据层）**：产品 Entity id 在「消息 → 确认卡」这一步就掉了，不是生成时才丢。**假说（代码层，第 2 轮口径收紧）**：`backend-evidence.md` §4.5 的原话只到这里 —— 「服务端**没有**按类型硬过滤（`propose.helpers.ts:942` 的 `=== "CHARACTER"` 只是在**计数**）⇒ 更像是 `propose` 的入参里就没带上产品 id，而不是被服务端丢掉。**这一点未被完全证死**（没有留存那一次 tool 调用的原始入参）」。因此「确认卡铸造时只搬运演员类 typed ref」是**一条未经代码核实的推断**，不是查表结论；`canvas.create-handoff` 丢 `referenceRefs` 同样只有现象（seq 1 空、seq 7/17/21 有）。两处都要在改之前先核实代码位置。 |
| **建议与复测口径** | 产品与演员走同一条 typed ref 搬运路；`canvas.create-handoff` 保住 `referenceRefs`。复测＝`@` 一件产品出一次片，`GenJob.entityIds` 与 `approvedEntities` 必须指到同一个 Entity id（与 PRODID-A2 逐字一致）；首页 composer 与画布内两条提交路各验一次。登记去向：`docs/specs/brand-product-identity.md` §5（接 `PRODID-R10` 往下排）。**注**：本条直接抵触 Founder「有迹可循」原则，严重度请 Founder 过目。 |

---

> **以下一条由 W3 于第 2 轮修订时补编号**。上一版把它写成「未编号缺口，提请 S5 决定是否编号」，判官指出这不满足 `plan.md` §6「本轮发现一律编 FSE-2xx」的字面要求 —— 已按规矩补齐六格。六格素材全部出自 `backend-evidence.md` §3.5，**无新增现场事实**。

## FSE-211 · 生成记录的「路由理由」与「送出稿全文」两格全是空的（CREATE-A12 后半句不成立） — P2

| 格 | 内容 |
|---|---|
| **复现** | ① 用任意一条路（画布确认卡／Library 动作／variation 弹窗）跑一次生成；② 查那条 `Generation` 的 `routeReason` 与 `finalPromptText` 两列。 |
| **预期** | `creation-engine.md` CREATE-A12 逐字的后半句：**路由理由字段有值可读**。商家（或支持人员）事后要能看出这一次为什么走了这个模型／这条路。 |
| **实际** | 本轮 **4 条 Generation 的 `routeReason` 全为 `NULL`、`finalPromptText` 全为空**。**本条只主张这一件事**：`CREATE-A12` 被证否的那半句。前半句（`sentPromptText` 与批准稿逐字一致）的判定不在本条范围内，它挂在 `coverage-matrix.md` 的 `CREATE-A12` 行与 `backend §3.5`，本条不扩大到那里。 |
| **证据** | `backend-evidence.md` §3.5（四条 Generation 逐列取数；同节给出前半句的整串等值判定）。走查窗口 UTC 2026-09-11T12:35–13:04，部署 `2a96750e`。**无截图** —— 这两格是库内字段，商家面不显示（本轮截图缺口的总说明见 `report-round2.md` §3）。 |
| **根因** | **已确认（数据层）**：这两列在本轮四条记录上确实没有被写入。**未确认（代码层）**：是写入点没写、还是这两列已被废弃而验收表没跟着改 —— 本轮**没有**核实写入点，不下结论。 |
| **建议与复测口径** | 这是一条**口径题，不是纯修复题**：要么把两格填上（生成时写入路由理由与最终送出稿），要么把「路由理由字段有值可读」从 CREATE-A12 里去掉 —— **两条路都改规格，由 Founder／S5 拍板**。复测＝跑一次生成，按拍板结果验：填的话 `routeReason` 非空且人能读懂；去掉的话验收表里不再有这一格。登记去向：`docs/specs/creation-engine.md` §5。 |
