# 第二轮全栈 staging 走查报告（report-round2）— 2026-09-11

> 合成者 W3。素材来源：`plan.md`（判定口径，一字未改）、`run-ledger.md`（W1 现场）、`backend-evidence.md`（W2 只读取证）、`coverage-matrix.md`（逐条判定）、`findings-catalog.md`（FSE-2xx 六格）。
> 本文件只做合成与判定，不新增现场事实；每一句结论后面都指得到上面四份文件里的具体节号。
> 走查环境：staging `web-staging-7901.up.railway.app`，部署 commit `2a96750e`（web 与 worker 同版），UTC 2026-09-11 12:08–13:20。

---

## 结论（照 plan.md §5.3 模板）

**NO-GO · 六条门槛里只有 A3 通过：A1／A4／A5 是被真实缺陷挡下（含一条 P1 —— 付费前的图片尺寸闸在两个真实入口上根本没挂），A2／A6 是范围没跑完（无人物视频基线没有成功样本、Google 门一族缺夹具且 #1320 走查期间未上线）。**

**触发的判据（plan §5.2）**：
- **判据 1**（A1–A6 任一未通过或未执行）：A1 未通过、A2 未执行、A4 未通过、A5 未通过、A6 未执行完。
- **判据 2**（出现 P1）：**FSE-204** —— 付费前尺寸闸只挂在「video 卡 × `referenceGenerationIds`」一条路上，「图生图 base」与「视频起始帧」两个入口从未进过闸（根因已确认，`backend §3.3`）。

**未触发的判据（同样重要，请 Founder 一并看）**：
- 判据 3（租户泄露）**不成立** —— 读路零命中、深链无越权读（`backend §5.1`／`§5.2`）。
- 判据 4（进错账号／进不去／密码面复活）**不成立** —— `credential` 行数 0、`password` 全 NULL、七个旧端点全 404（`backend §2.2`、`ledger §R2-04`）。
- 判据 5（版本不对应）**不成立** —— 全程 `2a96750e`，web／worker 同版（`ledger §0 P0-1`，`backend §0` 复核）。
- **钱路不变量一条没破**：32 行账本、16 个 refId，违例扫描 **0 行**；收尾 `reserved = 0`（`backend §1`）。

**版本**：web／worker 同为 `2a96750e`；`/api/ready ready=true`、`migrations=applied`。**注意**：13:25:45Z（走查收工后）PR #1349 合并触发 `b30b7b6f` 部署，staging **已离开本轮版本**，下一轮必须重做 preflight（`backend §0`）。

**范围**：#1309 必测面 24 条已执行（`coverage-matrix` 46 行判定）；留第三轮的项目未执行、未判定。

**门槛逐条**：

| 门槛 | 结论 | 一句话依据（指针） |
|---|---|---|
| **A1** 复测 FSE-001–007 | **未通过（真实缺陷）** | 正路是通的（官方演员＋商品图两张参考**直接出片**、成片可播，`ledger §R2-11`／`backend §3.1`）；但尺寸闸两个入口都没拦（**FSE-204，P1**）、产品身份没进生成谱系（PRODID-A2 后半 FAIL，**FSE-210**）、分镜三格 BLOCKED |
| **A2** 无人物视频基线不回归 | **未执行** | 本轮**没有一条成功的无人物视频**：唯一成功的视频是带演员那条；无人物那条是 80px 起始帧的失败样本，不能当基线（`ledger §4` 第 5、12 行） |
| **A3** variation 至少一次真实交付 | **通过** | `Create variations` 真出图（JPEG 146,870 字节／1728×2304），账本一预扣一结算、无退款、hold 归 0（`ledger §R2-15`／`backend §3.5`） |
| **A4** 付款前材料一致＋费用可追踪 | **未通过（真实缺陷）** | 正面：四张确认卡报价与账本预扣**逐张零偏差**、逐字稿整串相等、理解费合计一行（`backend §3.5`、`ledger §R2-14`）；反面：同一个 Billing 页侧栏与正文**差 1 credit**（**FSE-202**）、`routeReason` 本轮 4 条 Generation **全为 NULL**（CREATE-A12 后半句不成立）、报价版本竞态（:170）NOT RUN |
| **A5** 下载／cap／取消／深链 | **未通过（真实缺陷 + 范围缺口）** | 跨租户深链被**静默换成新画布**且有一次写入（**FSE-207**）；cap 四个入口只做了两个、并发未做；产品面**无取消入口**；下载只证到字节层面（`ledger §R2-18/19/17/16`） |
| **A6** Google 门复验＋登录路径闭合 | **未执行完（范围缺口，非产品失败）** | 通过的部分很硬：密码面彻底退役（机器闭合）、暂停新注册全流程正确（陌生人**真的不寄码**）、大小写归一全表零非小写；未执行：Google 门 A2／A13／A14／A12 全 NOT RUN（缺陌生 Google 夹具 ＋ #1320／PR #1349 走查期间 OPEN）、A7／A15 NOT RUN、A8 有一条文案缺陷（**FSE-201**） |

