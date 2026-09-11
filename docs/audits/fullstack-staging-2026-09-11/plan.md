# 第二轮全栈 staging 走查 — 计划稿（Round 2 / plan）

日期：2026-09-11。票：[#1330](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1330)。范围裁决：[#1309](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1309)（Founder 2026-09-10 拍板）。里程碑地图：[#1304](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1304)。

**这份文件只是走查计划，不是走查结果、不是验收通过、不授权部署或生产写入。** 本文件由只读仓库调查写成：没有打开 staging、没有跑生成、没有查数据库。所有「预期结果」是**判定口径**，不是已观察事实；走查执行者必须逐条自己取证。

体例照第一轮 [`docs/audits/fullstack-staging-2026-09-08/`](../fullstack-staging-2026-09-08/)：本轮产出同样拆四份 —— `run-ledger.md`（执行记录）、`backend-evidence.md`（只读 DB／日志回执）、`coverage-matrix.md`（覆盖矩阵）、`findings-catalog.md`（问题目录），最后合成 `report-round2.md`。本 `plan.md` 是它们开工前的唯一范围依据。

---

## 0. 开工前必须先做的三件事（preflight，缺一不得开跑）

1. **版本对齐**：记录 staging web 与 worker 的部署 commit，两者必须同版；`/api/ready`（ready / db / migrations）与 `/api/health`（worker / backup / build.sha）各存一份原文。本地 checkout 不能当部署代码（第一轮教训，[preflight.md](../fullstack-staging-2026-09-08/preflight.md)）。
2. **前置票状态**：#1330 的 blocked-by 共 15 张（#1316–#1329、#1310）。逐张确认已合并进主干**且**已随本次 staging 部署上线；未上线的票对应的走查条目一律标 `NOT RUN（未部署）`，不得按代码已合并推定通过。
3. **环境边界复述**：素材存储是否仍与 production 共享（第一轮 ENV-01）、provider 路由（第一轮 ENV-02）、备份状态。共享存储下的上传／生成需要 Founder 对**本轮**的豁免；第一轮的豁免不自动延续。

---

## 1. 走查范围（逐条，按 #1309 必测面）

编号 `R2-xx` 只是本计划内的条目号，便于 run-ledger 与 coverage-matrix 对齐；它不是验收编号。

| 条目 | 范围 | 来源 |
|---|---|---|
| R2-01 | 登录门 · 码门（email + 6 位码）全路径 | #1309 必测；`sign-in.md` |
| R2-02 | 登录门 · Google 门全路径（含 #1310 回调复验） | #1309 必测；#1310 |
| R2-03 | 登录门 · 两扇门合并为同一账号／工作区 | `sign-in.md` |
| R2-04 | 登录门 · 密码面退役与旧端点 404 | `sign-in.md` |
| R2-05 | 登录门 · 暂停新注册、后台撤销、限流 | `sign-in.md` |
| R2-06 | 登录门 · 首登副作用（工作区名空、赠金一笔、演员播种、邮箱大小写归一） | `sign-in.md` |
| R2-07 | Brand → Library → @ → 确认卡：同一件产品一条身份 | #1309 必测；`brand-product-identity.md` |
| R2-08 | 产品身份 · 双向编辑同步与字段归属 | `brand-product-identity.md` |
| R2-09 | 产品身份 · 删除／恢复矩阵（两个方向） | #1309 必测；`brand-product-identity.md` |
| R2-10 | 产品身份 · 租户隔离与账本零新增 | `brand-product-identity.md` |
| R2-11 | FL-03 复走：官方演员 + 商品 → 视频（正路＝两张参考直接出片，无合成首帧） | #1309 必测；上轮 FAIL |
| R2-12 | FL-04 复走：编辑 / variation 入口 / 重试 / 报价版本 | #1309 必测；上轮 PARTIAL/FAIL |
| R2-13 | FL-05 复走：Canvas / 历史 / 规划（终态实时同步、余额广播） | #1309 必测；上轮 PARTIAL/FAIL |
| R2-14 | FL-06 复走：Library / 上传 / 理解 / 导出 | #1309 必测；上轮 PARTIAL/FAIL |
| R2-15 | variation 真实交付（上轮门槛 A3） | #1309 必测；`creation-engine.md` §5（2026-09-10 行） |
| R2-16 | 取消语义（Working 任务 Stop → 退款口径） | #1309 必测；上轮 NOT RUN |
| R2-17 | 花费上限 cap：多入口与并发 | #1309 必测；上轮仅单入口 |
| R2-18 | 完整下载文件字节 | #1309 必测；上轮仅「已启动」 |
| R2-19 | 刷新 / Back / 深链恢复 | #1309 必测 |
| R2-20 | 盯项①：`instructions.ts` 两步提议（先合成首帧再动画）不再出现 | #1307 第一批；`creation-engine.md` §5 :162④ |
| R2-21 | 盯项②：接续（continuity）与直接出片同开，跑真引擎 | #1307「Round 2 再看」；`creation-engine.md` §5 :172⑥ |

**明确不在本轮**（#1309 留第三轮／beta 前）：手机端与大屏、键盘/IME/无障碍全矩阵、双租户攻防全矩阵、备份恢复演练、供应商成本总账、注册并发与邮件 SLA、staging-live。碰到就登记，不扩范围。

---

## 2. 每条对应的验收编号／登记行与预期结果

编号逐字抄自规格；**一条只挂它真正证明的那一条**，借号即 P1（家规 M3 口径）。规格 §5 的登记行没有验收编号的，写「登记行（日期＋首句）」，S5 按登记行验。

### 2.1 登录门（`docs/specs/sign-in.md` §2，前缀 SIGNIN）

| 条目 | 验收编号 | 预期结果（判定口径，逐字依规格） |
|---|---|---|
| R2-01 | SIGNIN-A1 | 从未出现过的邮箱按 Continue with email，收邮件手输 6 位码 → 直接进产品；账号与工作区已建立；全程没有出现第二个页面叫注册 |
| R2-01 | SIGNIN-A5 | 点邮件里的 Log in 按钮 → 登录页打开、码已填好，按一次 Continue 即登录；同一封邮件的链接第二次点无效；15 分钟后无效 |
| R2-01 | SIGNIN-A16 | `Aisha@Example.com` 与 `aisha@example.com` 各登录一次 → 同一个账号；`AllowedEmail` 只有一行小写 |
| R2-02 | SIGNIN-A2 | 从未出现过的 Google 账号按 Continue with Google 选账号 → 直接进产品；账号与工作区已建立 |
| R2-02 | SIGNIN-A14 | 让 Google 门失败一次（取消授权、撤销邮箱、暂停期陌生人各一次）→ 每次都回到 `/login` 页内提示；从不落在 better-auth 自带错误页，从不出现裸 JSON |
| R2-02 | SIGNIN-A13 | Google 报「邮箱未验证」的账号按 Google → 回到 `/login` 提示改用 email；数据库里没有为它建任何用户行（**若 staging 无法造出该账号，标 NOT RUN 并写明原因，不得推定通过**） |
| R2-03 | SIGNIN-A3 | 先用码登录过的邮箱改用同邮箱 Google 登录，再反过来 → 进的是同一个账号、同一个工作区；数据库里只有一个用户、一个工作区 |
| R2-03 | SIGNIN-A12 | 端到端：陌生邮箱收码登录 → 生成一张图 → 登出 → 同邮箱 Google 登录 → 看到刚才那张图；始终是同一个工作区 |
| R2-04 | SIGNIN-A4 | `/signup`、`/forgot-password`、`/reset-password` 三个地址都回到 `/login`；登录页没有密码框、没有 Forgot password；对公网请求 `/sign-up/email`、`/sign-in/email`、`/forget-password`、`/reset-password`、`/change-password`、`/set-password`、`/request-password-reset` 一律 404 |
| R2-04 | SIGNIN-A11 | 走查登录页与全部公网 auth 端点，尝试用任何方式设置密码 → 没有任何途径能建立密码 |
| R2-04 | SIGNIN-A9 | 查数据库：`BetterAuthAccount` 里 `providerId = "credential"` 的行数为 0 |
| R2-05 | SIGNIN-A6 | 打开 `SIGNUPS_PAUSED=1` 后：页顶横幅说明暂停；陌生人两扇门都进不来、不建账号、不寄码；老用户正常进入（**改 staging 环境变量须 Founder 当次授权；未授权则标 NOT RUN**） |
| R2-05 | SIGNIN-A7 | 后台撤销一个自助进来的已登录邮箱 → 后台能撤；他原来的登录下一次请求即失效；两扇门都进不来；页面反应与输错码一模一样，不说明原因 |
| R2-05 | SIGNIN-A8 | 同一邮箱一小时内要 6 次码、一个码连错 4 次 → 第 6 次被拒并提示一小时后再试；第 4 次要求重新发码；对陌生与老邮箱的响应时间与文案一致 |
| R2-06 | SIGNIN-A10 | 经 Google 与码各建一个新账号 → 工作区名都为空、赠金都恰好一笔 `SIGNUP_GRANT_CREDITS`（幂等键 `signup:<orgId>`）、`emailVerified = true`、`AllowedEmail` 都是 status active，只差来源门标记；登录审计各恰好一行 |
| R2-06 | SIGNIN-A17 | `me+001@gmail.com`、`me+002@gmail.com`… 连开 30 个账号 → 赠金只发给第一个；同一小时全站新账号超上限（默认 50）后第 51 个进不来并触发告警（**脚本批量开号会真发邮件、真占额度；须 Founder 当次授权，否则缩成 3 个 `+tag` 变体只验幂等键，并如实标「部分执行」**） |
| R2-06 | SIGNIN-A15 | 首登建号中途失败一次后同邮箱再登录 → 第二次成功；库里该邮箱只有一个用户、一个工作区、一笔赠金（**需人为制造失败，staging 不便造则标 NOT RUN**） |

### 2.2 产品身份（`docs/specs/brand-product-identity.md` §2，前缀 PRODID；§5 登记编号 PRODID-R1–R9）

| 条目 | 验收编号／登记行 | 预期结果 |
|---|---|---|
| R2-07 | PRODID-A1 | 在 Brand 页新增产品（名字、主图、价格）→ Library Products 出现同一产品卡；该 BrandRecord 的 `entityId` 等于卡片的 Entity id |
| R2-07 | PRODID-A2 | 在画布输入 @ 加产品名 → 菜单出现该产品，来源标签为「Product」；选入确认卡后，生成结果谱系的 `approvedEntities` 指向同一个 Entity id |
| R2-07 | PRODID-A3 | 在 Library「新建元素 → 产品」→ Brand 页产品分区出现同一产品，价格卖点为空待填 |
| R2-07 | PRODID-A7 | 对 Otto 说「记下产品 X」；另让网站理解提取一个产品但不确认 → 前者两边出现；后者在确认前不出现在 Library 与 @ 菜单 |
| R2-08 | PRODID-A4 | 在 Library 改名或换主图；再在 Brand 页改名或换主图 → 另一边同步显示（同一行 Entity），无第二份名字或图 |
| R2-08 | PRODID-A5 | 在 Library 元素页找价格、卖点、分类的编辑入口 → 没有；这三项只在 Brand 页可改 |
| R2-08 | §5 登记 PRODID-R6 / PRODID-R9（2026-09-10 / 2026-09-11） | 只改价格、归档、换封面、撤销一次 Otto 改动这几条与名字无关的路，**不会**把另一处刚改的名字或封面静默写回旧值 |
| R2-09 | PRODID-A6 | 在 Brand 页删除产品；再在 Library 恢复它 → Library 该元素随删随消失、随恢复回来；反向亦然；已生成的成片不动 |
| R2-09 | §5 登记 PRODID-R8（2026-09-10） | 名字槽位已被新的那件占住时，恢复给的是一句按 `kind` 分的人话，不是被 catch 吞成「请重试」 |
| R2-09 | §5 登记 PRODID-R2（2026-09-10） | 删掉一件产品**唯一**那张照片时字节真删，两个面同时变成「这件产品没有封面」 |
| R2-09 | §5 登记行（2026-09-10「两个删除方向都不再清扫封面字节」） | 删整件产品时封面字节**保留**（fail open，可恢复）；本轮只取证现象，是否清扫待 S5 裁 |
| R2-10 | PRODID-A9 | 用租户 B 的账号在 @ 菜单与 Library 找租户 A 的产品；再直接构造指向 A 产品的 `entityId` 写入 → 找不到；写入被数据库拒绝（**只用两个自有测试账号；越权攻防全矩阵是第三轮**） |
| R2-10 | PRODID-A10 | 建、改、删产品各一次后看余额与账本 → 余额不变，账本零新行 |
| R2-07 | §5 登记 PRODID-R4（2026-09-10） | 存量 Library 里无价签的产品卡在 Brand 页看不到；此时 Brand 页新增同名会造第二个身份 —— **本轮只取证现象并登记，待 Founder 裁，不当 bug 报 P1** |

PRODID-A8 本轮口径：它是迁移前后两条计数，属施工票 #1321／#1337 的一次性证明，本轮**不重跑迁移**；只查「非草稿 product 行 `entityId` 全非空」这一句（读法照 §5 登记 PRODID-R3）。

### 2.3 Creation（`docs/specs/creation-engine.md` §2 验收表 + §5 登记行）

| 条目 | 验收编号／登记行 | 预期结果 |
|---|---|---|
| R2-11 | §5 登记行 2026-09-08 :162（FSE-001；Founder 2026-09-08 裁「合成 first frame 的 idea 可以移除了」） | 官方演员＋商品图**两张参考直接出片**、不出合成首帧；一次成功可播放视频；失败只退款一次且拒绝文案按真实引用来源分岔，不再叫已用官方演员的商家「去 Library 挑一个演员」 |
| R2-11 | CREATE-A10 | 选演员库角色在不少于两个不同场景连续出片 → 正常生成，不触发人脸拦截；生成记录可查到所引角色 |
| R2-11 | §5 登记行 2026-09-09（商品照自动放大） | 短边偏小的真实商品照不再被供应商「宽度 ≥300px」硬闸零花费弹回 |
| R2-12 | §5 登记行 2026-09-08 :163①②（Edit and retry） | 「Edit and retry」恢复的是文字**加**原引用；非空草稿有提示；`restoredDraft.sourceMessageId` 的提示与清除成立 |
| R2-12 | §5 登记行 2026-09-08 :170（FSE-012；Founder 口径＝服务器校验报价版本） | 报价数量 1→2 期间提交旧报价 → **服务器拒绝并刷新**；不是锁控件 |
| R2-12 | CREATE-A1 | 同一条人话走增强预览提交与直接提交，前置报价数字相同（画布路径的判定落在 Otto 确认卡片上） |
| R2-12 | CREATE-A12 | 任取一次走增强路径的生成（含对该资产按一次 Regenerate）→ `sentPromptText` 与商家批准的增强稿逐字一致；路由理由字段有值可读 |
| R2-15 | §5 登记行 2026-09-10（variation 真实交付，上轮门槛 A3） | Create variations 至少一次**真实可用交付**（有产物、可看/可播，账本一次 reserve 一次 settle）；失败时全额退款一次且 reserved=0 |
| R2-13 | §5 登记行 2026-09-08 :164（FSE-005 终态同步）与 :173（第二症状） | 失败／完成节点出现时 Current turn 与 Conversation **不需手动刷新**即同步；合成后原商品节点不消失 |
| R2-13 | CREATE-A11 相邻样本（纯规划轮） | 纯规划轮不新增 GenJob、不调搜索工具（`OttoTurnTrace.toolCalls` 为空可查）。**注**：CREATE-A11 正文判的是音频参考件数与总长的拒绝，若本轮不跑音频，就不挂 A11，只记「纯规划样本」 |
| R2-14 | §5 登记行 2026-09-08 :169（FSE-009；Founder 口径＝只显示合计） | 上传详情的费用行显示**含理解费的合计**，不拆行，不再写「no credits charged」 |
| R2-16 | §5 登记行（取消语义，上轮 NOT RUN） | Working 任务可取消；取消后账本口径明确（退款或不收费），无残留 hold。**本轮若产品面无 Stop 控件，照实记「无取消入口」，不写成功能失败** |
| R2-17 | §5 登记行（cap 多入口与并发，上轮仅 CAP-01 单入口） | cap 生效于**每个**发起入口（Library 动作、画布确认卡、Otto 主动、分镜等）；并发两次提交不产生越过 cap 的扣费；被拒绝时零新 GenJob、零新账本行 |
| R2-18 | §5 登记行（完整下载字节，上轮 PARTIAL） | 下载得到的文件真实存在且字节可校验（大小、格式、可播放／可打开），不是只触发了 download 事件 |
| R2-19 | §5 登记行 2026-09-08 :172④（直接出片 @ 到已删／非本店元素 fail closed） | 深链／引用指向已删或非本店对象时整卡 fail closed、零写入，不静默回退造新对象 |
| R2-20 | §5 登记行 2026-09-08 :162④（#1307 第一批已修） | Otto 的两步计划与手艺文件里**不再出现**「先合成首帧再动画」的提议；带演员的镜头直接出片 |
| R2-21 | §5 登记行 2026-09-08 :172⑥ | 接续（continuity）与直接出片**同时开启**跑一次真引擎：卡面与扣费一致、不铸多余首帧子卡、产物人物与商品都在 |

### 2.4 前端基线（`docs/specs/frontend-baseline.md` §2 / §5）

| 条目 | 验收编号／登记行 | 预期结果 |
|---|---|---|
| R2-14 | FRONT-A5 | Library 看生成历史与上传，按提示词搜索、按收藏筛选、点收藏 → 列表与筛选结果来自服务器；收藏后刷新仍收藏 |
| R2-14 | FRONT-A6 | 新建 collection，加入一个生成结果与一个上传，移除一项，删除 collection → 每步刷新后仍成立；另一租户看不到该 collection；删除后其成员对象仍在 Library |
| R2-14 | FRONT-A7 | Library 对一个生成结果点「Use in canvas」→ 当前项目画布出现该节点，节点归属当前项目与租户 |
| R2-07 | FRONT-A10 | 输入框打 `@`，选一个最近对象或按类型搜到的对象后发送 → 列表来自服务器；消息记录保存该对象的真实 ID，可回链 |
| R2-19 | FRONT-A12 | 用生产构建访问 `/product-patterns/*` 与 `/design-system/*` → 不可达；商家面不出现夹具数据；任何写入失败都有错误反馈，不出现「假成功」 |
| R2-13 | §5 登记行 2026-09-08 fb:202（FSE-010；口径＝BroadcastChannel 广播） | 两个标签页并排：一个标签页花钱后，另一个标签页的侧栏余额**不需手动刷新**即与 Billing 正文、DB 一致 |
| R2-06 | §5 登记行 2026-09-10（FRONT-A2 的密码旅程随登录门①退役） | FRONT-A2 的密码半段**不再走**；该面改按 SIGNIN-A1／A4 判 |
| R2-14 | §5 登记行 2026-09-08 fb:203（FSE-011，#1307 列「先复现」） | 先确认 Profile 邮箱字段空白能否复现；能复现就取证登记，不在本轮修 |

FRONT-A1／A3／A4／A8／A9／A11／A13／A14 本轮**不作为必测**：A1 是钱引擎全表重跑、A13 是分支行为测试、A14 是 Founder 本人六面走查，都不在 #1309 的本轮范围。顺手观察到偏差就登记，不写成本轮判定。

---

## 3. 每条的操作步骤

**目标环境**：`https://web-staging-7901.up.railway.app`（第一轮同一目标）。所有操作在 staging；**不碰 production**。

### 3.1 账号夹具（测试邮箱形状）

| 夹具 | 形状 | 用途 |
|---|---|---|
| A｜码门新号 | `tools+r2a20260911@belcort.com` | SIGNIN-A1／A5／A10／A12；主线 Creation 走查 |
| B｜Google 新号 | Founder 提供的一个 Google 测试账号（**文档里不写任何凭据**） | SIGNIN-A2／A14 |
| C｜合并号 | `tools+r2c20260911@belcort.com`，先码后 Google（须该邮箱同时是可用 Google 账号；否则 A3 只能做单向并如实标注） | SIGNIN-A3 |
| D｜大小写号 | `Tools+R2D20260911@Belcort.com` 与同名小写 | SIGNIN-A16 |
| E｜加号变体 | `tools+r2e001@…`、`…002`、`…003`（授权后才扩到 30） | SIGNIN-A17 |
| F｜第二租户 | 第一轮已有的另一个自有账号（复用，不新建） | PRODID-A9、FRONT-A6 跨租户不可见 |

规矩：凭据只由 Founder 自己输入或走查者在浏览器手动输入；**报告与 ledger 里一律不出现邮箱以外的任何凭据、token、签名媒体链接**。

### 3.2 逐条步骤

- **R2-01 码门**：无痕窗口 → `/login` → Continue with email（夹具 A）→ 收信 → ① 手输 6 位码；② 另一封邮件点 Log in 按钮，验证码已预填、按一次即进；③ 同一链接再点一次；④ 等 15 分钟再点。截图：登录页（无密码框）、邮件、进产品首屏。查表：`BetterAuthUser`、`AllowedEmail`（小写单行）、`Membership`、`CreditLedger`（`signup:<orgId>` 一笔）。
- **R2-02 Google 门**：无痕 → Continue with Google（夹具 B）→ 授权。再做三次失败：授权页取消、把该邮箱在后台撤销后再登、`SIGNUPS_PAUSED=1` 期间用陌生 Google（后者需授权改环境变量）。截图：每次失败都落在 `/login` 页内提示（不是 better-auth 错误页、不是裸 JSON）。
- **R2-03 合并**：夹具 C 先码登录 → 生成一张图 → 登出 → 同邮箱 Google 登录 → 确认看到那张图。查表：该邮箱在 `BetterAuthUser` 只有一行、`Organization`／`Membership` 只有一套、`BetterAuthAccount` 有 google 与码门两条来源但同一 userId。
- **R2-04 密码退役**：浏览器逐个访问 `/signup`、`/forgot-password`、`/reset-password`；再用 `curl -i` 对七个公网端点各打一次，记录状态码。截图：登录页全貌 + curl 输出。查表：`BetterAuthAccount where providerId='credential'` 计数 = 0。
- **R2-05 暂停／撤销／限流**：撤销走后台（对夹具 A）；限流用同一邮箱连点 6 次 Continue、再拿一个码连错 4 次。截图：第 6 次拒绝文案、第 4 次要求重发、撤销后两扇门的反应（须与输错码一模一样）。
- **R2-06 首登副作用**：夹具 A 与 B 各查一次：工作区名为空、赠金一笔、`emailVerified=true`、`AllowedEmail` active、登录审计各一行。A17 按授权规模执行（默认缩成 3 个 `+tag` 变体只验幂等键）。
- **R2-07 产品身份正路**：夹具 A → Brand 页新增产品（名字 / 主图 / 价格）→ 看 Library Products 出现同一张 → 画布 `@` 输入产品名 → 选入确认卡 → 出一次图。截图：Brand 表单、Library 卡、@ 菜单（来源标签 Product）、确认卡、成品谱系。查表：`BrandRecord.entityId` = `Entity.id`；生成谱系 `approvedEntities` 同一 id；`ChatMessage.referenceRefs` 存真实 id。反向再做一次 Library「新建元素 → 产品」（A3），再对 Otto 说一次「记下产品 X」并让理解提取一个不确认（A7）。
- **R2-08 双向编辑**：Library 改名 → Brand 页看；Brand 页换主图 → Library 看。再各做一次「与名字无关的操作」（只改价格、归档、撤销一次 Otto 改动），确认名字／封面不被写回旧值（R6／R9）。Library 元素页确认**没有**价格／卖点／分类入口（A5）。
- **R2-09 删除／恢复矩阵**：四格逐格做 —— ① Brand 删 → Library 消失；② Library 恢复 → Brand 回来；③ Library 删 → Brand 消失；④ Brand 恢复 → Library 回来。每格刷新后再确认。再做「删唯一一张照片」（R2，两面都变无封面、字节真删）与「删整件产品」（字节保留，登记）。查表：`Entity.deletedAt`、`BrandRecord.deletedAt`、`ReferenceImage`、`Asset`／存储对象是否还在。已生成的成片必须不动。
- **R2-10 隔离与账本**：夹具 F 登录，`@` 菜单与 Library 搜夹具 A 的产品名 → 找不到；再直接用 A 的 `entityId` 构造一次写入 → 被拒。建／改／删各一次后对比余额与 `CreditLedger` 行数（应零新增）。
- **R2-11 FL-03 官方演员 + 商品**：夹具 A → `@` 选官方演员 + `@` 选本轮生成的商品图 → 请求出片（5s / 720p / 无音频）→ 确认卡必须**同时**绑定演员 Entity 与商品 Generation、且**没有**合成首帧那一步 → 批准 → 等出片 → 播放。换第二个场景再来一次（CREATE-A10）。另备一张短边偏小的真实商品照验自动放大。截图：@ 双引用、确认卡、成片播放。查表：`GenJob`（一条，DONE）、引用字段、`CreditLedger`（一次 reserve、一次 settle、无残留 hold）。失败时：只退款一次、拒绝文案分岔正确。
- **R2-12 FL-04 编辑 / retry / 报价版本**：① 对上条成品做一次编辑（改背景）；② 让一次生成失败后点「Edit and retry」，确认文字**与引用 chip 都在**；③ 确认卡数量 1→2 期间抢提交旧报价 → 服务器拒绝并刷新。截图：retry 恢复态、旧报价被拒的提示。查表：`sentPromptText` 与批准稿逐字一致（CREATE-A12）。
- **R2-13 FL-05 Canvas / 历史 / 规划 / 余额广播**：拖节点、Fit to screen、便签、刷新；跑一次失败任务观察 Current turn 与 Conversation 是否**自动**转 Failed；跑一次纯规划轮（不生成不搜索）；两个标签页并排验余额广播（FSE-010）。截图：失败节点与 Current turn 同屏、两个标签页余额同屏。查表：`OttoTurnTrace.toolCalls` 为空、无新 `GenJob`。
- **R2-14 FL-06 Library / 上传 / 理解 / 导出**：真实新字节上传 → 看详情费用行是否为**含理解费的合计** → 搜索 / 排序 / 收藏 / collection 增删（FRONT-A5／A6）→「Use in canvas」（FRONT-A7）→ 下载（见 R2-18）。顺带复现 Profile 邮箱空白（fb:203）。
- **R2-15 variation**：对一张已有生成点 Create variations → 确认 → 等交付。**必须拿到可用产物**才算 A3 过；失败则记 FAIL 并附 provider 错误与退款回执。
- **R2-16 取消**：起一个耗时任务（视频或研究轮），找 Stop／取消入口。有：点一次，记账本口径与 hold 归零；无：如实记「无取消入口」并登记，不写成功能失败。
- **R2-17 cap 多入口与并发**：把 spend cap 设成 1 → 依次从 ① Library 动作、② 画布确认卡、③ Otto 主动提议、④ 分镜（若可达）各发起一次超额动作 → 每个入口都应明确拒绝、零新 GenJob、零新账本行。并发：两个标签页几乎同时提交同一超额动作，确认不出现越过 cap 的扣费。做完把 cap 恢复原值并查表确认。
- **R2-18 下载字节**：对一张图与一段视频各下载一次 → 本机 `ls -l` 看大小、`file` 看类型、视频用播放器打开（或 `ffprobe` 读时长）。记录字节数与校验方式；只记录文件事实，不外传媒体链接。
- **R2-19 刷新／Back／深链**：对画布、确认卡、Library 详情、Brand 页各做一次刷新与一次浏览器 Back；再用夹具 F 打开夹具 A 的画布深链 → 期望**诚实拒绝**（上轮是静默回退造新画布，须确认现状）。
- **R2-20 盯项①**：在真实对话里要求「用官方演员给我的商品拍一条片」，读 Otto 的计划文字：**不得**出现「先合成一张首帧再动画」这类两步提议。截图整段计划。
- **R2-21 盯项②**：开一条带接续（continuity）的分镜／续写，同时走直接出片路径，跑**一次真引擎**。记录：卡面步骤数、是否铸了多余的首帧子卡、扣费与卡面是否一致、成片里人物与商品是否都在。

### 3.3 查表清单（只读，统一口径）

`BetterAuthUser` / `BetterAuthAccount` / `AllowedEmail` / `Organization` / `Membership` / `CreditLedger` / `GenJob` / `Generation` / `Entity` / `BrandRecord` / `ReferenceImage` / `Asset` / `ChatMessage`（`referenceRefs`） / `OttoTurnTrace` / 画布节点表。

连库一律 `psql -h 127.0.0.1`（本机陷阱：走 socket 会连到另一个 Postgres）；staging 库连接串由 Founder 当次提供，**不落盘、不回显、不进报告**。只读：只跑 `SELECT` 与 `COUNT`，不 `UPDATE`／`DELETE`、不跑迁移。

### 3.4 截图规矩

文件名 `NN-短描述.png`，两位数递增，放本目录。每张记录真实视口尺寸；**视口小于 1440 宽的截图不得当桌面验收**（第一轮 1000px 教训）。涉及余额、账本、错误提示的判定，截图必须能同屏看到判定依据。

---

## 4. 预算与钱路记录表

**预算上限由 Founder 当次批准；未批准前，本轮真引擎调用数为 0。** 第一轮上限是 USD20（`preflight.md`），不自动延续到本轮。

每一次**花钱的**动作登记一行（不花钱的操作不必登记）：

| # | 时间(UTC) | 条目 | 动作 | 入口 | GenJob id | 报价(credits) | ledger reserve | ledger settle/refund | 供应商成本快照(USD) | 结果 | 证据 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | | |

小计口径（照第一轮，两个数不许混用）：

- **商家侧扣费**：`CreditLedger` 净变化 → displayed credits → 等值 USD（换算写 `packages/core` 的常量名，不写死数字）。
- **供应商成本快照**：应用侧记录的 `spentUsd`，**不是**供应商最终账单；失败 attempt 的成本单列。
- 退款不等于供应商账单为零。

**停手线**：累计商家侧扣费达到 Founder 批准额度的 80% 时暂停，向 Founder 报当前进度与剩余条目，由 Founder 决定加额或砍条目。达到 100% 立即停手，剩余条目标 `NOT RUN（预算耗尽）`。

**钱路不变量（每次花钱后必查）**：一次动作恰好一条 `reserve:<refId>`；成功恰好一条同额 `settle:<refId>`；失败恰好一条同额 `refund:`；任何时刻 `reserved` 回到 0；双击／并发只产生一条 job。

---

## 5. NO-GO 判据与 GO 结论模板

### 5.1 门槛 A1–A6 的来历

第一轮报告 [`report-round1.md` §21](../fullstack-staging-2026-09-08/report-round1.md)「核心质量关卡」四条与「安全与工程关卡」里落在本轮范围的两条，就是分诊时口称的门槛 A1–A6（#1307 评论把 variation 那条称作「上轮门槛 A3」，本表据此对齐编号）。第一轮正文本身没有把它们逐条编号，本表是**照 #1307 的用法补编号**，不是新造标准。

| 门槛 | 内容（照 report-round1.md §21） | 本轮判定条目 |
|---|---|---|
| A1 | 完整复测 FSE-001 至 007：正确商品/人物引用、确认材料、视频可接受输入、状态、修改、重试、Product 复用 | R2-07、R2-11、R2-12、R2-13 |
| A2 | 成功无人物视频基线保持不回归 | R2-12（编辑轮里带一次无人物视频基线） |
| A3 | variation 至少一次真实可用交付 | R2-15 |
| A4 | 付款前数量、规格、引用、能力解释一致；异步费用与余额可追踪 | R2-12（报价版本）、R2-13（余额广播）、R2-14（理解费合计） |
| A5 | 完整下载文件、cap 多入口/并发、取消语义、刷新/Back/深链恢复 | R2-16、R2-17、R2-18、R2-19 |
| A6 | Google callback 配置后复验；登录路径闭合（密码／找回随登录门退役） | R2-01～R2-06 |

### 5.2 NO-GO 判据（任一成立即 NO-GO）

1. A1–A6 任何一条**未通过**或**未执行**（NOT RUN／BLOCKED 都不是通过）。
2. 出现任何 P1：核心创作旅程不闭合，或付款前材料与实际执行不一致，或钱路不变量被破（多扣、少退、残留 hold、并发越过 cap）。
3. 租户隔离出现任何泄露（读到或写进另一个租户的对象）。
4. 登录门出现任何「进不去正确账号」或「进错账号」的情形，或密码面复活（`credential` 行数 ≠ 0 / 任一旧端点非 404）。
5. 走查所用的 staging 版本与被判定的施工票不对应（部署落后），使结论不可归因。

### 5.3 GO 结论模板（照抄进 `report-round2.md` 开头）

```
**GO · 本轮范围内的门槛 A1–A6 全部通过。**

版本：web/worker <commit>，同版；/api/ready ready=true、migrations=applied。
范围：#1309 必测面逐条已执行；留第三轮项目未执行、未判定。
门槛：A1 <结论/证据指针> · A2 … · A6 …
未关闭项：<逐条，含 NOT RUN 原因>
剩余风险：<逐条>
本结论只覆盖本轮已执行样本，不是全量 E2E 绿色、不是安全保证，也不授权 production 部署。
```

NO-GO 用同一形状，首行改 `**NO-GO · <一句话原因>**`，并列出触发的判据号。

**GO 不等于发版**：收版 v0.1.1 是 [#1331](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1331) 的事，由 Founder 拍板。

---

## 6. 发现编号规则与登记去向

- 本轮发现一律编 **FSE-2xx**，从 `FSE-201` 起顺序递增，**不复用**第一轮的 FSE-001–013；第一轮那批的复走结果写在对应 FSE-0xx 名下的「复测结论」里，不改号。
- 严重度沿用第一轮口径：**P1** = 阻塞受影响核心流程或付款确认可信度；**P2** = 可靠性／展示／辅助流程。严重度是工程分诊意见，不是已批准的改动范围。
- 每条 FSE-2xx 写满六格：复现、预期、实际、证据（截图 + job/ledger id + 代码指针）、根因置信度（**已确认** 与 **假说** 分开写）、建议与复测口径。
- **登记去向**（一条只进一处，写明去向）：

| 发现所属面 | 登记去向 |
|---|---|
| 登录门 | `docs/specs/sign-in.md` §5 变更登记 |
| 产品身份 | `docs/specs/brand-product-identity.md` §5（新登记编号接 `PRODID-R10` 往下排） |
| Creation / Otto 出片 | `docs/specs/creation-engine.md` §5 |
| 前端壳 / Library / Settings / 余额显示 | `docs/specs/frontend-baseline.md` §5 |
| 钱路不变量 | `docs/specs/money-engine.md` §5 |
| 不属于任何已冻结规格 | GitHub `idea` 标签票 / `docs/DEFERRED.md` / `polish` 标签（照 `.claude/CLAUDE.md` 里程碑制第 4 条三个柜子） |

- 规格 §5 **只追加登记行，不改历史行、不改 §0–§4**。登记 PR 是 docs-only。
- 第一轮已由 Founder 挂「待裁」的几条（存量无价签产品卡、两个删除方向不清扫字节、FSE-012／FSE-009 在冻结验收表无对应行）本轮只补现场证据，**不当场改口径**，留 S5。

---

## 7. 本计划的已知风险（必须让 Founder 看到）

1. **范围与预算冲突**：R2-11、R2-15、R2-21 都要跑真引擎，是本轮花钱的大头。若不批预算，A1／A3 必然 NOT RUN，结论只能是 NO-GO —— 那不是产品失败，是范围没跑完，报告要写清这个区别。
2. **SIGNIN-A6／A15／A17 需要动环境变量或人为制造失败**，超出「只走查」的范围。默认按「未授权即 NOT RUN」处理，不为凑满表去动 staging 配置。
3. **Google 门三条（A2／A13／A14）依赖 Founder 提供的 Google 测试账号**；A13（Google 报邮箱未验证）现实中可能造不出来，大概率只能 NOT RUN，不得写成通过。
4. **共享素材存储**（第一轮 ENV-01）若仍未隔离，本轮上传与生成会写进与 production 同一个桶，需要 Founder 对本轮再给一次明确豁免。

---

## 8. 产出清单

| 文件 | 内容 |
|---|---|
| `plan.md`（本文件） | 范围、判定口径、步骤、预算表、NO-GO 判据、编号规则 |
| `run-ledger.md` | 实际操作、时间、截图指针、当场观察（持续更新，非结论） |
| `backend-evidence.md` | 只读 DB／日志回执：版本、job、ledger、表计数 |
| `coverage-matrix.md` | 每条 R2-xx 与验收编号的 PASS / PARTIAL / FAIL / NOT RUN / BLOCKED |
| `findings-catalog.md` | FSE-2xx 逐条六格 |
| `report-round2.md` | 合成报告与 GO / NO-GO 结论 |
| `NN-*.png` | 带编号截图 |
