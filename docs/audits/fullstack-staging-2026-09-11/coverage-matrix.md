# Round 2 覆盖矩阵（coverage-matrix）

> 每个 `R2-xx` × 验收编号／登记行一行。判定值：**PASS／PARTIAL／FAIL／NOT RUN／BLOCKED**。
> 「需查表才能定」的一律先记 **PARTIAL（待后端取证）**，要查什么写在 `run-ledger.md` 对应段与本表「待查」列 —— 后端取证由 W2 写进 `backend-evidence.md`。
> 依据：`plan.md` §2 与 §3.5 对账表（§2 挂出的每个编号在本表都有一行）。走查者：W1。部署 `2a96750e`（web／worker 同版）。
> **2026-09-11 W2 回填**：带 ✅／❌ 的「待查」格已由后端只读取证替换成证据指针，出处一律 `backend-evidence.md` 的节号；标「改判」的行是 W2 依查表结果改的判定（只动状态与证据两列）。
> **2026-09-11 W3 第 3 轮**：三处判定**往下改**（`SIGNIN-A6`、`R2-11 §5 :162`、`R2-14 §5 :169`，全部 PASS → PARTIAL），「汇总计数」整节按 `count-verdicts.py` 重写；`SIGNIN-A5` 行引用的截图 `02-*` 因含六位一次性登录码已移除，改文字记录。
> **2026-09-11 W3 第 4 轮**：做了一次**逐 PASS 分句审计**（脚本 `audit-pass-rows.py`，逐行打印「编号／验收原文（逐字取自 `origin/main` 的规格）／`plan.md` 判定口径／本轮证据指针」），把「验收句只做了一半却整行 PASS」这一类一次清零：**三处再往下改**（`SIGNIN-A3`、`R2-13 §5 :164 / :173`、`R2-22 §5 :162 残留③`，全部 PASS → PARTIAL），另外 11 行 PASS 逐分句核过、边界写进行内。审计结论表见 `report-round2.md` §3。
> **2026-09-11 W3 第 5 轮**：跨厂判官（第 4 轮）再抓一条 —— `R2-06 §5 2026-09-10（FRONT-A2 退役）`那一行的第三分句「`?from=/create` 落点正确」**全目录只有一句断言、没有现场回执**（它指的 `R2-03` 那节根本没写这件事）⇒ 整行 **PASS 降 PARTIAL**；同时把 `PRODID-A5`「只缺截图」与这一类「缺主张」的口径对称写死（见该两行）。**第 5 轮当时 PASS 10 行**（第 6 轮又降一行，**现行 9 行**，见下一条）。
> **2026-09-11 W3 第 6 轮（收口轮）**：一处判定**往下改** —— `R2-18 §5 完整下载字节` 由 PASS 降 **PARTIAL**（plan.md:158 的主语是「下载得到的文件」，本轮从未落盘）；另修 `R2-23` 判定格的根因措辞、`PRODID-A5` 现场指针（`§R2-08`→`§R2-07`）、`FRONT-A2` 行的编号撞车与「302」措辞、演变表「每一条都是往下改」那句。
> **现行计数（全文唯一一套）**：**65 行判定 —— PASS 9／PARTIAL 29／FAIL 5／NOT RUN 22**。
> **本表是覆盖记录，不是 GO/NO-GO 结论**；结论由 `report-round2.md` 合成。

## Preflight

| 项 | 判定 | 证据 |
|---|---|---|
| P0-1 版本对齐 | PASS | ledger §0 P0-1：`build.sha=2a96750e`，web/worker 同 commitHash，`/api/ready ready=true migrations=applied`；**backend §0 复核：走查全程（12:08–13:20Z）确在 `2a96750e`；13:25:45Z（收工后）PR #1349 合并触发 `b30b7b6f` 新部署，worker 已换版、web 仍 `2a96750e` ⇒ 下一轮必须重做版本对齐** |
| P0-2 前置票 15 张 | PARTIAL | 14 张已合并并在 `2a96750e` 祖先链；**#1320／PR #1349（登录门⑤）走查期间全程 OPEN** → 相关条目 NOT RUN；backend §0：#1349 的合并部署发生在 **13:25:45Z**，晚于走查结束，本轮判定不受影响 |
| P0-3 环境边界 | PASS | staging 桶 `fikirtive-staging` ≠ production `fikirtive-production`（**第一轮 ENV-01 本轮不成立**）；`E2E_GOOGLE_DOOR_STUB` 未武装 → Google 门结论有效；`backup=missing` 照录；**backend §0 补一条：web 启动日志 `SENTRY_DSN is required in production but is not set` ⇒ staging 无 Sentry，A17 的告警半句在本环境不可验** |

## 登录门（`docs/specs/sign-in.md` §2）