**未关闭项**：见 §4「NOT RUN 与 BLOCKED 清单」（逐条带原因）。
**剩余风险**：见 §6。

> **本结论只覆盖本轮已执行样本，不是全量 E2E 绿色、不是安全保证，也不授权 production 部署。**
> **GO 不等于发版**，NO-GO 也不等于「产品坏了」：本轮 NO-GO 的五条里，**两条（A2／A6）是范围没跑完，三条（A1／A4／A5）才是真缺陷**。收版 v0.1.1 是 [#1331](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1331) 的事，由 Founder 拍板。

---

## 1. 产品失败 vs 范围没跑完（plan §7.1 要求分开写）

### 1.1 真实缺陷（产品要改的）

| 编号 | 一句话 | 严重度 | 根因状态 |
|---|---|---|---|
| **FSE-204** | 短边 80px 的参考图在「图生图 base」与「视频起始帧」两个入口**都没有在付费前被拦**；图生图成功并真扣 1 credit，视频一直走到供应商才失败且**失败文案不说原因** | **P1** | **已确认**（`backend §3.3`：闸函数体首两行 `kind==='video' ? referenceGenerationIds : []; if(length===0) return` ⇒ 两条路从未进闸） |
| FSE-210 | `@` 选入的**产品**没有进入生成谱系：USER 消息 payload 有 Entity id，确认卡 `entityIds=[]`、`GenJob.entityIds={}`、`approvedEntities=NULL` | P2（建议） | **已确认**（`backend §4.5`；对照同画布 @Xinyi 那轮三格齐全） |
| FSE-207 | 跨租户画布深链被**静默换成一张新画布**，无提示、有一次写入（**无泄漏**） | P2（口径待裁，见 §5） | 已确认（现象层）；`backend §5.2` 库侧逐格坐实 |
| FSE-202 | 同一个 Billing 页面上，侧栏余额与正文余额**差 1 credit**（`On hold` 错得更远） | P2 | **已确认**（`backend §6` 裁定：**侧栏是对的**，Billing 正文是陈旧值） |
| FSE-206 | 产品「归档」页面写着 `hidden from Otto`，`@` 菜单照样搜得到、选得中 | P2 | **已确认**（`backend §4.4`：Archive 全程只有 1 次 `entity.update`＝删除那次；`reference-search.ts` 查询根本不看归档位） |
| FSE-201 | 错码 4 次后码已作废，页面文案**一字不变**仍说「检查一下再试」 | P2 | **已确认**（`backend §2.7`：两把计数器都在，机器确已作废 ⇒ **纯文案缺陷**） |
| FSE-205 | 失败卡 `Edit and retry` 后 `retry-source` 那一行不出现 | P2 | **已确认**（`backend §7`：`liveRetryDraft` 写死 `sourceMessageId: null`；给了可证伪复现路 —— 先刷新再点应当出现） |
| FSE-203 | 理解费结算前，资产详情写 `Cost: no credits charged`（那笔钱随后一定会收） | P2（观察项） | 已确认 |
| FSE-209 | 登录审计 `ActionEvent.auth.signin` 的 `ownerId` **全库写死 `founder`**（26/26），别的租户查不到自己的登录记录（**无泄漏**，payload 只有邮箱） | P2（建议） | **已确认**（`backend §2.8`） |
| FSE-208 | 「先合成首帧再动画」在**无人物**镜头上仍被主动提议 | **待 Founder 裁**（暂记 P2） | 不适用 —— 这是口径问题，不是缺陷判定 |

### 1.2 范围没跑完（不是产品问题，别当缺陷读）

| 面 | 没跑完的 | 挡住的原因 |
|---|---|---|
| Google 门 | SIGNIN-A2／A13／A14／A12 | 本机只有一个已授权 Google 身份，**没有陌生 Google 夹具**（Founder 未提供夹具 B，禁止自建账号）；A12 另外还卡在 #1320／PR #1349 走查期间 OPEN |
| 登录门其余 | A7（后台撤销）、A15（建号中途失败）、A5 的 15 分钟过期、A10 的「赠金恰好一笔」、A17 的「第 51 个 + Sentry 告警」 | 需人为制造失败或批量开号（未授权）；赠金那条被**归一化幂等键**挡住（`+tag` 夹具算同一个收件箱 —— **这正是规格要的行为**）；Sentry 那半句**在 staging 根本不可验**（无 `SENTRY_DSN`，`backend §0`） |
| 无人物视频基线 | A2 整条 | 本轮预算与时间都花在带演员正路与尺寸闸上，无人物那次撞上 80px 样本失败、另一次被 cap 挡下 |
| 分镜挂图 | R2-24 ②③⑤ | **工具侧限制**：浏览器面板的合成鼠标点击**落不到弹层选项**上（四种方式都试过）。机器侧已证这三格**零写入、零账本行**（`backend §3.8`）—— 不是应用缺陷 |
| 判定截图 | 除登录页外的所有中间态 | **工具侧限制**：`screencapture` 无 Screen Recording 权限，整屏只有壁纸；改用无头 Chrome 渲染真实页面（1600×1000），**只能拍某个 URL 的首屏**，已登录页面的菜单／确认卡／错误提示拍不到。这些证据改用 **verbatim 页面文本**（见 §3） |

---

## 2. 逐条 R2-xx 结论表

> 判定值取 `coverage-matrix.md`（W2 回填后）。**「W3 纠正」列**记录本报告按 plan §2「一条只挂它真正证明的那一条，借号即 P1」做的改判（全部理由见 §3）。

| 条目 | 面 | 结论 | W3 纠正 | 核心依据 |
|---|---|---|---|---|
| R2-01 | 码门（A1／A5／A16） | A1 **PASS**、A16 **PASS**、A5 **PARTIAL**（15 分钟过期未测） | — | 截图 `01`／`02`；`backend §2.1／§2.3` |
| R2-02 | Google 门（A2／A13／A14） | **NOT RUN ×3** | — | 无陌生 Google 夹具 |
| R2-03 | 两扇门合并（A3／A12） | A3 **PASS**、A12 **NOT RUN** | A3 附注：本轮只走了码门那一次，Google 那一挂接是 09-10 既有事实 | `backend §2.4`（单 userId／单 org／单 membership） |
| R2-04 | 密码面退役（A4／A11 前半／A9 前半） | **PASS ×3** | — | 七端点 404（`ledger §R2-04` 原文）＋ `backend §2.2` |
| R2-05 | 暂停新注册／限流（A6／A7／A8） | A6 **PASS（码门半边）**、A8 **PARTIAL**、A7 **NOT RUN** | A6 记为「码门半边 PASS、Google 半边 NOT RUN」⇒ **整个编号不算通过** | 截图 `03`／`04`；Gmail 零结果；`backend §2.5` |
| R2-06 | 新号落库（A10／A17／A15）＋ FRONT-A2 | A10／A17 **PARTIAL**、A15 **NOT RUN**、FRONT-A2 **PASS** | — | `backend §2.6`（`signup_grant_claim` 那把键早被占住） |
| R2-07 | 产品身份正路 | A1 **PARTIAL**、**A2 FAIL（后半）**、A5 **PASS**、FRONT-A10 **PARTIAL**、A3／A7／R4 **NOT RUN** | — | `backend §4.1／§4.5／§3.1` |
| R2-08 | 产品编辑 | A4 **PARTIAL**（反向无入口）、A5 **PASS**、R6／R9 **NOT RUN** | — | `backend §4.1`（全库同名只有 1 行） |
| R2-09 | 产品删除 | A6 **PARTIAL**（③PASS、①无删除入口、②④无恢复入口）、R8／R2 **NOT RUN** | — | `backend §4.1`（两面同一个 `deletedAt`，成片一行不动） |
| R2-10 | 租户隔离 | A9 **PARTIAL**（读路 PASS、写路未执行）、A10 **PARTIAL** | — | `backend §5.1`（第二租户越界行 **0**） |
| **R2-11** | FSE-001 正路 | **PASS** ＋ CREATE-A10 **PARTIAL** | — | 两张参考直接出片、`sourceGenerationId=NULL` 机器证明无首帧（`backend §3.1`） |
| R2-12 | 编辑／retry／报价 | :163① **PASS**、:163② **PARTIAL**、CREATE-A1 **PARTIAL**、CREATE-A12 **PARTIAL**、:163③／:170 **NOT RUN** | CREATE-A12 后半句（`routeReason` 有值）**证否**，见 §5「未编号缺口」 | `backend §3.5／§7` |
| R2-13 | 终态同步／余额广播 | :164/:173 **PASS**、fb:202 **FAIL 一格**、CREATE-A11 相邻样本 **PASS** | — | **FSE-202**；`backend §6` |
| R2-14 | 理解费／Library | :169 **PASS**、FRONT-A5／A6／A7／fb:203 **NOT RUN** | — | `backend §1`（3 笔 `understanding:*` 逐条对上）；附 **FSE-203** |
| **R2-15** | variation 真实交付 | **PASS** | — | **本轮唯一完全通过的门槛（A3）** |
| R2-16 | 取消语义 | **PARTIAL（无取消入口）** | — | 三次长任务只有 `Check again` |
| R2-17 | cap 多入口／并发 | **PARTIAL** | — | 两个入口都**明确拒绝且零扣费**（`backend §3.7` 机器闭合）；另两入口＋并发未做 |
| R2-18 | 完整下载字节 | **PASS（字节层面）** | 附注：只证「服务器交付的字节完整可播」，**未证**点 `Download` 后本地落盘 | MP4 3,228,579 字节／JPEG 161,363、146,870 字节 |
| R2-19 | 刷新／深链／夹具面 | 刷新 **PASS**、深链 **FAIL**、FRONT-A12 **PARTIAL** | — | **FSE-207**；`backend §5.2` |
| R2-20 | 盯项①（不再提合成首帧） | ~~PASS（带演员）~~ → **PARTIAL** | **W3 改判**：登记行 :162④ 前半句是**全称**（「不再出现」），无人物那镜出现了反例 ⇒ 不能整条判 PASS | **FSE-208**（口径待 Founder 裁） |
| R2-21 | 接续＋直接出片同开 | **NOT RUN** | — | 时间（预算尚余 83%） |
| R2-22 | 盯项③（发不出「首帧＋演员」） | **PASS（机器闭合）** | — | `toolCalls=[]`、零卡零 GenJob 零账本行（`backend §3.6`） |
| **R2-23** | 尺寸闸唯一一份 | **FAIL** | — | **FSE-204（P1）**，根因已确认 |
| R2-24 | 分镜挂图 | ① **PASS**、②③⑤ **BLOCKED**、CREATE-A2 **PARTIAL** | — | BLOCKED 是工具侧；`backend §3.8` 证零写入 |

**计数（46 行）**：W1 走查后 PASS 14／PARTIAL 17／FAIL 4／NOT RUN 10／BLOCKED 1 → W2 取证后 PASS 19／PARTIAL 12／FAIL 5／NOT RUN 9／BLOCKED 1 → **W3 纠正后 PASS 18／PARTIAL 13／FAIL 5／NOT RUN 9／BLOCKED 1**（R2-20 由 PASS 改 PARTIAL）。

---

## 3. 每个 PASS 的证据落点（plan §3.4 要求截图；本轮有一处必须写明的偏差）

**偏差**：本目录只有 **4 张截图**，且全是**登录页**（无头 Chrome 只能拍未登录可达的 URL 首屏）。其余 PASS 的现场证据是 **verbatim 页面文本**（`get_page_text`／`read_page` 原文抄进 `run-ledger.md`）＋ 后端查表。这是**工具侧限制**，不是取证偷懒；哪一条缺图，下表逐条写明。

| PASS 条目 | 截图 | verbatim 现场 | 后端证据 |
|---|---|---|---|
| SIGNIN-A1 | 有 `01-login-page-no-password.png` | `ledger §R2-01①` | `backend §2.1` |
| SIGNIN-A5（前两段） | 有 `02-magic-link-code-prefilled.png` | `ledger §R2-01` | — |
| SIGNIN-A16 | **无**（中间态） | `ledger §SIGNIN-A16` | 有 `backend §2.3`（全表 `email <> lower(email)` 计数 0） |
| SIGNIN-A3 | **无** | `ledger §R2-02/03` | 有 `backend §2.4` |
| SIGNIN-A4／A11 前半／A9 前半 | 有 `01`（登录页无密码框） | `ledger §R2-04` 七端点原文 | 有 `backend §2.2` |
| SIGNIN-A6 | 有 `03-login-paused-banner.png` ＋ `04-login-banner-restored.png` | `ledger §R2-05`（Gmail 零结果） | 有 `backend §2.5`（暂停窗口零建号） |
| FRONT-A2（密码半段退役） | 有 `01` | `ledger §R2-06` | 有 `backend §2.2` |
| PRODID-A5 | **无** | `ledger §R2-08`（面板逐字只有 Remove／Close） | — |
| PRODID-A8（中间那句） | 不适用（商家面查不到） | — | 有 `backend §4.2`（null entityId＝0、零悬挂） |
| **R2-11 §5 :162（FSE-001 正路）** | **无**（确认卡中间态） | `ledger §R2-11` 确认卡＋Otto 逐字 | 有 `backend §3.1`（`sourceGenerationId=NULL`、账本一预扣一结算、worker 日志 try 1 即 DONE） |
| R2-12 :163① | **无** | `ledger §R2-12` 逐字提示 | — |
| R2-13 :164/:173 | **无** | `ledger §R2-13` | — |
| R2-13 CREATE-A11 相邻样本 | 不适用 | — | 有 `backend §3.6`（`toolCalls=[]`） |
| R2-14 :169 | **无** | `ledger §R2-14`（Billing 行逐字） | 有 `backend §1`（3 笔 `understanding:*`） |
| **R2-15 variation（门槛 A3）** | **无** | `ledger §R2-15` 弹窗逐字＋产物尺寸 | 有 `backend §3.5`（一预扣一结算、产物字节逐字相同） |
| R2-18 下载字节 | 不适用（字节校验） | `ledger §R2-18`（魔数、时长、分辨率） | 有 `backend §1`（Asset `sizeBytes` 与页面取数相同） |
| R2-19 刷新 | **无** | `ledger §R2-19` | — |
| R2-22 | **无** | `ledger §R2-22` | 有 `backend §3.6` |

**门槛 A3（唯一通过的那条）证据完整性自查**：无截图，但有**三重**互证 —— 商家面弹窗逐字＋产物可看（`ledger §R2-15`）、库里 Generation／Asset 字节与页面取数**逐字相同**、账本一预扣一结算无退款（`backend §3.5`）。**结论成立**。

**借号审查（plan §2「借号即 P1」）**：逐条核过 18 条 PASS，只有一条构成借号 —— **R2-20 的 :162④**（登记行前半句是全称「不再出现」，样本里出现了反例）。按规矩当场改判为 PARTIAL，不留在报告里当 PASS。另有两条**不构成借号但口径要写明**：R2-18（只覆盖字节，不覆盖本地落盘）、SIGNIN-A6（码门半边 PASS、Google 半边 NOT RUN，整个编号不算通过）。R2-11 的 :162 第三句（失败只退款一次、拒绝文案不再叫商家去 Library 挑演员）两半都有证据（`backend §1` 退款一次；`ledger §R2-23` 失败文案里没有那句旧话）—— **已核，不构成借号**；失败文案不说原因那一面由 FSE-204 承接。

---

## 4. NOT RUN 与 BLOCKED 清单（逐条带原因）

| 编号／登记行 | 状态 | 原因（照实写，不推定通过） |
|---|---|---|
| SIGNIN-A2、A14、A13 | NOT RUN | 无陌生 Google 夹具；A14 的取消授权／撤销在本机不可复原；A13 在 staging 造不出「Google 报邮箱未验证」的账号（plan §7.3 已预告） |
| SIGNIN-A12 | NOT RUN | #1320／PR #1349 走查期间全程 OPEN（13:20 重查仍 OPEN、`build.sha` 未变）＋ 无陌生 Google 夹具 |
| SIGNIN-A7 | NOT RUN | 后台 Revoke access 安排在收尾，时间不足；为不破坏第二租户未用夹具 A |
| SIGNIN-A15 | NOT RUN | 需人为制造建号中途失败（断库连接），未获授权也未执行 |
| SIGNIN-A5 末段（15 分钟过期） | 未测 | 窗口内 `ba_verification` 0 行（码用完即清），库里无痕可推定 ⇒ 维持未测 |
| SIGNIN-A10「赠金恰好一笔」 | 未测 | `+tag` 夹具被归一化幂等键判为同一收件箱（**这是 A17 要的正确行为**），本轮无法用它验 A10 |
| SIGNIN-A17「上限 50／第 51 个／Sentry 告警」 | 未测 | 批量开号未授权；且 **staging 无 `SENTRY_DSN`** ⇒ 告警半句在本环境根本不可验（`backend §0`） |
| PRODID-A3 | NOT RUN | Library 元素面板只有 Remove／Close，未找到「新建元素 → 产品」入口 |
| PRODID-A7 | NOT RUN | 时间 |
| PRODID-R4 | NOT RUN（**已证不可构造**） | `ownerId='founder'` 的 `BrandRecord kind='product'` 全表只有本轮建的那 1 行 ⇒ 库里确无存量样本（`backend §4.3`） |
| PRODID-R6／R9、R8、R2 ＋「两个删除方向不清扫封面字节」 | NOT RUN | 未构造对应冲突／该产品从未挂过封面图 |
| CREATE §5 2026-09-09（自动放大）、:176④ | NOT RUN | 没备到短边 100–300 档的真实商品照 |
| CREATE :163③、:170（FSE-012 竞态） | NOT RUN | 混合引用未构造；数量 1→2 竞态在工具限制下无法可靠构造 |
| FRONT-A5／A6／A7、fb:203（Profile 邮箱空白） | NOT RUN | 时间 |
| R2-21（:172⑥ 接续＋直接出片同开） | NOT RUN | 时间（**预算尚余 83%，不是钱的问题**） |
| **A2 无人物视频基线** | 未执行 | 本轮无成功的无人物视频样本（见 §1.2） |
| **R2-24 ②③⑤** | **BLOCKED** | 浏览器面板合成点击落不到弹层选项（四种方式均试过）；机器侧已证这三格零写入零账本行 —— **工具限制，不是应用缺陷** |
| PRODID-A9 写路、R2-24⑤ 跨租户写入 | 未执行 | 只有代码形状证据（`requireOwner()` → `loadCard(cardId, ownerId)` → `resolveOwnedReferenceRefs`），**不能替代真实越权尝试** |
| 供应商实际账单 | 不可得 | 只有应用侧 `spentUsd` 快照；Otto 对话轮**连 token 回执都没落库**（`backend §8-1`） |

---

## 5. FSE-2xx 汇总与登记去向（照 plan §6，一条只进一处）

| 编号 | 严重度 | 去向（plan §6） | 登记形态 |
|---|---|---|---|
| **FSE-204** | **P1** | `docs/specs/creation-engine.md` §5 | 变更登记行；建议按 Founder「修根不修表」收成**唯一一份闸**，四个入口（画布确认卡、Library 动作、Otto 主动、分镜挂图）逐个复测 |
| FSE-202 | P2 | `docs/specs/frontend-baseline.md` §5 | 接 fb:202（FSE-010）后面登记；**修哪一边已无歧义 —— 修 Billing 正文** |
| FSE-201 | P2 | `docs/specs/sign-in.md` §5 | 纯文案：第 4 次失败改一句点名要重发的人话 |
| FSE-209 | P2（W3 收录） | `docs/specs/sign-in.md` §5 | 审计租户归属错（无泄漏）；SIGNIN-A10 的「登录审计各恰好一行」行数对、归属错 |
| FSE-203 | P2（观察项） | `docs/specs/creation-engine.md` §5 | 补充观察，**不推翻 :169 的 PASS** |
| FSE-205 | P2 | `docs/specs/creation-engine.md` §5 | 根因链已闭合，带一条**可证伪复现路** |
| FSE-207 | P2（**口径待 Founder 裁：若「零写入」是硬口径则升 P1**） | `docs/specs/creation-engine.md` §5 | 深链解析失败改诚实拒绝页＋零写入 |
| FSE-206 | P2 | `docs/specs/brand-product-identity.md` §5（接 `PRODID-R10` 往下排） | 要么让归档真的隐藏，要么改掉 `hidden from Otto` 这句话 |
| FSE-210 | P2（W3 收录） | `docs/specs/brand-product-identity.md` §5（接 `PRODID-R10` 往下排） | PRODID-A2 后半的判定依据；**直接抵触 Founder「有迹可循」**，建议 Founder 看一眼定严重度 |
| FSE-208 | 待 Founder 裁（暂记 P2） | `docs/specs/creation-engine.md` §5 | **不是缺陷判定，是口径问题**：Founder 2026-09-08 那句「合成 first frame 的 idea 可以移除了」是只针对带演员，还是针对所有镜头 |

**没有一条落进「新 idea 票／polish」柜子**：本轮 10 条 FSE-2xx 全部落在四份已冻结规格的 §5 变更登记里（登记 PR 是 docs-only，只追加登记行、不改 §0–§4）。

**W3 的两处处置说明（编排者可推翻）**：

1. **FSE-209／FSE-210 收录**：W2 把这两条后端独有发现留给编排者裁。W3 判**收录**并已追加进 `findings-catalog.md`（六格素材全部出自 `backend §2.8`／`§4.5`，无新增现场事实），理由：不收录的话，PRODID-A2 的 FAIL 判定就没有挂号的地方，去向表会出现一条无编号的 FAIL。**若编排者／Founder 认为应留到 S5 再编号，删掉 catalog 末尾那一节即可，正文其余部分不受影响。**
2. **未编号缺口（W3 不自行编号，交 S5）**：`CREATE-A12` 的后半句「路由理由字段有值可读」**已被证否** —— 本轮 4 条 Generation 的 `routeReason` **全为 NULL**、`finalPromptText` 全空（`backend §3.5`）。这是一条有机器证据的验收缺口，但 W2 判 PARTIAL 时没有给它编号，W3 不越权补编，**提请 S5 决定是否编 FSE-211 并登记 `creation-engine.md` §5**。

**第一轮遗留**：FSE-001 的正路本轮**复测通过**（R2-11）；FSE-005／009／010 的复测结论分别落在 R2-13／R2-14／R2-13 三行；FSE-012 未复测（:170 NOT RUN）。按 plan §6，这些写在 FSE-0xx 名下的「复测结论」里，**不改第一轮编号**。

**plan 待改口径一条**（本轮不改，plan 一字未动）：plan §3.3 查表清单里 SIGNIN-A3 的「两条 provider 行」检查项**本身不成立** —— 码门根本不写 `ba_account` 行，全库该表只有 1 行 `google`（`backend §2.4`）。下一轮修订 plan 时改，或在 S5 记一笔。

---

## 6. 剩余风险

1. **尺寸闸只修了一半就复测会漏**：FSE-204 的根因是「闸挂在一条路上」，不是「闸写错了」。只在原处改条件、不把四个入口收到同一份闸上，下一轮还会再出现一次（Founder 令：修根不修表）。
2. **供应商侧成本无法证明为零**：失败那条视频的永久性输入错误（80×107）**被重投了 3 次**（`attempts=3`），商家侧 `spent=false`，但供应商是否产生成本**本轮无法证明**（`backend §8-2`）。「退款」不等于「供应商零账单」。
3. **staging 已换版**：本轮所有代码行号、闸的形状、失败分类只对 `2a96750e` 成立；`b30b7b6f` 上必须重验（`backend §8-7`）。
4. **跨租户写入侧从未真试过**：读路是闭合的，写路只有代码形状证据。第三轮的越权攻防矩阵必须真做。
5. **Google 门整族零覆盖**：A2／A12／A13／A14 连一次都没跑；登录门要上线，这块必须先有夹具。
6. **判定截图覆盖率低**：18 条 PASS 里只有 6 条挂得到截图。下一轮要么解决 Screen Recording 权限，要么换一台能截图的机器 —— verbatim 文本能撑住判定，但 Founder 走查时看不到画面。
7. **无人物视频基线（A2）没有样本**：这条是「不回归」的看门条，本轮空着，下一轮必须第一个跑。

---

## 7. 预算与钱路记录汇总（两个数不许混）

### 7.1 商家侧扣费（账本真值）

- **合计 33.2 displayed credits ＝ USD 3.32**（换算式 `USD = displayed × INTERNAL_PER_DISPLAY / CREDITS_PER_USD`，常量名见 `packages/core/src/spend.ts`）。
- 账本口径：窗口内 `sum(balanceDelta) = −332 internal`、`sum(reservedDelta) = 0`；与 W1 现场读数 `9,999,903.2 → 9,999,870.0` **逐字相符**（`backend §1`）。
- 占 Founder 批准额度（USD 20）的 **16.6%** —— 全程未接近 80% 停手线，**本轮的 NOT RUN 没有一条是钱不够造成的**。
- 三类构成：Otto 对话 8 轮 189 internal（18.9 displayed）／生成 5 条 140 internal（14.0）／自动理解 **3 笔** 3 internal（0.3）。
- **对 `run-ledger.md` §4 的两处事实修正**（W2 查表得出，本报告以修正后为准）：① 理解费是 **3 笔各 0.1**（三次上传各一笔），不是 1 笔，总额不变；② ledger 里当作 Generation id 记的三个 id 其实是 **CanvasNode id**，真 Generation id 见 `backend §3.1`。

### 7.2 供应商成本快照（`spentUsd`，应用侧记录，**不是**供应商账单）

- 四条成功 job 合计 **USD 0.4853821875**（seedream ×3 各 0.035 ＋ seedance-2-mini 视频 0.3803821875，`billedUnits=108900`）。
- 失败那条视频 `spentUsd = null` —— **`null` 不等于「已核对供应商零账单」**（重投 3 次，见 §6-2）。
- 理解侧只有 `priceInternalSnapshot`／token 数，**没有 USD 列**；Otto 对话轮**连 token 回执都没落库** ⇒ 不得用商家 credits 或型号默认单价冒充供应商成本。

### 7.3 钱路不变量（最硬的一组，逐条通过）

| 不变量 | 结果 |
|---|---|
| 一次动作恰好一条 `reserve:<refId>` | 通过 —— 16 个 refId，违例扫描 **0 行** |
| 成功恰好一条同额 `settle:` | 通过 —— 4 条成功 job 各一条 |
| 失败恰好一条同额 `refund:` | 通过 —— 失败视频只有 REFUND、**无 SETTLE**，退一次 |
| 任何时刻 `reserved` 回到 0 | 通过 —— 收尾 `CreditAccount.reserved = 0` |
| 双击／并发只产生一条 job | **未验** —— 本轮无现场双击；幂等键形状不等于并发验证 |
| 卡面报价＝账本预扣 | 通过 —— 四张卡逐张零偏差（1↔−10、11↔−110、1↔−10、11↔−110） |
| cap 拒绝＝零扣费 | 通过 —— 拒绝窗口内账本零行、13:00 之后零新 GenJob |

---

## 8. staging 配置改动与还原清单

| # | 对象 | 改动 | 还原 | 核对 |
|---|---|---|---|---|
| 1 | staging web 环境变量 `SIGNUPS_PAUSED`（**原值形状＝该键不存在**） | 12:22:17Z `set SIGNUPS_PAUSED=1`（触发重新部署，12:23:02 一度 502、12:23:11 恢复） | 12:25:57Z `delete SIGNUPS_PAUSED` → **删变量不自动重启容器**（横幅在删后 3 分钟仍在）→ 12:29:08Z `railway redeploy` 手动重放 | 已核 —— 12:30 `variables --json`：该键不存在、变量总数回到 **51**（与改动前一致）；横幅消失；`build.sha` 仍 `2a96750e`；截图 `04` 与改动前的 `01` 同尺寸同内容 |
| 2 | 商家设置 `Organization('founder').settings.spendCapCredits`（**不是环境变量**） | 13:08Z Billing → `Set a cap` → `1` → Save | 13:12Z 输入框改 `0` → `Remove cap` → **二次确认弹窗**里再按一次 | 已核 —— 服务端 `spendCapCredits = 0`、页面回到 `No cap set`（`backend §3.7` 库侧复核） |

**没有做过的事（逐条声明）**：未部署、未改 production 任何变量或数据、未跑迁移、未删任何素材、未 force-push、未合并 PR、未碰别的 worktree。production 只读了 `R2_BUCKET`／`STORAGE_DRIVER` 两格用于判 ENV-01，**零写入**。

**一条必须让 Founder 看到的操作偏差（W2 自报）**：探测 Postgres 服务名时用 `railway variables -s <name> --json | head -c 200` 试了几个名字，该命令把 staging 数据库连接串（含口令）**打到了终端**。它**没有**写进任何文件、没有进任何报告、没有外传；随后所有查询改用只在进程内解析的脚本。按「绝不打印连接串」的纪律这是一次违规。**是否轮换该凭据属外部边界，由 Founder 决定，agent 未执行也不会自行执行。**

---

## 9. 素材与账号清单（Founder 令：前缀 `r2-20260911-`、走完列清单、不删）

**环境边界更新（重要）**：第一轮的 **ENV-01「素材存储与 production 共享」本轮不成立** —— staging `R2_BUCKET=fikirtive-staging` 不等于 production `fikirtive-production`（`ledger §0 P0-3`）。Founder 本轮给的共享存储豁免因此用不上；清单照令仍然列出，**一件未删**。

| 类别 | 内容 |
|---|---|
| 上传（2 个文件 / 3 次上传） | `r2-20260911-upload-normal.jpg`（1200×1600，**上传两次**，两份都保留）、`r2-20260911-tiny-80px.jpg`（80×107） |
| 生成产物（未删） | 商品图、5s/720p 视频（MP4 3,228,579 字节）、variation 图（JPEG 146,870 字节）、白底编辑图（80px 参考那张）、一条失败的视频任务（无产物、未收费） |
| 新建账号 | `tools+r2a20260911@belcort.com`（夹具 A）、`tools+r2f20260911@belcort.com`（第二租户） |
| 只收过码、未建成账号 | `tools+r2rl20260911@belcort.com`（限流）、`tools+r2x20260911@belcort.com`、`tools+r2p20260911@belcort.com`（暂停期） |
| 本轮删除的对象 | 产品记录 `R2 Coral Tumbler RENAMED` —— **这是 PRODID-A6③ 的验收动作本身**，不是清理 |
| Google 门替身 | `E2E_GOOGLE_DOOR_STUB` **未设置** ⇒ Google 门的结论有效、不标 BLOCKED（只是没夹具跑） |

---

## 10. 下一轮开跑前必须先做的三件事

1. **重做 preflight 版本对齐**：staging 自 13:25:45Z 起在 `b30b7b6f`，且曾短暂 web／worker 不同版。本轮的 `2a96750e` 结论**不得**直接延用。
2. **先跑本轮欠的两条门槛**：A2（一条成功的**无人物**视频基线）、A6 的 Google 门一族（先向 Founder 要一个陌生 Google 夹具，否则永远 NOT RUN）。
3. **解决取证工具的两个硬限制**：Screen Recording 权限（否则中间态永远没图）、浏览器面板对弹层选项的点击（否则 R2-24 三格永远 BLOCKED）。

---

*产出文件清单见 `plan.md` §8。本报告由 W3 合成，未改 `plan.md`、`run-ledger.md`、`backend-evidence.md`、`coverage-matrix.md`；对 `findings-catalog.md` 的唯一改动是追加 FSE-209／FSE-210 两节（见 §5 处置说明 1）。*