| 条目 | 编号 | 判定 | 证据指针 | 待查（W2） |
|---|---|---|---|---|
| R2-01 | SIGNIN-A1 | **PASS** | ledger §R2-01①；截图 `01-login-page-no-password.png`；会话 `Cw7acC6L…`、`emailVerified=true`、`name=""` | ✅ backend §2.1：`ba_user` 1 行（`Cw7acC6L…`，`emailVerified=t`，`name` 空）、canonical `User` 1 行、`Organization`＋`Membership` 各 1 套（owner/active） |
| R2-01 | SIGNIN-A5 | **PARTIAL** | 预填＋一次即进 PASS（**截图已于第 3 轮移除**：原图完整显示六位一次性登录码；文字记录替代 —— 邮件链接打开登录页、六格已预填，码值已脱敏不留）；同链接第二次点 PASS（`Code not accepted`）；**15 分钟过期未测** | backend §8-6：`ba_verification` 窗口内 0 行（码用完即清），过期路径库里无痕可查 ⇒ 维持未测，不推定 |
| R2-01 | SIGNIN-A16 | **PARTIAL**（**W3 第 2 轮改判，撤销 W2 的 PASS**） | 混合大小写 `Tools+R2F20260911@Belcort.com` 登录 → 全程小写、建号成功（ledger §SIGNIN-A16）。**规格 `sign-in.md`:77 要求「两种大小写**各登录一次** → 同一个账号」；本轮只登了一次** ⇒ 「同一个账号」那半句**从未执行**，按 plan §2「一条只挂它真正证明的那一条，借号即 P1」不能整条判 PASS | ✅ backend §2.3：`AllowedEmail` 恰好 1 行全小写 active；`ba_user` 与 `AllowedEmail` **全表** `email <> lower(email)` 计数均为 **0** ⇒ **归一化在写入路径上生效、造第二行的风险已排除**（这半句成立）。❌ 未做：同邮箱换另一种大小写**再登一次**验同一 `userId`（backend §2.3 原话：「本轮只登了一次」）—— 快照里没有重复行**不能**替代那次没做的登录 |
| R2-02 | SIGNIN-A2 | **NOT RUN** | 无陌生 Google 账号（Founder 未提供夹具 B，禁止自建账号） | — |
| R2-02 | SIGNIN-A14 | **NOT RUN** | 三种失败 + state 族三次都需要 Google 门可反复操作；本机只有一个已授权 Google 身份，取消授权／撤销后无法复原 | — |
| R2-02 | SIGNIN-A13 | **NOT RUN** | staging 造不出「Google 报邮箱未验证」的账号（plan 已预告大概率如此） | — |
| R2-03 | SIGNIN-A3 | **PARTIAL**（**W3 第 4 轮改判，撤销 W2 的 PASS**） | **已做**：同一邮箱 `tools@belcort.com` 走了**一个方向**（先 Google 后码门）→ 同一 `userId=pZMe1PRZ…`、同一工作区（ledger §R2-02/03）。**未做**：规格 `sign-in.md`:64 与 plan §2.1 逐字都写着「**再反过来**」，那一次登录本轮一次没跑 —— plan:193 事先就写明「否则 A3 只能做单向并如实标注」，`backend §8-5` 也把「A3 的 Google 半边」列进不可推定清单 ⇒ 半条编号未执行，不能整条判 PASS | ✅ backend §2.4：`ba_user` 1 行、`Organization`／`Membership` 各 1 套；`ba_account` 该 userId 下 1 行 `google`（createdAt 09-10，晚于 ba_user 三个月 ⇒ 挂到既有账号）。**口径修正：码门不写 `ba_account` 行，全库该表只有这 1 行 ⇒ plan 的「两条 provider 行」检查项本身不成立，应改 plan** |
| R2-03 | SIGNIN-A12 | **NOT RUN** | PR #1349 未上线（13:20 重查仍 OPEN、sha 未变）＋ 无陌生 Google 夹具 | — |
| R2-04 | SIGNIN-A4 | **PASS** | 三地址各**跟随一次重定向落在 `/login`**（**跳转状态码未记** —— 回执只记了最终 200 与 `redirects=1`，见 `ledger §R2-04` 原文与该节下方第 6 轮更正）；七端点 GET/POST 全 404 | — |
| R2-04 | SIGNIN-A11（前半） | **PASS** | 登录页无密码框／无 Forgot password／无设密码入口 + 七端点 404 | — |
| R2-04 | SIGNIN-A9（前半） | **PASS**（改判，backend §2.2） | 商家面无任何密码入口 | ✅ backend §2.2：`ba_account where providerId='credential'` → **0**；`password is not null` → **0**；全库 providerId 直方图只有 `google=1` |
| R2-05 | SIGNIN-A6 | **PARTIAL**（**W3 第 3 轮改判，撤销「PASS（Google 半边 NOT RUN）」**） | 横幅逐字（截图 `03-login-paused-banner.png`）；陌生人**不寄码**（Gmail 零结果）、任意码被拒、零建号；老用户照进；还原后截图 `04-login-banner-restored.png`。**改判理由（第 3 轮）**：规格 `sign-in.md` SIGNIN-A6 要「陌生人**两扇门**都进不来」，Google 那半边本轮一次没跑 ⇒ 半条编号未执行，按 plan §2「一条只挂它真正证明的那一条」不能整条判 PASS；报告 §0／§2 早已写成「整个编号不算通过」，本表这一格与它对齐 | ✅ backend §2.5：暂停窗口 12:22:17Z–12:30:04Z 内新建 `ba_user` **0** 行、新建 `AllowedEmail` **0** 行 ⇒ 「不寄码、不建号」库侧独立闭合 |
| R2-05 | SIGNIN-A7 | **NOT RUN** | 后台 Revoke access 未执行（为不破坏第二租户，计划放收尾，时间不足） | — |
| R2-05 | SIGNIN-A8 | **PARTIAL** | 第 6 次 `Try again in an hour.` PASS；陌生 1304ms vs 老 1142ms、文案同形 PASS；**第 4 次那句不兑现 → FSE-201** | backend §2.7：`rate_limit_counter` 里 `signincode:addr|<邮箱>`＝5、`authmail:<邮箱>`＝5 两把独立计数器都在 ⇒ **FSE-201 是纯文案缺陷**（机器确已作废该码），不是限流机制缺失 |
| R2-06 | SIGNIN-A10 | **PARTIAL** | 工作区名为空 PASS、`emailVerified=true` PASS；**赠金一笔无法用 `+tag` 夹具验证**（归一化键判定同一收件箱已领，属 A17 正确行为） | backend §2.6／§2.8：`AllowedEmail` status=active ✅、工作区名空 ✅；两个新 org **零 `CreditLedger` 行**（赠金仍无法验，夹具归一化撞键）；登录审计**行数对**（窗口内 8 行、每次登录一行）但 **`ownerId` 全库写死 `founder`（26/26）⇒ 新发现 FSE-209（审计租户归属错：别的租户的登录事件**写进**了 founder 名下的行；**第 3 轮**按 plan §5.2 第 3 条字面记为判据 3 的写路触发，读路未取证）** |
| R2-06 | SIGNIN-A17 | **PARTIAL** | 反向正面证据：`tools+r2a…` 与 `tools+r2f…` 两个新号都**没有**拿到赠金（归一化后同一收件箱），说明幂等键按去 `+tag` 算 —— 与规格一致；**上限 50／第 51 个／Sentry 告警未测**（**理由更正**：批量开号已获 Founder #1330 第 4 条授权，未做是时间与取舍；Sentry 那半句另受 staging 无 `SENTRY_DSN` 所限，属环境不可验） | ✅ backend §2.6：`signup_grant_claim` 全表 4 行，`canonicalEmail='tools@belcort.com'` 那把键早在 **2026-09-08 05:49:25Z** 被 `org_cmts923…` 占住 ⇒ 归一化幂等键得到机器证据；告警半句另受限于 **staging 无 `SENTRY_DSN`**（backend §0） |
| R2-06 | SIGNIN-A15 | **NOT RUN** | 需人为制造建号中途失败（断库连接）。**理由更正（W3 第 2 轮）**：Founder 在 [#1330](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1330) 评论第 4 条已逐字授权「A15／A17 的人为失败注入亦授权」⇒ **本条未执行是时间与取舍，不是没有批准**。上一版写的「未获授权」不属实（**第 4 轮更正出处**：那句残留在 `backend-evidence.md:147`，**不在** `run-ledger.md`；已按 W2 惯例在该行下方追加更正行、原句不改） | — |

## 产品身份（`docs/specs/brand-product-identity.md`）

| 条目 | 编号／登记行 | 判定 | 证据指针 | 待查（W2） |
|---|---|---|---|---|
| R2-07 | PRODID-A1 | **PARTIAL** | Brand 新增 → Library Products 同一件出现（ledger §R2-07）。**注**：Brand 新增表单**没有主图一格**，主图是建完后 `Add image · from Library` | ✅ backend §4.1：`BrandRecord 01M287A4JK…` 的 `entityId` ＝ `Entity 01M287A4JC…`，两行相隔 6ms 同批建立 ⇒ 单一身份成立 |
| R2-07 | PRODID-A2 | **FAIL（后半）**（改判，backend §4.5） | `@` 菜单来源标签逐字 `Product`、可选入并进入生成（前半 PASS） | ❌ backend §4.5：那一轮 USER 消息 `payload.entityIds` **有**产品 Entity id，但确认卡 `entityIds=[]`、`GenJob.entityIds={}`、`approvedEntities=NULL` ⇒ **产品只以提示词文字上路，没有进入生成谱系**（对照同画布 @Xinyi 那轮三格齐全）。另：该消息 `referenceRefs` 为空（首页 composer `canvas.create-handoff` 那条路丢 typed ref）⇒ **FSE-210 候选** |
| R2-07 | PRODID-A3 | **NOT RUN** | Library「新建元素 → 产品」反向路未走（Library 元素面板只有 Remove/Close，未找到新建入口） | — |
| R2-07 | PRODID-A7 | **NOT RUN** | 「对 Otto 说记下产品 X」＋「理解提取不确认」两步未执行（时间） | — |
| R2-07 | PRODID-R4 | **NOT RUN（已证不可构造）** | 该工作区原本 `No products yet`，没有「存量无价签产品卡」可挑 | ✅ backend §4.3：`ownerId='founder'` 的 `BrandRecord kind='product'` 全表只有本轮建的那 1 行 ⇒ 库里确无存量样本，不是漏做 |
| R2-07 | FRONT-A10 | **PARTIAL** | 三类来源（生成结果／产品／官方演员）都在同一个 `@` 菜单、都来自服务器；官方演员可选入并被引擎逐字点名（`Xinyi (person)`）⇒ 非假条目 | ✅ backend §3.1：USER 消息 `referenceRefs = {official-avatar:01M265PRD5…, generation:01M287JD67…}` 两件都是真 id；该 Entity `type=CHARACTER`、`catalogKey=actor-v1-xinyi`、有 `baseAssetId`、**2 张未删 `ReferenceImage`** ⇒ 第三句机器闭合 |
| R2-08 | PRODID-A4 | **PARTIAL** | Brand 改名 → Library 同步、只有一行（PASS）；**Library 侧无改名／换主图入口**，反向未测 | ✅ backend §4.1：改名后全库 `name ilike '%R2 Coral Tumbler%'` 的 Entity **只有 1 行** ⇒ 没有造出第二个身份（Brand→Library 方向成立；反向仍 NOT RUN） |
| R2-08 | PRODID-A5 | **PASS（维持，第 5 轮写明证据形式缺口）** | Library 元素面板逐字只有 `Remove from Library` / `Close` —— 价格／卖点／分类三格入口一个都没有（`ledger §R2-07（run-ledger.md:239）` 逐字面板记录 —— **第 6 轮更正**：面板逐字记在 `§R2-07 产品身份正路`，不在 `§R2-08`）。**第 5 轮写明**：plan.md:269 这一行点名要**一张截图**，本轮**没有截图** —— 缺的是**证据形式**（工具侧限制：Screen Recording 权限缺失，无头 Chrome 只拍得到未登录可达的 URL 首屏，而元素面板要登录后才打得开），**主张本身有逐字现场**。**维持 PASS 的理由与口径对称**：本轮统一按「**缺主张 → 降判定；缺证据形式 → 维持判定但写死边界**」处理 —— `R2-22`（第 4 轮降）与 `R2-06 FRONT-A2`（第 5 轮降）缺的是**分句本身没跑／没取证**，本行缺的只是同一主张的第二种形式。另：规格后半句「这三项只在 Brand 页可改」不在 plan 本轮口径内，本行不替它背书 | — |
| R2-08 | PRODID-R6 / R9 | **NOT RUN** | 「只改价格／归档／换封面／撤销 Otto 改动后名字与封面不被写回」四条未逐条构造 | — |
| R2-09 | PRODID-A6 | **PARTIAL** | ③ Library 删 → Brand 消失 **PASS**（二次确认文案逐字已录）；成片不动 **PASS**；① Brand 无删除入口（只有 Archive）；②④ **无恢复入口** | ✅ backend §4.1：`Entity.deletedAt` 与 `BrandRecord.deletedAt` **是同一个时间戳 `13:14:48.608`**（一次软删盖住两面）；5 个 CanvasNode 与对应 Generation 的 `deletedAt` 全为 NULL ⇒ 成片一行不动 |
| R2-09 | PRODID-R8 | **NOT RUN** | 未构造「名字槽位被占」的冲突 | — |
| R2-09 | PRODID-R2 | **NOT RUN** | 产品从未挂过封面图，无「唯一一张照片」可删 | — |
| R2-09 | §5「两个删除方向不清扫封面字节」 | **NOT RUN** | 同上（无封面字节） | 删整件产品后 `ReferenceImage`／存储对象是否仍在 |
| R2-10 | PRODID-A9 | **PARTIAL** | 读路 **PASS**：第二租户在 Library／Elements／Brand 三面**零命中**租户 A 的任何字样；写路（构造 `entityId` 写入）未执行 | ✅ backend §5.1：第二租户全库足迹＝1 个自己的 Project、5 个播种 Entity、10 张演员图，**GenJob／Generation／CanvasNode／ChatMessage／BrandRecord／CreditLedger 全为 0**，指向租户 A 画布的非 founder 行 **0** ⇒ 读路闭合。写路只有代码形状证据（`ownerId` 收口），**维持 PARTIAL** |
| R2-10 | PRODID-A10 | **PARTIAL（改判：建／删两格已证）** | 「建／改／删各一次后余额与账本零新增」未单独取证（本轮同期有付费动作） | ✅ backend §4.1＋§1：建（12:33:06.638Z）与删（13:14:48.608Z）两个确切时刻 `CreditLedger` **零新增行**（最近两行在 12:35:33 与 13:15:34）；改名那一刻的时间戳被删除覆盖，无法单独定时 ⇒ 三格里两格成立 |
| — | PRODID-A8（中间那句） | **PASS**（改判，backend §4.2） | 商家面无法取证 | ✅ backend §4.2：live `kind='product'` 行 1 条，`entityId IS NULL` → **0**，且 LEFT JOIN `Entity` 悬挂计数 → **0**（第一轮那个租户的产品行现已带真实 `entityId`） |

## Creation（`docs/specs/creation-engine.md`）

| 条目 | 编号／登记行 | 判定 | 证据指针 | 待查（W2） |
|---|---|---|---|---|
| R2-11 | §5 :162（FSE-001 正路） | **PARTIAL**（**W3 第 3 轮改判**：第三句后半是空证，见下） | **前两句 PASS**：官方演员＋商品图两张参考**直接出片**；Otto 逐字 `no starting picture needed. One step!`；确认卡 `Uses 3 of your reference photos` + `Reference names sent to the engine: Xinyi (person). …`；成片可播（MP4 3,228,579 字节 / 720×1280 / 5.04s） | ✅ backend §3.1：`GenJob 01M287S820…` DONE／attempts 1；`entityIds={Xinyi}`、`approvedEntities=[{Xinyi,CHARACTER}]`、`videoOptions.referenceGenerationIds=[商品图]`、**`sourceGenerationId=NULL`（机器证明无首帧）**；卡面 `mediaReferences[0].role="reference"`；账本一 RESERVE(−110)一 SETTLE、hold 归 0；worker 日志 try 1 即 `DONE → 1 generations via byteplus`；产物 Asset 3,228,579 字节与页面取数逐字相同。**❌ 第三句后半未触发**：「拒绝文案按真实引用来源分岔」本轮**没有「带官方演员且失败」的样本**（唯一带演员那条是成功样本；那次失败用的是 80×107 商品照当起始帧，`run-ledger.md` §R2-23）⇒ 空证，不记 PASS（`report-round2.md` §3 已认，本表第 3 轮同步） |
| R2-11 | CREATE-A10 | **PARTIAL** | 第一场景不触发人脸拦截、引用在卡面可查；**第二场景未跑**（时间/预算取舍），跨场景同脸按规格归 Founder 判 | ✅ backend §3.1：引用**已落盘**（`referenceRefs` 两件真 id ＋ `approvedEntities` 带 Xinyi）；第二场景仍 NOT RUN ⇒ 维持 PARTIAL |
| R2-11 | §5 2026-09-09（自动放大） | **NOT RUN** | 未备 100–300 档的真实商品照 | — |
| R2-11 | §5 :176④ | **NOT RUN** | 同上（没有触发放大披露的样本） | — |
| R2-11 | §5 :176⑥ | **FAIL（根因已确认）** | 短边 80 的图在两个入口都**没有**出现任何拒绝文案（见 FSE-204） | ❌ backend §3.3：闸只挂「`payload.kind==='video'` × `referenceGenerationIds`」一条路（`reference-upscale-gate.ts` 函数体首两行早退）；图生图卡是 `kind='image'`、视频起始帧那张图在 `sourceGenerationId` ⇒ **两条路都从未进过闸**。`Asset.width=80/height=107` 早在 12:56:57Z 落库 ⇒ 不是「读不出尺寸」那一档 |
| R2-12 | §5 :163① | **PASS** | 非空输入框不被覆盖 + 逐字提示 `Kept what you're typing — that earlier message wasn't put back. Clear the box and press Edit and retry again.`；清空后再点真放回、提示自动消失 | — |
| R2-12 | §5 :163② | **PARTIAL（根因已定位）** | 全页查无 `[data-slot="retry-source"]`，见 FSE-205 | ✅ backend §7：链条闭合 —— `liveRetryDraft`(OttoChatStream.tsx:610-613) 把 `sourceMessageId` 写死 null，`richerTurnReferenceDraft`(turn-reference-draft.ts:239-241) 只比「有没有引用」⇒ 未刷新就重试时选中直播那份 ⇒ 那一行永不渲染（`retrySourceNote` 本身永不返回空串）。**可证伪复现路：先刷新再点 Edit and retry，应当出现** |
| R2-12 | §5 :163③ | **NOT RUN** | 未构造「有名字 + 无名件」混合引用 | — |
| R2-12 | §5 :170（FSE-012） | **NOT RUN** | 数量 1→2 的竞态提交在工具限制下无法可靠构造 | — |
| R2-12 | CREATE-A1 | **PARTIAL** | 每一次生成都先出确认卡、卡上有价、`No charge until you confirm`（variation 弹窗逐字）；「两条提交路前置报价数字相同」未对照 | ✅ backend §3.5：四张卡 `estimatedCredits` 与账本 RESERVE 逐张零偏差（1↔−10、11↔−110、1↔−10、11↔−110）⇒ 报价＝账本预扣（RESERVE）零偏差成立（实扣＝结算／退款见 report §7.3）；「两条提交路数字相同」仍未对照 |
| R2-12 | CREATE-A12 | **PARTIAL（逐字那半句 PASS）** | variation 弹窗把 `sentPromptText` 整句摊开；未按 Regenerate | ✅/❌ backend §3.5：两张卡 `structuredPrompt = sentPromptText` **整串相等**（608/608、1060/1060）；图生图那张卡的 477 字**原封不动出现在送出稿第 102 字起**（多出的 101 字是机器加的 `<Image_N>` 图位声明）⇒ 逐字一致成立。**但 `routeReason` 在本轮 4 条 Generation 上全为 NULL、`finalPromptText` 全空 ⇒ 「routeReason 有值」这一格不成立**；Regenerate 仍未按 |
| R2-13 | §5 :164 / :173（FSE-005） | **PARTIAL**（**W3 第 4 轮改判**） | **已做**：失败任务出现时节点与 Otto 行**同时自动**转 Failed（`That didn't finish / You weren't charged.`），无需手动刷新；成功任务同理。**未做**：plan §3.5 这一行的口径是两句，第二句「**合成后原商品节点仍在**」（:173 第二症状）本轮**无合成路样本**、一次没触发；:164 裁决口径里的「两入口 × 成功／失败／退款／断网四态」也只覆盖到成功与失败两态 ⇒ 不能整行判 PASS | 「合成后原商品节点消失」那一症状本轮无合成路样本 |
| R2-13 | §5 fb:202（FSE-010） | **FAIL 一格** | 侧栏广播通；**同屏正文余额不同步（差 1 credit）** → FSE-202 | ✅ backend §6：按账本累进还原，读数时刻库里真值＝**9,999,885.7**（reserved 10 internal＝1 credit）⇒ **侧栏是对的，Billing 正文 9,999,886.7 是陈旧值**；正文 `On hold 11 credits held` 错得更远（那 110 internal 早在 12:43:46 清掉）。修哪一边已无歧义：正文（含 On hold／Spend history）没订阅广播 |
| R2-13 | CREATE-A11 相邻样本 | **PASS**（改判，backend §3.6；**第 4 轮加标**：按 plan:154／:292 的注，本行只记「**纯规划样本**」，**不挂 `CREATE-A11` 本体** —— A11 正文判的是音频参考件数与总长的拒绝，本轮零音频样本） | 有两轮纯规划（问比例、劝退两步方案）**未产生任何 GenJob** | ✅ backend §3.6：`otto-stream:01M289QWH1…`（13:15:34 那轮）`toolCalls = []`、`steps=1`、零 GenJob、账本只有对话那一笔 ⇒ 干净样本一个（另一轮带 `propose`，不算纯规划） |
| R2-14 | §5 :169（FSE-009） | **PARTIAL**（**W3 第 3 轮改判**） | 结算**后** `Cost: 0.1 credits` 一行合计、不拆行 PASS；**但登记行原文含「不再写 `no credits charged`」，而 FSE-203 逐字记录了它在结算前确实出现过** ⇒ 该半句不成立，整行不能判 PASS；Billing 行 `Understanding — -0.1`。附时序观察 FSE-203 | ✅ backend §1／§3：`AssetUnderstanding` 3 行全 DONE、`priceInternalSnapshot=1`、`moneyRefId` 与账本 `understanding:*` 逐条对上。**修正 ledger §4：理解费是 3 笔各 0.1（共 0.3），不是 1 笔**（总额 33.2 不变） |
| R2-14 | FRONT-A5 | **NOT RUN** | 搜索／收藏／筛选未逐项执行（时间） | — |
| R2-14 | FRONT-A6 | **NOT RUN** | collection 增删未执行 | — |
| R2-14 | FRONT-A7 | **NOT RUN** | 「Use in canvas」未执行 | — |
| R2-14 | §5 fb:203（FSE-011 Profile 邮箱空白） | **NOT RUN** | 未打开 Profile 页复现 | — |
| R2-15 | §5 2026-09-10（variation 真实交付） | **PASS（商家可见）** | `Create variations` → `Cost: 1 credit. No charge until you confirm.` → 产出 `01M2882PXJX2DYTZNRTH4KD6ZZ`，JPEG 146,870 字节 / 1728×2304。**第 4 轮写明边界**：plan §3.5 这一行的口径是「拿到可用产物 ＋ 账本一次 reserve 一次 settle」，两句都满足；§5 登记行原文另有「**可下载**」一句，本轮 `Download` 按钮落盘受浏览器沙箱限制**未验**（与 R2-18 同一限制），该半句**不计入**本行 PASS | ✅ backend §3.5：`GenJob 01M2882NQZ…` 一 RESERVE 一 SETTLE、无 REFUND、hold 归 0；产物 `Generation 01M2883T98…`／Asset 146,870 字节 1728×2304 与页面取数逐字相同（注：ledger 里写的 `01M2882PXJ…` 是 **CanvasNode id**） |
| R2-16 | §5 取消语义 | **PARTIAL（无取消入口）** | 三次长任务渲染期间控件只有 `Check again`，无 Stop/Cancel | — |
| R2-17 | §5 cap 多入口与并发 | **PARTIAL** | 两个入口（Library 动作、画布确认卡）都**明确拒绝且零扣费**，文案逐字含所需与上限；Otto 主动／分镜两个入口与并发未做 | ✅ backend §3.7：13:06:13.798Z→13:15:34.390Z 之间账本**零行**、13:00:06 之后**零新 GenJob** ⇒ 被 cap 拦下＝零扣费机器闭合；`Organization('founder').settings.spendCapCredits = 0` ⇒ 还原已落库。两个入口＋并发仍未做 |
| R2-18 | §5 完整下载字节 | **PARTIAL**（**W3 第 6 轮改判**） | plan.md:158 这一行的口径主语是「**下载得到的文件**真实存在且字节可校验」，而本轮**从未落盘**过任何文件。**已做**：三个产物都在**页面内实拉字节**核过 —— MP4 3,228,579 字节（`ftypisom`，5.04s，720×1280）、JPEG 161,363 / 146,870 字节（`ff d8 ff e0`，1728×2304），magic 数、尺寸、时长逐项核过（`ledger §R2-18`），plan 要的「不是只触发了 download 事件」这一点满足。**未做**：点 `Download` 后**本地落盘**（浏览器面板沙箱禁止下载，工具侧限制）。按本表「**缺主张 → 降判定**」的自立口径（与 `R2-22`／`R2-06 FRONT-A2` 同一把尺）⇒ 整行由 PASS 降 **PARTIAL** | — |
| R2-19 | §5 :172④ | **FAIL（性质已澄清）** | 跨租户深链被**静默换成新画布**、无提示、有写入（无泄漏）→ FSE-207 | ✅ backend §5.2：租户 A 的 `Project.updatedAt = 12:35:31.204 ＝ createdAt`（深链 13:18 之后**零更新**）；访问者那边确实新建 `Project 01M289WJEE…`（ownerId＝租户 F、name `New canvas`、13:18:07.823Z）并留下 `ActionEvent project.create` ⇒ **无越权读、有一次归属正确的多余写入＋零告知**，不是隔离破口 |
| R2-19 | FRONT-A12 | **PARTIAL** | ①五个夹具地址**已登录**下全 404、未登录跟随重定向落在 `/login`（跳转状态码未记；PASS）；②六面夹具串**零命中**（PASS）；③「写入失败有反馈不假成功」**NOT RUN** | — |
| R2-20 | §5 :162④ | **PARTIAL**（W3 改判，原 PASS（带演员）） | 带演员镜头一步到位、明说要两步时被劝退；**无人物镜头仍提议两步** → FSE-208（口径待 Founder 裁） | — |
| R2-21 | §5 :172⑥（接续＋直接出片同开） | **NOT RUN** | 未跑（时间；预算尚余 83%） | — |
| R2-22 | §5 :162 残留③ | **PARTIAL**（**W3 第 4 轮改判**） | **已做**：产品面发不出「首帧＋演员」组合 —— Otto 逐字劝退、**零卡、零 GenJob、零生成账本行**；按 plan §1.1 不下供应商接受度结论。**未做／不成立**：plan §3.5 这一行的口径是三句 —— ②「**名额仍为 0**」本轮**没有取证**（`run-ledger.md` 原话是「留给 W2 或代码取证」，backend 未查）；③「零账本行」这句**全称不成立**，那一轮仍有对话那一笔 `settledInternal=22` internal ＝ 2.2 credits（第 2 轮只更正了措辞、判定没跟着改，第 4 轮补上） | ✅ backend §3.6：那一轮 `OttoTurnTrace.toolCalls = []`、无 GEN_CARD、无 GenJob、账本只有对话那一笔 ⇒ 「发不出这个组合」有机器证据 |
| R2-23 | §5 :162 残留① | **FAIL（现象）／根因已确认（`backend §3.3`）** | 80px 图在「图生图 base」与「视频 starting frame」两个入口都**未在付费前被拒**；图生图**成功并扣 1 credit**，视频走到供应商才失败（全额不收费、失败文案不说原因）→ FSE-204 | ✅ backend §3.2／§3.3／§3.4：① 本站生成图 `Asset.width/height` **有真值 1728×2304**（第一轮的 null 已修；视频资产仍 null）；② 闸只挂一条路，两个入口都绕过（根因见 §3.3）；③ 供应商原话 `expected the width to be at least 300px, but received a 80x107px image` **只活在日志里**，落库的 `GenJob.error` 是 `generation provider video submit failed (400)` ⇒ 失败文案不说原因的根因；④ **同一条永久性输入错误被重投 3 次**（attempts=3），商家 spent=false 但供应商侧成本本轮无法证明为零 |
| R2-24 | CREATE-A2 | **PARTIAL** | 「不直接出片的镜头」**根本没有 Add image 入口**（比写入即拒更早的 fail closed，PASS）；服务端点名拒绝与跨租户 `setShotReferences` **未测** | ✅ backend §3.8：窗口内 **`Shot` 表 0 行**、`GenJob.shotId` 全空 ⇒ 那几格确实**零写入零扣费**；⑤ 只有代码形状证据（`storyboard-actions.ts:144` 起：`requireOwner()` 取服务端 principal → `loadCard(cardId, ownerId)` → 新增 id 必过 `resolveOwnedReferenceRefs`），**不能替代真实越权尝试** |
| R2-24 | §5 :178 | **PARTIAL** | ① 草稿卡上 `Add image` 第一手就在（两个直接出片镜头都有）**PASS**；②③⑤ **BLOCKED**（浏览器面板合成点击落不到弹层选项，四种方式均试过） | ✅ backend §3.8：草稿卡尚未落成 `Shot` 行（窗口内该表 0 行），故 `Shot.promptDoc.referenceGenerationIds` 与 `GenJob.videoOptions.referenceGenerationIds` 本轮**没有现场值可查**；同时机器证明这三格**零写入、零生成账本行**（**W3 第 2 轮加限定**：铸分镜那轮的 Otto 对话费另计） ⇒ 维持 BLOCKED |

## 前端基线（`docs/specs/frontend-baseline.md`）

| 条目 | 编号／登记行 | 判定 | 证据指针 |
|---|---|---|---|
| R2-06 | §5 2026-09-10（FRONT-A2 密码半段退役） | **PARTIAL**（**W3 第 5 轮改判**） | plan.md:310 这一行的口径是三句：①七个公网 auth 端点 404 ②`credential` 计数 0 ③`?from=/create` 登录后落点正确（**第 6 轮把编号统一成这三句** —— 上一版「已做」与「未做」各有一个③，编号撞车）。**已做**：①七个公网 auth 端点 GET/POST 全 404 ②`BetterAuthAccount.providerId='credential'` 计数 0（`ledger §R2-04` 逐字 ＋ 截图 `01` ＋ `backend §2.2`；配套现场：三个地址各**跟随一次重定向落在 `/login`**（**跳转状态码未记**）、登录页无任何密码入口）。**未做／无回执**：③`?from=/create` 落点 —— `run-ledger.md`:149 只有「登录后落在 `/create`」这一句断言，它自称「见下条 R2-03 记录」，而 `§R2-02 / R2-03` 那一节**没有这件事的任何一句**，全目录也没有第二处现场（`/usr/bin/grep -rn 'from=/create' .` 只命中判定与引用）。**缺的是主张本身没有现场回执，不是证据形式不齐**（与本表 `PRODID-A5` 的「只缺截图」两回事，口径对照见下方说明）。后端那一半：`backend §2.2`（credential＝0、`password` 全 NULL）只撑住前两句，落点那句后端查不到、本轮无人补 |
| R2-19 | FRONT-A12 | 见上表 | — |
| R2-13 | §5 fb:202 | 见上表（FAIL 一格） | — |
| R2-14 | §5 fb:203 | 见上表（**NOT RUN**） | 与 Creation 表 `R2-14 §5 fb:203` **同一条**，不重复计数 |

## 汇总计数（本表 **65 行**判定 —— 2026-09-11 W3 第 6 轮重跑脚本，口径与脚本见下）

> **怎么数的（可复跑）**：本目录的 `count-verdicts.py` 逐行解析本文件的四张判定表。口径两条：Preflight 三行是前置检查、不计入；前端基线表里标「见上表」的三行是对上面两张表同一条的重复引用、不重复计数。
>
> ```
> $ /usr/bin/python3 count-verdicts.py
> 表           行数   PASS  PARTIAL  FAIL  NOT RUN
> 登录门         17      4        7     0        6
> 产品身份        16      2        6     1        7
> Creation    31      3       15     4        9
> 前端基线         1      0        1     0        0
> 合计          65      9       29     5       22
> ```

**现行计数（全文唯一一套）**：**65 行判定 —— PASS 9／PARTIAL 29／FAIL 5／NOT RUN 22**（2026-09-11 W3 第 6 轮重跑 `count-verdicts.py`）。

> **另一把尺子（第 4 轮新增，第 5 轮按判官 P1 修好）**：`audit-pass-rows.py` 逐行打印每个 PASS 行的「编号／验收原文（逐字取自 `origin/main` 的规格）／`plan.md` 判定口径／本轮证据指针」，供人逐分句核。第 4 轮跑出 14 行、人工判完降 3 行；第 5 轮再降 1 行（`FRONT-A2` 退役行），第 5 轮当时重跑是 **10 行**；第 6 轮再降 1 行（`R2-18`），现在重跑是 **9 行**。
>
> **第 5 轮修了脚本本身的三处漏看**（判官 P1）：①验收原文原先被**静默**截到 1200 字符 → 现在不截，真要截会打出`…[截断：原文共 N 字符]`；②无编号／无登记行的行（`R2-15 variation`、`R2-18 完整下载字节`）原先在 `plan.md` 里配不到口径、那一栏一片空白 → 现在回退按 `R2-xx` 条目号匹配并标明是回退；③矩阵每行**最后一列**（「待查（W2）」／后端证据）原先根本没打印 → 现在判定列之后每一列都打。取消截断后还暴露出一个老毛病：编号是裸子串匹配，`SIGNIN-A1` 会吃掉 `SIGNIN-A10..A17`，一并按数字边界修好。

**逐表点数（任何人都能自己数一遍，或直接跑上面的脚本）**

| 表 | 行范围 | 行数 | PASS | PARTIAL | FAIL | NOT RUN |
|---|---|---:|---:|---:|---:|---:|
| 登录门 | 本文件「登录门」表全部数据行 | 17 | 4 | 7 | 0 | 6 |
| 产品身份 | 同上「产品身份」表 | 16 | 2 | 6 | 1 | 7 |
| Creation | 同上「Creation」表 | 31 | 3 | 15 | 4 | 9 |
| 前端基线 | 表里 4 行，**只有 `FRONT-A2` 是新判定**（第 5 轮已由 PASS 降 **PARTIAL**）；`FRONT-A12`／`fb:202`／`fb:203` 三行是对上面两张表同一条的重复引用，已标「见上表」，**不重复计数** | 1 | 0 | 1 | 0 | 0 |
| **合计** | | **65** | **9** | **29** | **5** | **22** |

**四个阶段的演变（同一套 65 行基线，各列可直接相减）**

| 判定 | v1 W1 走查后 | v2 W2 取证 ＋ W3 第 2 轮修订后 | v3 W3 第 3 轮修订后 | v4 W3 第 4 轮逐 PASS 审计后 | v5 W3 第 5 轮 | **v6 W3 第 6 轮（现行）** | v5 → v6 |
|---|---:|---:|---:|---:|---:|---:|---:|
| PASS | 14 | 17 | 14 | 11 | 10 | **9** | −1 |
| PARTIAL | 24 | 21 | 24 | 27 | 28 | **29** | +1 |
| FAIL | 4 | 5 | 5 | 5 | 5 | **5** | 0 |
| NOT RUN | 23 | 22 | 22 | 22 | 22 | **22** | 0 |
| 合计 | 65 | 65 | 65 | 65 | 65 | **65** | — |

> **往上改只有 v1→v2 那一次（第 6 轮更正措辞）**：那一次是 **W2 回填后端取证**把三行由 PARTIAL 抬到 PASS —— `SIGNIN-A9`（前半，`backend §2.2`）、`PRODID-A8`（中间那句，`backend §4.2`）、`CREATE-A11 相邻样本`（`backend §3.6`）；同一次还把 `PRODID-A2` 后半由 NOT RUN 改成 **FAIL**（往下）。**v2 之后每一轮都只往下改**（PASS → PARTIAL），没有一条往上凑：v2→v3 是 `SIGNIN-A6`、`R2-11 §5 :162`、`R2-14 §5 :169`；v3→v4 是 `SIGNIN-A3`、`R2-13 §5 :164 / :173`、`R2-22 §5 :162 残留③`；v4→v5 是 `R2-06 §5 2026-09-10（FRONT-A2 退役）`；v5→v6 是 `R2-18 §5 完整下载字节`。上一版这句写成「四轮修订每一条都是往下改」，与本表 v1→v2 那一列自相矛盾。明细见下表。
> **注**：`46 行` 是 v1／v2 一度写错的数（少数了 19 行），第 2 轮已更正为 65 行；上表三列都按 65 行基线重述，不再出现 46 这个数。

**BLOCKED 怎么算**：`R2-24 §5 :178` 那一行的**整行判定是 PARTIAL**（①PASS、②③⑤ BLOCKED），BLOCKED 是这一行**里面的三格**，不是独立的第 66 行。上一版把它单列成「BLOCKED 1」是把行与格混在一起数了，现已并回 PARTIAL。工具侧 BLOCKED 的事实本身没变（说明见该行证据格与 `report-round2.md` §1.2）。

**W3 第 6 轮的一处改判（收口轮，仍是往下改）**

| 条目 | 改前 | 改后 | 分句依据 |
|---|---|---|---|
| `R2-18 §5 完整下载字节` | PASS（字节层面） | **PARTIAL** | plan.md:158 口径主语是「**下载得到的文件**真实存在且字节可校验（大小、格式、可播放／可打开）」。**已做**：页面内实拉字节，magic／尺寸／时长逐项核过（`ledger §R2-18`）；**未做**：本地落盘（沙箱禁止下载）。按第 5 轮自立的「缺主张 → 降判定」口径，主语没兑现 ⇒ 降 PARTIAL |

**W3 第 5 轮的一处改判（判官 P2，仍是往下改）**

| 条目 | 改前 | 改后 | 分句依据 |
|---|---|---|---|
| `R2-06 §5 2026-09-10（FRONT-A2 退役）` | PASS（三句都算做过） | **PARTIAL** | plan.md:310 口径三句：①七端点 404 ②credential 计数 0 ③`?from=/create` 落点正确。①②有逐字回执；③**全目录只有 `run-ledger.md`:149 一句断言**，那句自称「见下条 R2-03 记录」而 `§R2-02 / R2-03` 那节根本没写这件事，也没有别处现场 ⇒ 第三句按「无现场回执」办 |

**判定与证据的两类缺口，本轮把口径写死（判官 P3 要的对称）**

| 缺什么 | 怎么处理 | 本目录的例子 |
|---|---|---|
| **缺主张**：某个分句本轮**没跑／没取证／全称不成立**（含**主语没兑现**：验收句说的是「下载得到的文件」，而本轮只在页面内实拉字节、从未落盘） | **整行降 PARTIAL**，证据格写清「已做／未做」 | `R2-18 §5 完整下载字节`（第 6 轮降）、`R2-22`（「名额仍为 0」未取证，第 4 轮降）、`R2-06 FRONT-A2`（`?from=/create` 落点无现场，第 5 轮降） |
| **缺证据形式**：主张有逐字现场，只是 plan 另点名的那**一种形式**（截图）本轮拿不到 | **维持判定**，但在行内与 `report-round2.md` §3 写明缺哪一种形式、为什么拿不到 | `PRODID-A5`（面板逐字在 `ledger §R2-07（run-ledger.md:239）`，缺的是 plan.md:269 点名的那张截图；工具侧限制见 `report-round2.md` §3 偏差段） |

**W3 第 4 轮的三处改判（逐 PASS 分句审计的结果，全部往下改）**

| 条目 | 改前 | 改后 | 分句依据 |
|---|---|---|---|
| `SIGNIN-A3` | PASS（W2 改判） | **PARTIAL** | 规格 `sign-in.md`:64「先用码登录过的邮箱，改用同邮箱的 Google 登录；**再反过来**」＝两次登录；本轮只走了一个方向（plan:193 事先写明「否则 A3 只能做单向并如实标注」） |
| `R2-13 §5 :164 / :173` | PASS（本轮样本） | **PARTIAL** | plan §3.5 口径两句：第二句「合成后原商品节点仍在」本轮**无合成路样本**；:164 裁决的「两入口×四态」也只覆盖两态 |
| `R2-22 §5 :162 残留③` | PASS（机器闭合） | **PARTIAL** | plan §3.5 口径三句：「名额仍为 0」未取证；「零账本行」因对话那笔 2.2 credits 全称不成立（第 2 轮已更正事实、判定没跟着改） |

**另有三行 PASS 维持不变但写明了边界**（不是降级，是把口径写死，防止下一轮被读成整条通过）：`PRODID-A5`（plan.md:269 还点名要一张截图，本轮无 —— **第 5 轮补注：缺的是证据形式不是主张，按上表口径维持 PASS**）、`R2-13 CREATE-A11 相邻样本`（按 plan 的注只记「纯规划样本」，不挂 A11 本体）、`R2-15 variation`（§5 登记行的「可下载」那半句未验，不计入本行）。

**W3 第 3 轮的三处改判（都是往下改，不是往上凑）**

| 条目 | 改前 | 改后 | 理由 |
|---|---|---|---|
| `SIGNIN-A6` | PASS（Google 半边 NOT RUN） | **PARTIAL** | 规格要「陌生人**两扇门**都进不来」，Google 那半边一次没跑；报告 §0／§2 早就写「整个编号不算通过」，本表这一格此前与它不一致（判官发现，W3 复核成立） |
| `R2-11 §5 :162` | PASS（整行） | **PARTIAL** | 第三句后半「拒绝文案按真实引用来源分岔」本轮**没有「带官方演员且失败」的样本** ⇒ 空证；前两句仍 PASS（报告 §3 早已认，本表第 3 轮同步） |
| `R2-14 §5 :169` | PASS | **PARTIAL** | 登记行原文含「不再写 `no credits charged`」，FSE-203 逐字记录了它在结算前确实出现过 ⇒ 该半句不成立 |

**W3 第 2 轮的两处改判（都是往下改）**

| 条目 | 改前 | 改后 | 理由 |
|---|---|---|---|
| `SIGNIN-A16` | PASS（W2 改判） | **PARTIAL** | 规格要求两种大小写各登一次；本轮只登了一次 ⇒ 「同一个账号」那半句从未执行（判官发现，W3 复核成立） |
| `R2-20 §5 :162④` | PASS（带演员） | **PARTIAL** | 登记行前半句是全称「不再出现」，无人物那镜出现反例（W3 第 1 轮已改判，本表同步） |

**W2 改判明细（7 条）**

| 条目 | W1 | W2 | 依据 |
|---|---|---|---|
| SIGNIN-A16 | PARTIAL | ~~PASS~~ → **W3 撤回，改回 PARTIAL** | backend §2.3 只证「没造出第二行」；规格要的「两种大小写各登一次 → 同一个账号」本轮只登了一次 |
| SIGNIN-A3 | PARTIAL | **PASS** | backend §2.4 单 userId／单 org／单 membership（并修正 plan 的「两条 provider 行」口径） |
| SIGNIN-A9（前半） | PARTIAL | **PASS** | backend §2.2 credential＝0、password 全 NULL |
| PRODID-A8（中间那句） | PARTIAL | **PASS** | backend §4.2 null entityId＝0、零悬挂 |
| CREATE-A11 相邻样本 | PARTIAL | **PASS** | backend §3.6 `toolCalls=[]` 干净样本 |
| PRODID-A10 | NOT RUN | **PARTIAL** | backend §4.1＋§1 建／删两个时刻账本零新增 |
| **PRODID-A2** | PARTIAL | **FAIL（后半）** | backend §4.5 产品 id 没进卡面与谱系 ⇒ FSE-210 候选 |

**W2 新增的两条后端独有发现（W3 判：收录，已进 `findings-catalog.md`）**

| 候选编号 | 一句话 | 出处 |
|---|---|---|
| **FSE-209** | 登录审计 `ActionEvent.auth.signin` 的 `ownerId` **全库写死 `founder`**（26/26）：别的租户的登录事件**被写进了 founder 名下的行**，别的租户自己查不到。payload 逐字只有 `{"email": …}`。**第 3 轮口径**：按 plan §5.2 第 3 条字面「读到**或写进**另一个租户的对象」，这条属**写路触发**；读路本轮从未取证，只能说「未发现读到别租户内容的暴露面」，不能说没有 | backend §2.8 |
| **FSE-210** | `@` 选入的**产品**没有进入生成谱系：消息 payload 有 Entity id，确认卡与 `GenJob` 的 `entityIds`／`approvedEntities` 却是空的（演员那条路三格齐全） | backend §4.5 |
| **FSE-211**（W3 第 2 轮补编号） | `CREATE-A12` 后半句「路由理由字段有值可读」不成立：本轮 4 条 Generation 的 `routeReason` 全 `NULL`、`finalPromptText` 全空（前半句逐字一致那半句**成立**） | backend §3.5 |

**W2 对 `run-ledger.md` 的两处事实修正**（不改 ledger 文件本身）

1. 理解费是 **3 笔各 0.1（共 0.3 displayed）**，不是 1 笔（三次上传各一笔）；商家侧总额 **33.2 displayed ＝ USD 3.32 不变**，账本净额 `−332 internal` 与 W1 现场数字逐字相符。
2. ledger 里当作 Generation id 记的 `01M287HQC2P1E33C6CDKJXJV04`／`01M287S996PCX2FEGWHTDGJP95`／`01M2882PXJX2DYTZNRTH4KD6ZZ` 其实是 **CanvasNode id**；真正的 Generation id 见 backend §3.1。

**提醒**：plan §5.2 第 1 条写明「A1–A6 任何一条未通过**或未执行**（NOT RUN／BLOCKED 都不是通过）」即触发 NO-GO 判据。本表只给覆盖事实，结论留 `report-round2.md`。
