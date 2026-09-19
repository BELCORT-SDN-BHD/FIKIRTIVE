# 第三轮全栈走查覆盖矩阵（范围已批准，执行待回填）

本轮基线为主干 `14bcd038`；staging web／worker 已核同版，worker-compute 版本未核，详情见 [preflight.md](preflight.md)。本轮结果逐行按实际分句回填；历史报告与已有自动测试不能替代本轮执行回执。

## 第二轮 65 行逐条继承

每行保留旧条目与旧编号，验收原文及分句边界由来源行、旧 plan.md §2 与当前已批准规格共同核对；旧行只验半句的，本轮应补齐当前规格全句，不能沿用半句 PASS。

| 本轮行 | 面 | 旧条目 | 验收编号／登记行 | 第二轮来源 | 本轮判定 | 本轮证据／缺口 |
|---|---|---|---|---|---|---|
| BASE-01 | 登录门 | R2-01 | SIGNIN-A1 | [原矩阵:26](../fullstack-staging-2026-09-11/coverage-matrix.md#L26) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-02 | 登录门 | R2-01 | SIGNIN-A5 | [原矩阵:27](../fullstack-staging-2026-09-11/coverage-matrix.md#L27) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-03 | 登录门 | R2-01 | SIGNIN-A16 | [原矩阵:28](../fullstack-staging-2026-09-11/coverage-matrix.md#L28) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-04 | 登录门 | R2-02 | SIGNIN-A2 | [原矩阵:29](../fullstack-staging-2026-09-11/coverage-matrix.md#L29) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-05 | 登录门 | R2-02 | SIGNIN-A14 | [原矩阵:30](../fullstack-staging-2026-09-11/coverage-matrix.md#L30) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-06 | 登录门 | R2-02 | SIGNIN-A13 | [原矩阵:31](../fullstack-staging-2026-09-11/coverage-matrix.md#L31) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-07 | 登录门 | R2-03 | SIGNIN-A3 | [原矩阵:32](../fullstack-staging-2026-09-11/coverage-matrix.md#L32) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-08 | 登录门 | R2-03 | SIGNIN-A12 | [原矩阵:33](../fullstack-staging-2026-09-11/coverage-matrix.md#L33) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-09 | 登录门 | R2-04 | SIGNIN-A4 | [原矩阵:34](../fullstack-staging-2026-09-11/coverage-matrix.md#L34) | PARTIAL | http-boundary-checks.md：/signup GET308到/login、退役reset-password子路径GET404；没有覆盖三旧页面、七端点全部方法及登录页完整无密码观察。 |
| BASE-10 | 登录门 | R2-04 | SIGNIN-A11（前半） | [原矩阵:35](../fullstack-staging-2026-09-11/coverage-matrix.md#L35) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-11 | 登录门 | R2-04 | SIGNIN-A9（前半） | [原矩阵:36](../fullstack-staging-2026-09-11/coverage-matrix.md#L36) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-12 | 登录门 | R2-05 | SIGNIN-A6 | [原矩阵:37](../fullstack-staging-2026-09-11/coverage-matrix.md#L37) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-13 | 登录门 | R2-05 | SIGNIN-A7 | [原矩阵:38](../fullstack-staging-2026-09-11/coverage-matrix.md#L38) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-14 | 登录门 | R2-05 | SIGNIN-A8 | [原矩阵:39](../fullstack-staging-2026-09-11/coverage-matrix.md#L39) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-15 | 登录门 | R2-06 | SIGNIN-A10 | [原矩阵:40](../fullstack-staging-2026-09-11/coverage-matrix.md#L40) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-16 | 登录门 | R2-06 | SIGNIN-A17 | [原矩阵:41](../fullstack-staging-2026-09-11/coverage-matrix.md#L41) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-17 | 登录门 | R2-06 | SIGNIN-A15 | [原矩阵:42](../fullstack-staging-2026-09-11/coverage-matrix.md#L42) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-18 | 产品身份 | R2-07 | PRODID-A1 | [原矩阵:48](../fullstack-staging-2026-09-11/coverage-matrix.md#L48) | PARTIAL | 步骤14–15创建无图商品且Library出现；backend-evidence.md核同一Entity/BrandRecord关联；名字与RM39已验，但主图未上传/未验。 |
| BASE-19 | 产品身份 | R2-07 | PRODID-A2 | [原矩阵:49](../fullstack-staging-2026-09-11/coverage-matrix.md#L49) | PARTIAL | run-ledger.md步骤20：@R3唯一找到新商品、Product标签、可选入textbox；未Send，确认卡及approvedEntities谱系未验。 |
| BASE-20 | 产品身份 | R2-07 | PRODID-A3 | [原矩阵:50](../fullstack-staging-2026-09-11/coverage-matrix.md#L50) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-21 | 产品身份 | R2-07 | PRODID-A7 | [原矩阵:51](../fullstack-staging-2026-09-11/coverage-matrix.md#L51) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-22 | 产品身份 | R2-07 | PRODID-R4 | [原矩阵:52](../fullstack-staging-2026-09-11/coverage-matrix.md#L52) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-23 | 产品身份 | R2-07 | FRONT-A10 | [原矩阵:53](../fullstack-staging-2026-09-11/coverage-matrix.md#L53) | PARTIAL | run-ledger.md步骤19官方目录五位各2images，Aisyah只读；步骤20产品@搜索选择成立；没有发送referenceRefs、生成结果来源选择及全部真实ID回链证据。 |
| BASE-24 | 产品身份 | R2-08 | PRODID-A4 | [原矩阵:54](../fullstack-staging-2026-09-11/coverage-matrix.md#L54) | FAIL | Brand→Library改名成立（run-ledger17–18；backend-evidence保持同ID、新名1旧名0）；Library反向改名/换主图无入口，见R3-F03及当前LibraryView:499–544；未验换主图。已确认缺口使整条不能通过。 |
| BASE-25 | 产品身份 | R2-08 | PRODID-A5 | [原矩阵:55](../fullstack-staging-2026-09-11/coverage-matrix.md#L55) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-26 | 产品身份 | R2-08 | PRODID-R6 / R9 | [原矩阵:56](../fullstack-staging-2026-09-11/coverage-matrix.md#L56) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-27 | 产品身份 | R2-09 | PRODID-A6 | [原矩阵:57](../fullstack-staging-2026-09-11/coverage-matrix.md#L57) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-28 | 产品身份 | R2-09 | PRODID-R8 | [原矩阵:58](../fullstack-staging-2026-09-11/coverage-matrix.md#L58) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-29 | 产品身份 | R2-09 | PRODID-R2 | [原矩阵:59](../fullstack-staging-2026-09-11/coverage-matrix.md#L59) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-30 | 产品身份 | R2-09 | §5「两个删除方向不清扫封面字节」 | [原矩阵:60](../fullstack-staging-2026-09-11/coverage-matrix.md#L60) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-31 | 产品身份 | R2-10 | PRODID-A9 | [原矩阵:61](../fullstack-staging-2026-09-11/coverage-matrix.md#L61) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-32 | 产品身份 | R2-10 | PRODID-A10 | [原矩阵:62](../fullstack-staging-2026-09-11/coverage-matrix.md#L62) | PARTIAL | 建与改分别在操作前后2分钟CreditLedger零行、balanceDelta/reservedDelta均0，见backend-evidence.md两节；UI侧栏11；删除未执行，不扩成建改删全通过。 |
| BASE-33 | 产品身份 | — | PRODID-A8（中间那句） | [原矩阵:63](../fullstack-staging-2026-09-11/coverage-matrix.md#L63) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-34 | Creation | R2-11 | §5 :162（FSE-001 正路） | [原矩阵:69](../fullstack-staging-2026-09-11/coverage-matrix.md#L69) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-35 | Creation | R2-11 | CREATE-A10 | [原矩阵:70](../fullstack-staging-2026-09-11/coverage-matrix.md#L70) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-36 | Creation | R2-11 | §5 2026-09-09（自动放大） | [原矩阵:71](../fullstack-staging-2026-09-11/coverage-matrix.md#L71) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-37 | Creation | R2-11 | §5 :176④ | [原矩阵:72](../fullstack-staging-2026-09-11/coverage-matrix.md#L72) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-38 | Creation | R2-11 | §5 :176⑥ | [原矩阵:73](../fullstack-staging-2026-09-11/coverage-matrix.md#L73) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-39 | Creation | R2-12 | §5 :163① | [原矩阵:74](../fullstack-staging-2026-09-11/coverage-matrix.md#L74) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-40 | Creation | R2-12 | §5 :163② | [原矩阵:75](../fullstack-staging-2026-09-11/coverage-matrix.md#L75) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-41 | Creation | R2-12 | §5 :163③ | [原矩阵:76](../fullstack-staging-2026-09-11/coverage-matrix.md#L76) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-42 | Creation | R2-12 | §5 :170（FSE-012） | [原矩阵:77](../fullstack-staging-2026-09-11/coverage-matrix.md#L77) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-43 | Creation | R2-12 | CREATE-A1 | [原矩阵:78](../fullstack-staging-2026-09-11/coverage-matrix.md#L78) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-44 | Creation | R2-12 | CREATE-A12 | [原矩阵:79](../fullstack-staging-2026-09-11/coverage-matrix.md#L79) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-45 | Creation | R2-13 | §5 :164 / :173（FSE-005） | [原矩阵:80](../fullstack-staging-2026-09-11/coverage-matrix.md#L80) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-46 | Creation | R2-13 | §5 fb:202（FSE-010） | [原矩阵:81](../fullstack-staging-2026-09-11/coverage-matrix.md#L81) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-47 | Creation | R2-13 | CREATE-A11 相邻样本 | [原矩阵:82](../fullstack-staging-2026-09-11/coverage-matrix.md#L82) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-48 | Creation | R2-14 | §5 :169（FSE-009） | [原矩阵:83](../fullstack-staging-2026-09-11/coverage-matrix.md#L83) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-49 | Creation | R2-14 | FRONT-A5 | [原矩阵:84](../fullstack-staging-2026-09-11/coverage-matrix.md#L84) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-50 | Creation | R2-14 | FRONT-A6 | [原矩阵:85](../fullstack-staging-2026-09-11/coverage-matrix.md#L85) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-51 | Creation | R2-14 | FRONT-A7 | [原矩阵:86](../fullstack-staging-2026-09-11/coverage-matrix.md#L86) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-52 | Creation | R2-14 | §5 fb:203（FSE-011 Profile 邮箱空白） | [原矩阵:87](../fullstack-staging-2026-09-11/coverage-matrix.md#L87) | PARTIAL | run-ledger03/11：DOM空值但截图正常Email，与Account一致，R3-F01取证矛盾不是已确认产品bug；取证根因及完整复验尚缺。 |
| BASE-53 | Creation | R2-15 | §5 2026-09-10（variation 真实交付） | [原矩阵:88](../fullstack-staging-2026-09-11/coverage-matrix.md#L88) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-54 | Creation | R2-16 | §5 取消语义 | [原矩阵:89](../fullstack-staging-2026-09-11/coverage-matrix.md#L89) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-55 | Creation | R2-17 | §5 cap 多入口与并发 | [原矩阵:90](../fullstack-staging-2026-09-11/coverage-matrix.md#L90) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-56 | Creation | R2-18 | §5 完整下载字节 | [原矩阵:91](../fullstack-staging-2026-09-11/coverage-matrix.md#L91) | PARTIAL | run-ledger22：CUA pageAssets按详情img.src匹配导出原图，artifacts/product-original.jpeg真实字节、1728×2304、SHA256与对象名一致；不是Download按钮落盘回执，步骤06该路径仍未闭合。 |
| BASE-57 | Creation | R2-19 | §5 :172④ | [原矩阵:92](../fullstack-staging-2026-09-11/coverage-matrix.md#L92) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-58 | Creation | R2-19 | FRONT-A12 | [原矩阵:93](../fullstack-staging-2026-09-11/coverage-matrix.md#L93) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-59 | Creation | R2-20 | §5 :162④ | [原矩阵:94](../fullstack-staging-2026-09-11/coverage-matrix.md#L94) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-60 | Creation | R2-21 | §5 :172⑥（接续＋直接出片同开） | [原矩阵:95](../fullstack-staging-2026-09-11/coverage-matrix.md#L95) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-61 | Creation | R2-22 | §5 :162 残留③ | [原矩阵:96](../fullstack-staging-2026-09-11/coverage-matrix.md#L96) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-62 | Creation | R2-23 | §5 :162 残留① | [原矩阵:97](../fullstack-staging-2026-09-11/coverage-matrix.md#L97) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-63 | Creation | R2-24 | CREATE-A2 | [原矩阵:98](../fullstack-staging-2026-09-11/coverage-matrix.md#L98) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-64 | Creation | R2-24 | §5 :178 | [原矩阵:99](../fullstack-staging-2026-09-11/coverage-matrix.md#L99) | NOT RUN | 待执行；按当前规格核齐分句 |
| BASE-65 | 前端基线 | R2-06 | §5 2026-09-10（FRONT-A2 密码半段退役） | [原矩阵:105](../fullstack-staging-2026-09-11/coverage-matrix.md#L105) | NOT RUN | 待执行；按当前规格核齐分句 |

## 本版新增的六份已批准规格

每条均独立执行；源规格完整场景和判定为权威。重复覆盖可以引用同一回执，不能因此省略不同分句。

| 编号 | 场景 | 判定口径 | 来源 | 本轮判定 | 本轮证据／缺口 |
|---|---|---|---|---|---|
| ASSET-A1 | 商家 A 在详情面板按 Regenerate，请求里的 `assetAnchorGenerationId` 被换成商家 B 的一张图的编号 | 请求被拒，面板显示 "That image isn't available in this workspace."；数据库里零新 GenJob、账本零新行、余额不变 | [规格:47](../../specs/asset-action-idempotency.md#L47) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| ASSET-A2 | 商家对自己工作区里的图按 Regenerate（正常路径） | 正常出一单，余额扣一次；锚点检查不误伤任何合法动作 | [规格:48](../../specs/asset-action-idempotency.md#L48) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| ASSET-A3 | 第一单已 DONE 之后，原样重发同一次提交（同一意图编号） | 拿回原来那一单的结果，不新建 GenJob，账本零新行，余额不变 | [规格:49](../../specs/asset-action-idempotency.md#L49) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| ASSET-A4 | 商家在面板上**再按一次** Regenerate（同一张图、同样提示词） | 新的一单、账本一条新的 RESERVE，余额再扣一次 | [规格:50](../../specs/asset-action-idempotency.md#L50) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| ASSET-A5 | 生成中断网，页面重连自动重发同一次提交 | 回到同一单的进度，页面上只有一条进度条，账本零新行 | [规格:51](../../specs/asset-action-idempotency.md#L51) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| ASSET-A6 | 同一把 `asset:` 键并发两次落库（第一单已 DONE） | 第二次被数据库唯一索引挡掉，零新 GenJob、$0 | [规格:52](../../specs/asset-action-idempotency.md#L52) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| ASSET-A7 | 跑完 A3、A4、A5 后核对账本（钱守恒） | 余额减少量 = 该期间 RESERVE/SETTLE/REFUND 净额 = 实际生成次数 × 单价；无悬挂 reserve、无重复 settle | [规格:53](../../specs/asset-action-idempotency.md#L53) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| ASSET-A8 | 一单 FAILED（钱已退）后商家按一次重试 | 允许新的一单、扣一次钱；余额与账本对得上，退款那一行不被抵消或重复 | [规格:54](../../specs/asset-action-idempotency.md#L54) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| ASSET-A9 | Otto 模板窗发起模板动作后原样重发同一次提交 | 与 A3 一致：命中原单、账本零新行 | [规格:55](../../specs/asset-action-idempotency.md#L55) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| ASSET-A10 | 在全新数据库上跑迁移并执行 A3、A4 | 迁移成功、唯一索引存在（谓词 `LIKE 'asset:%'`），两条验收行为一致 | [规格:56](../../specs/asset-action-idempotency.md#L56) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| TENANT-A1 | 在任一已落闸面的动作里（含 `billing-actions` 两处与 `gen-actions` 四处）打印当前身份 | `getPrincipal()` 返回 `kind === "user"` 的完整帧（带 ownerId 与 userId）；两个商家的请求重叠在飞时互不串帧 | [规格:51](../../specs/tenant-isolation.md#L51) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| TENANT-A2 | 用 A 商家的会话，把请求体里的 id／orgId 换成 B 商家的资源，做改名、删除、读取各一次 | 三次全部失败；B 的数据与行数一字未改；A 自己的同一动作正常成功 | [规格:52](../../specs/tenant-isolation.md#L52) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| TENANT-A3 | 对已落闸的面发起一次无帧调用，并单独喂一次 `{ ownerId: { not: "" } }` 形状的 where | 两次都被拒（无帧即拒）；伪造过滤器不再过关 | [规格:53](../../specs/tenant-isolation.md#L53) | PARTIAL | **测试，不是 staging 走查**（本轮零写边界下钱面越权动作不可达）。钱面那一半已由真库测试钉住：`packages/db/src/tenant-guard-enforce-prework-1403.test.ts`（无帧调真钱动作被拒、`{orgId:{not:""}}` 伪造过滤器被拒）＋ `tenant-guard-money-slice1.test.ts`。**未收口的那一半**：①`ownerId` 族宽松档至今照放 `{ownerId:{not:""}}`（属切片②）；②钱面「无帧但字面 orgId 放行」的兜底本版保留（#1403 裁决，清单见 local-logs/tenant-warn-baseline-2026-09-19.md §6）——所以 A3 原文「无帧即拒」今天只对「没写租户号的无帧调用」成立 |
| TENANT-A4 | **钱守恒**：跨租户伪造一次充值确认、一次扣费、一次退款；再用同租户正常扣费一次并重放同一幂等键 | 三次越权全失败，两边 CreditLedger 余额与流水行数分毫未变；正常扣费恰好一笔，重放不产生第二笔 | [规格:54](../../specs/tenant-isolation.md#L54) | PARTIAL | **测试，不是 staging 走查**。走**真扣费路径**（`credits.ts` 的 reserve/settle/refund/grant，不手搓 createMany）：`packages/db/src/tenant-guard-enforce-prework-1403.test.ts` 四条 —— 跨租户伪造充值/扣费/退款三次全败且两边余额、reserved、流水行数分毫未变；同租户正常扣费恰好一笔、重放同一幂等键不产生第二笔。#1403 翻闸之后这四条证的就是今天线上的行为（挡位已删，用例不再自己扳挡位）。**判定改 PARTIAL（复审 T2，2026-09-19）**：证据全部来自自动测试，而本矩阵表头写明「历史报告与已有自动测试不能替代本轮执行回执」——缺的那一半是本轮真实环境的走查回执（本轮零写边界下，跨租户伪造充值/扣费/退款在 staging 上不可达），与 TENANT-A3 同口径 |
| TENANT-A5 | 每片落闸后走一遍该面的完整商家旅程（钱面：充值→扣费→退款；动作面：建项目→生成→排期；CRM 面：建客户→跟进） | 全程零 500、零新错误；与落闸前同结果 | [规格:55](../../specs/tenant-isolation.md#L55) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| TENANT-A6 | 后台员工发一次积分、退一次款、跑一次对账 | 三次都在 staff 帧内发生，审计行的操作者与目标租户由帧带出；跨租户铸币仍要求 `requireRole("tenants","mutate")` 才放行 | [规格:56](../../specs/tenant-isolation.md#L56) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| TENANT-A7 | 在全新数据库上跑完全部迁移，然后尝试把 A 租户的子行挂到 B 租户的父行 | 迁移零错误；跨租户挂接被数据库直接拒绝（不靠应用层） | [规格:57](../../specs/tenant-isolation.md#L57) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| TENANT-A8 | 跑 8 条队列各一单（caption / gen / ingest / publish / refgen / render / research / understand） | 8 条全部跑通；帧建立之后该单的所有后续读写都经过值比对（用一次异租户 id 注入证明会被拒） | [规格:58](../../specs/tenant-isolation.md#L58) | PARTIAL | **测试，不是 staging 走查**。`apps/worker/src/jobs/tenant-queue-frames-a8-db.test.ts`（真库、真守卫、真 handler）八条队列各一单跑到终态 + 十六笔帧内异租户注入被逐字拒绝；验收行已随 #1403 改点八条（含 understand）并写进「除已登记豁免表外」。**边界**：`ResearchJob`/`ScheduledPostMedia`/`PublishAttempt` 三张登记豁免表上的帧内读写结构上不过值比对（收口条件＝迁入 `TENANT_MODELS`）；R2 存储路与 `PUBLISHING_AVAILABLE` 真值不在覆盖内。**判定改 PARTIAL（复审 T2，2026-09-19）**：同上 —— 八条队列的证据是真库自动测试，不是本轮 staging 走查回执；另加上面写明的三张登记豁免表这一处结构性边界 |
| TENANT-A9 | 用同一段音频同一模型，在两个不同租户下各跑一次转写 | 第二次命中全局缓存、不报错、不重复计费；换成任何其它表的跨租户读则被拒 | [规格:59](../../specs/tenant-isolation.md#L59) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| TENANT-A10 | 跑机器计数：`apps/web` 生产代码里文件内零 `runAsUser` 的 `requireOwner` 站点数、生产 `requireRole` 站点未建帧数 | 两个数都是 0；守卫里的迁移期挡位已从代码中删除 | [规格:60](../../specs/tenant-isolation.md#L60) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| SHARE-A1 | 对一个大对象（≥200 MB）的预览媒体地址发 `Range: bytes=0-1048575` | 返回 206 + `Content-Range`，正文正好 1 MiB；进程常驻内存不随对象大小上涨（对照同一请求在旧码上的整块缓冲） | [规格:50](../../specs/share-preview.md#L50) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| SHARE-A2 | 普通浏览器不带 Range 打开预览页 | 图片／视频照常显示，200 流式返回，页面与今天一致 | [规格:51](../../specs/share-preview.md#L51) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| SHARE-A3 | 把限流计数存储打挂，再拉一次合法预览媒体地址 | 429 + `Retry-After`，不吐字节；存储恢复后同一地址立刻恢复 200（Founder 已裁 2026-09-12（场⑦）） | [规格:52](../../specs/share-preview.md#L52) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| SHARE-A4 | 同一客户先成功拉过一次，随即打挂存储，在短缓存窗口内重拉同一地址 | 窗口内仍 200（抖动不误伤正在看的客户），窗口过后 429（Founder 已裁 2026-09-12（场⑦）） | [规格:53](../../specs/share-preview.md#L53) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| SHARE-A5 | 分享后把该排期的文案改掉，客户刷新旧链接 | 看到改后的新文案，且页面有一行 `Content may have changed since this link was shared.` | [规格:54](../../specs/share-preview.md#L54) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| SHARE-A6 | 客户打开商家发来的链接 | 地址栏是不含 token 的干净地址；浏览器遥测（Sentry `beforeSend` 抓到的事件）里的任何 URL 都不含 token | [规格:55](../../specs/share-preview.md#L55) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| SHARE-A7 | 客户复制一条图片地址后，商家点 Revoke，客户立刻重刷那条图片地址 | 当场 404（不是十分钟后） | [规格:56](../../specs/share-preview.md#L56) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| SHARE-A8 | 撤销后客户刷新预览页 | 仍是同一句「This preview isn't available」，与过期／伪造无从区分 | [规格:57](../../specs/share-preview.md#L57) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| SHARE-A9 | 匿名连拉同一预览媒体 100 次 | credits 账本与交易表行数一字不变，无任何计费写入 | [规格:58](../../specs/share-preview.md#L58) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| SHARE-A10 | 拿 owner A 的媒体 token 改成指向 owner B 的 key 再请求 | 404，双租户测试覆盖 | [规格:59](../../specs/share-preview.md#L59) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| SHARE-A11 | 反解一条链接里的 token，对照代码注释与测试声明 | 二者一致：注释如实写明可读出 ownerId／postId／到期／storage key；`share-preview-view.ts:19-24` 那句「no id of anything ... never returned」相反声明已删 | [规格:60](../../specs/share-preview.md#L60) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| SHARE-A12 | 把限流计数存储打挂并保持一段时间 | 「限流存储不可用」告警经 founderAlert 真送达（有送达回执，不是只记日志）；与 SHARE-A3 同一个 PR 落地（Founder 已裁 2026-09-12 场⑦：拒绝＋兜底＋报警三件一体） | [规格:61](../../specs/share-preview.md#L61) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| RELY-A1 | 生产配置未设 `GENERATION_PROVIDER`（或设成 `byteplus` 以外的值，逃生阀启动），商家上传一张菜品照 | 理解行停在 `PAUSED` 并显示既有文案「That file hasn't been read yet …」；描述、商品、价格一个都没有；品牌记忆无新增行 | [规格:44](../../specs/fail-closed-reliability.md#L44) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| RELY-A2 | 同 A1 场景之后查账（**钱守恒**） | 该轮 refId 的预留已退，账本净额 0；商家余额与上传前一字不差；无 SETTLE 行 | [规格:45](../../specs/fail-closed-reliability.md#L45) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| RELY-A3 | 生产配置明写 `GENERATION_PROVIDER=mock`（逃生阀启动），商家按一次生成、再上传一张图 | 生成被拒并退款，拿不到纯色假图；理解同样停 `PAUSED` ＋ 退款；两者都没有 DONE | [规格:46](../../specs/fail-closed-reliability.md#L46) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| RELY-A4 | 运维把生产 worker 的 `GENERATION_PROVIDER` 设成 `mock` 或留空后启动 | 进程开机即拒绝启动，报错点名 `GENERATION_PROVIDER`；`mock` 不再是生产合法枚举值 | [规格:47](../../specs/fail-closed-reliability.md#L47) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| RELY-A5 | 开发者在本地／CI 不设 `GENERATION_PROVIDER` 跑测试与演示 | 行为与今天完全一致（mock 照跑，不联网、不收费），无新增开关 | [规格:48](../../specs/fail-closed-reliability.md#L48) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| RELY-A6 | 运维把 `SENTRY_DSN` 填成 `https://example.com` 启动生产进程；再换成形状合法的 DSN | 前者开机拒绝并点名该变量；后者正常启动。全程不做任何启动探测外呼 | [规格:49](../../specs/fail-closed-reliability.md#L49) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| RELY-A7 | 模拟「商家付了钱什么都没拿到」且邮件与 Telegram 双双失败 | 下一趟巡检**再次**尝试人工渠道（不是永久静音）；Sentry 每趟照收；日志写明这一条谁都没收到 | [规格:50](../../specs/fail-closed-reliability.md#L50) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| RELY-A8 | 同一天内同一条缺口被巡检反复扫到 | 人工渠道当天只响一次，之后走 `repeat`（邮件／Telegram suppressed），Sentry 仍计数 | [规格:51](../../specs/fail-closed-reliability.md#L51) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| RELY-A9 | 构造 Stripe 付款成功但 metadata 不可用（及金额与套餐不符），且告警一条都没送出 | webhook 仍回 200；台账记 `alertDelivered=false`；下一趟 `stripe-reconcile` 重试；某趟送达后翻 `true` 且不再重试 | [规格:52](../../specs/fail-closed-reliability.md#L52) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| RELY-A10 | 生产备份 cron 在缺必需 env 的情况下启动；补齐后再启动 | 前者退出码非 0 并点名缺项（不再「起来了但没备份」）；后者照常完成当日备份 | [规格:53](../../specs/fail-closed-reliability.md#L53) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| RELY-A11 | 打开 `docs/ops/telegram-alerts.md` 与 `docs/ops/incident-visibility.md` | 列出的告警 key 与代码里的 `founderAlert` key 逐条对得上（当场 grep 比对）；两份文档里没有把明文 token 写进命令行的示例 | [规格:54](../../specs/fail-closed-reliability.md#L54) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| MEDIA-A1 | 操作者在 staging 正常生成/上传一个媒体对象，然后跑手册里的只读核验命令 | 备份桶里出现同键副本、哈希与主桶一致；输出原样贴进 `docs/runbooks/media-restore.md` 的演练记录（含日期） | [规格:51](../../specs/media-durability.md#L51) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| MEDIA-A2 | 操作者当场查两个备份桶的 lifecycle 规则与差集比对命令输出 | 备份桶无自动删除规则（multipart 中止规则除外）、手册写明「备份桶全量保留，月度看一眼成本」；主桶与备份桶差集为空（存量回填已完成） | [规格:52](../../specs/media-durability.md#L52) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| MEDIA-A3 | Founder 随手挑一个人照 `docs/runbooks/media-restore.md` 从头走一遍，不许问人 | 手册自足：定位对象键 → 在备份桶找到副本 → 恢复命令 → 哈希比对 → 回填 RTO，五步都能照做，没有一步依赖口头知识 | [规格:53](../../specs/media-durability.md#L53) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| MEDIA-A4 | 在 staging 桶里删掉一个「商家已付费产物」的对象，按手册从备份桶恢复它（沿用 v1 已裁：演练环境选 staging，生产桶零删除） | 对象回到原键，恢复件与原件的哈希一致，产物页面能重新打开；全过程没有产生任何新的生成 job | [规格:54](../../specs/media-durability.md#L54) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| MEDIA-A5 | 打开 `docs/runbooks/media-restore.md` 末尾的演练记录 | 有一行完整留证：日期 / 执行者 / 对象键 / 实测 RTO / 命令输出片段——与 #870 数据库演练同规格 | [规格:55](../../specs/media-durability.md#L55) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| MEDIA-A6 | 演练前后各对该产物所属租户的 `CreditLedger` 拍一次快照并比对 | 逐笔一致：无新增 RESERVE／SETTLE／REFUND，商家未被二次扣费——钱守恒 | [规格:56](../../specs/media-durability.md#L56) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| MEDIA-A7 | 对生产桶与生产备份桶只做只读核验（复制路径已接、差集状态），不删任何对象 | 核验输出显示生产侧复制已生效，且演练记录里写明「生产桶本次零删除」 | [规格:57](../../specs/media-durability.md#L57) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| MEDIA-A8 | Founder 打开 `docs/specs/beta-gate.md` GATE-A6，念那句判定 | 由 MEDIA-A4 与 MEDIA-A5 的证据满足；beta-gate.md §5 变更登记里有一行指向本规格（beta-gate 现为草稿，随场⑥冻结；本规格不改它的正文条款） | [规格:58](../../specs/media-durability.md#L58) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| MEDIA-A9 | 在演练里故意用一个不属于目标租户的对象键试恢复 | 手册要求的前缀核对拦住它，操作停在核对那一步；手册正文写死「只按单键恢复，禁止整桶回滚」 | [规格:59](../../specs/media-durability.md#L59) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| QUEUE-A1 | 商家 A 连发 4 条长视频后，商家 B 提交短任务 | B 的任务立即开跑不等队（真库集成测试＋第三轮走查真机验证；#1388 验收句由此兑现） | [规格:26](../../specs/zero-queue.md#L26) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| QUEUE-A2 | 4 条视频同时在供应商处生成 | worker 的 gen 施工位全部空闲可认领（真库测试断言：在飞视频不持有施工位） | [规格:27](../../specs/zero-queue.md#L27) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| QUEUE-A3 | 任意轮询次数下走完提交→成功／提交→失败 | 账本恰一组 reserve→settle／reserve→refund，轮询不产生任何额外账本行（变异检验：去掉幂等守卫该测必红） | [规格:28](../../specs/zero-queue.md#L28) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| QUEUE-A4 | 视频提交后进程崩溃重启 | 在飞任务被接回轮询，最终 settle 或 refund 恰一次，不丢单、不双结 | [规格:29](../../specs/zero-queue.md#L29) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| QUEUE-A5 | 供应商排队数满、提交被 429 拒（按 message 区分 `QuotaExceeded` 三义） | $0、不扣钱，任务按现有诚实中间态口径重试或如实报错 | [规格:30](../../specs/zero-queue.md#L30) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| QUEUE-A6 | 时钟全套重推 | 「卡死判定／过期／清道夫」对在飞视频改按提交时刻＋供应商侧期限判，clock-invariants 全套重推后：跨队列 40m>35m 缺口消除（现有钉板测试改写转绿），健康慢任务零误判退款 | [规格:31](../../specs/zero-queue.md#L31) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| QUEUE-A7 | 施工前探针（≤US$2，用生产同族最便宜档约 $0.18/条） | 四个文档未载点实测定案并入 docs/audits/：①超并发提交确实进 `queued`；②GET 轮询限速实测口径；③超时任务 GET 返回的真实 status 字符串（文档枚举漏 `expired`）；④排队数上限的真实错误行为 | [规格:32](../../specs/zero-queue.md#L32) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |

## 第二轮明确延后及全栈补充面

来源：旧 plan.md:86；用户本轮要求全面 E2E。2026-09-14 范围及US$20生成预算已批准；下表是分组，细化为后面的31项真实子检查。业务阈值和危险动作授权未自动获批。

| 编号 | 面 | 可检查范围 | 本轮判定 | 证据／缺口 |
|---|---|---|---|---|
| EXT-01 | 手机 | 登录、首页、Creation、Brand、Library、Billing、Settings、分享预览：窄屏溢出、触控、软键盘、弹窗与下载。 | PARTIAL | ledger09窄视口及reload已观察裁切；无真手机/全部页面/触控软键盘。批准产品desktop-only，本项探索非自动回归或改设计授权。 |
| EXT-02 | 大屏 | 以上已实现面在 1440 / 1920 宽度检查布局、画布、浮层与关键信息可达。 | PARTIAL | ledger10仅Library1920大屏正常；其他页面与1440等未全测。 |
| EXT-03 | 键盘与 IME | Tab 顺序、焦点回归、Escape、提交、中文输入法组合期间 Enter 不误提交；实际 IME 与合成事件分开记录。 | PARTIAL | ledger05/07/08/12键盘部分路径，程序填中文非IME；焦点恢复/真实组合输入未验。 |
| EXT-04 | 无障碍 | 名称、标签、对比、放大、键盘全路径；自动扫描与屏幕阅读器人工证据分开。 | NOT RUN | 待执行／待明确适用阈值及环境边界 |
| EXT-05 | 双租户全矩阵 | 读／改／删／关联／分享／队列／员工动作，含同租户正对照、并发身份隔离、零账本越权写；扩大 TENANT-A2/A4/A8。 | NOT RUN | 待执行／待明确适用阈值及环境边界 |
| EXT-06 | 数据库恢复 | 隔离目标 fresh database 的迁移与恢复演练、行数及不变量；不对线上数据库破坏性演练。 | NOT RUN | 待执行／待明确适用阈值及环境边界 |
| EXT-07 | 媒体恢复 | 优先复核现有演练与当前复制状态；再次删恢复须本次逐项授权，覆盖 MEDIA-A1…A9。 | NOT RUN | 待执行／待明确适用阈值及环境边界 |
| EXT-08 | 供应商成本总账 | 按任务对齐卡面报价、RESERVE、SETTLE/REFUND、供应商成本；牌价估算不得写成实际结算。 | PARTIAL | 待执行／待明确适用阈值及环境边界 另有本地mock单内部1000→990（100→99credits），reserve(-10,+10)/settle(0,-10)、无refund/reserved0；不能替代真实供应商账单。 详见run-ledger本地追加。 |
| EXT-09 | 注册并发与邮件 SLA | 一次赠金、并发建号幂等、50/51 全站限流、邮件收取耗时与告警；SLA 数值待 Founder 定，不擅定通过阈值。 | NOT RUN | 待执行／待明确适用阈值及环境边界 |
| EXT-10 | 真实引擎与渠道 | 真图／视频／理解与零排队；外部发布、邮件和通知仅在明确授权夹具及目的地运行。 | PARTIAL | 待执行／待明确适用阈值及环境边界 本地真实队列+独立worker消费mock生成DONE，1Generation/Asset/文件；seeded Otto方案非真实提案，真实provider未跑。 详见run-ledger本地追加。 |
| EXT-11 | 安全与隐私 | 未认证入口、权限、CSRF/会话、token/日志/截图脱敏与限流；仅受控夹具，不做无范围压力攻击。 | PARTIAL | http-boundary-checks匿名跳转/坏token；ledgerProfile视觉身份与DOM矛盾；跨租户/会话/全量隐私扫描未完成。截图外发入库前须脱敏。 |
| EXT-12 | 性能与失败恢复 | 首屏、关键交互、并发短长任务、断网重连、进程中断后收敛；性能阈值与故障注入另定。 | PARTIAL | ledger23–25历史画布刷新/深链/新标签恢复；没有在飞生成、断网、负载或性能阈值证据。 本地mock同fixture重开图片naturalWidth>0、Done/99credits，未跑原页自动收敛断言；不证明在飞中断恢复。 详见run-ledger本地追加。 |
| EXT-13 | 全部已实现路由 | 盘点实际路由并逐页覆盖正常／空／加载／错误状态、返回／深链；Campaign/CRM/Schedule/Admin 等仅按现行实现及批准规格取样，不把蓝图未来能力当已上线。 | PARTIAL | ledger已有Home/Billing/Profile/Brand/Library/Create/历史Canvas部分现场；未全路由四态。 |

## 扩展组可执行子检查

来源与完整步骤见 [real-scenarios.md](real-scenarios.md)。同一真实样本可支撑多行，但每行必须核完整主张；不重复计算付费。

| 子检查 | 分组 | 商家场景 | 判定 | 证据 |
|---|---|---|---|---|
| REAL-01 | EXT-09 EXT-11 | 新商家登录并回到原任务 | NOT RUN | [步骤](real-scenarios.md#real-01-商家场景新商家登录并回到原任务) |
| REAL-02 | EXT-09 EXT-11 | 老商家两扇门回来还能找到作品 | NOT RUN | [步骤](real-scenarios.md#real-02-商家场景老商家两扇门回来还能找到作品) |
| REAL-03 | EXT-10 EXT-08 | 品牌商品从首页到人物视频 | PASS | staging 第三轮付费旅程第二组（2026-09-17，build `c0d25917`）：R3-F20 修复（PR #1463）已合并，`/brand/records?tab=products` 可建产品，2026-09-16 那次 NOT RUN 的前置阻断已消失。全流程逐条核实：Entity/BrandRecord 同一 id（PRODID-A1）；Brand 卡片／Library Elements Products／`@` 菜单（来源标签「Product」）／确认卡／`GenJob.entityIds`／`approvedEntities`／`Generation.entitySnapshot` 七处同一 Entity id（PRODID-A2）；`sourceGenerationId`／`tailGenerationId`／`referenceVideoGenerationId` 三列全 NULL、`RefGenJob=0`，人物商品两参考直接出片、无首帧合成；交付 1280×720、5.0417s、零音频字节，与报价 16:9／5s／720p／No sound 一致；Library 详情页可读谱系并播放下载，下载字节 sha256 与 `Asset.contentHash` 相等。**唯一偏差**：产品封面挂的是商家已有的 Library 图（本身是 AI 生成），不是新上传——本轮 harness 无文件上传动作，「挂自有图」按规格字面用一张已有的自有资产满足，但「商家上传一张全新产品照片」这条子路径仍未被端到端跑过（登记见 `findings-catalog.md` 本轮补记）。侧证：PRODID-R11／FSE-210（`@` 产品 id 提案→确认卡丢失）第二次不复现；PRODID-A10（建、挂图零扣费）再证一次；PR #1462 自动封面写回观察到生效。证据：[步骤](real-scenarios.md#real-03-商家场景品牌商品从首页到人物视频)、`local-logs/staging-r3-paid/real-03-person-video.json` 步骤 S01–S17、`verdicts[0]`。 |
| REAL-04 | EXT-10 EXT-08 | 不带人物的创作和 variation | PASS | staging 第三轮付费旅程第三组（2026-09-17，build `c0d25917`）：无人物商品视频——`GenJob.entityIds`／`approvedEntities` 只含产品 Entity、不含任何 CHARACTER；`DONE`、`spentUsd 0.38038218749999997`、`billedUnits 108900`；Library 播放器 0→5.042s、1280×720、零音频字节解码（与「No sound」一致）；下载 HTTP 200、`video/mp4`、1,981,328 字节，sha256 与 `Asset.contentHash`／`sizeBytes` 相等。Create variations（用已有图）：报价「Cost: 1 credit. No charge until you confirm」在点击前可见，批准后新 `GenJob` 的 `sourceGenerationId` 指回原图，产出独立可用的 2048×2048 新图（可渲染、可下载、sha256 与哈希一致），原图（757c1ce7…cd73）未被触碰、仍在 Library。两单各自恰一组 RESERVE/SETTLE、零 REFUND、reserved 归零。旁证（未阻断本行判定，另登 R3-F30）：变体的 `Generation.entitySnapshot` 为空数组，产品身份一跳后丢失——这是谱系审计缺口，不是这行「无人物成功可播、variation 真实可用、每单恰一组结算」三句本身的缺口。证据：[步骤](real-scenarios.md#real-04-商家场景不带人物的创作和 variation)、`local-logs/staging-r3-paid/real-04-06-08.json` 步骤 S01–S14、`verdicts[0]`。 |
| REAL-05 | EXT-03 EXT-01 | 中文组合输入与英文提交 | PARTIAL | staging第二轮（2026-09-15）：中文草稿「为这款杯子做广告」键入Create composer未持久化，Send为独立按钮点击才发起、期间零POST；但独立核证推翻「Enter绝不自动触发」——StartSomething.tsx:288-294（同款见OttoChatStream.tsx:1205）回车（非组字中）会直接调用会创建Project+ChatThread并起一轮Otto的startCanvas，走查工具本轮恰好只递keydown不触发原生默认动作才未真实发生；记为观察（聊天类产品市场通行行为），非缺陷，但构成过一次真实花钱风险。IME组字事件未测，草稿清空靠离页而非select-all+Backspace（工具限制）。 |
| REAL-06 | EXT-05 EXT-12 | 多标签同一次提交不重复收费 | PARTIAL | staging 第三轮付费旅程第三组（2026-09-17，build `c0d25917`）：A 标签确认一张图后 B 标签重放同一张卡——「零新增账本」半句有硬数据库证据（重放窗口零新增 `GenJob`、零新增账本行、余额不动，线程仍只有一个 `GEN_CARD`／一个 `GEN_RESULT`）；但重放请求本身的服务端正面回执被画布崩溃吞掉（R3-F28：`This canvas didn't open`，`React error #185`），只能证明「这次重放没有引发第二次扣费」，不能证明「幂等守卫真的处理并回应了这次重放」——两件事分开陈述，不把前者读成后者的证据。显式新意图（Library「Regenerate」）确实产生新 `GenJob`、新报价、独立的 `asset:regen:` 键族。终态前的在途重放（规格 ASSET-A5 形态）本组未发生——图片在 B 标签点击前 12 秒已 DONE。跨标签业务解释仍是 `asset-action-idempotency.md §5` 2026-09-12 登记行明写「待裁、不静默通过」的争议，本组不代为裁定。证据：[步骤](real-scenarios.md#real-06-商家场景多标签同一次提交不重复收费)、`local-logs/staging-r3-paid/real-04-06-08.json` 步骤 S07–S11、`verdicts[1]`。 |
| REAL-07 | EXT-12 EXT-02 | 付费后刷新、离页和回来 | PARTIAL | staging 第三轮付费旅程第二组（2026-09-17，build `c0d25917`）：worker 自报 PASS，独立核证员改判 PARTIAL——刷新腿确实在生成中（GENERATING）验证（卡片仍显示「✓ Approved — in the queue · 0:47」），但 Back 腿卡在终态边界、深链与第二标签两腿都在任务已 DONE 之后 4 分钟才验证，「回到同一个仍在跑的 job」这条 worker 自己的 `clausesNotProven` 已承认未证；PASS 判据不允许留着未证条款还判 PASS，核证员据此收紧。已证并保留的部分：同一 job 全程恰 2 条账本行（1 RESERVE + 1 SETTLE，无重复预扣）、Home／Library／画布深链／对话深链四处余额一致、慢任务全程显示「Otto is making this — this can take a moment…」从未伪装失败。证据：[步骤](real-scenarios.md#real-07-商家场景付费后刷新、离页和回来)、`local-logs/staging-r3-paid/real-03-person-video.json` 步骤 S10–S12、`workflow-groups2-4-result.json` `verdicts[0].downgrades[0]`。 |
| REAL-08 | EXT-12 EXT-10 | 真实失败之后编辑重试 | PARTIAL | staging第二轮（2026-09-15）：GenJob 01M288VJS12BBT536TZF5T0S01失败卡显示「That didn't finish / You weren't charged.」无重试按钮（frontend-baseline.md:136④裁定按设计），对话内另有「Try again/Change something」入口；/billing花费历史把RESERVE-110/REFUND+110（11显示积分）合并成一行、金额显示0（新发现R3-F12，有迹可循原则）。核证：worker原判「FSE-204商家侧仍未闭合」被推翻——修复commit 6624e832先于本单，该单本身2026-09-11 13:00 UTC早于该修复与2026-09-12裁定，不能代表当前build；GenJob确实存了失败原因(error='generation provider video submit failed (400)')只是不显示，属裁定内按设计。**staging 第三轮付费旅程第三组（2026-09-17，build `c0d25917`）补证，结构性受阻而非取证不足**：编辑重试入口确实存在（Try again 克隆原卡零花费、Change something 交回 Otto 改写），原退款行（RESERVE -110/+110、REFUND +110/-110）全程未被抵消或重复；付费前 fail-closed 且理由具体可行动（「One of your references is only 80×107 pixels…nothing was sent.」）。但「新单一次预扣」这半句在 org founder 上无法达成——今天仅有的两个自然失败（80×107px 起始帧；「不能作人物」的参考图）都是永久性无效输入，任何忠实重试都会在校验层被拒、走不到付费提交；要关掉这一半需 Founder 批准人造一次供应商侧失败，或改判由单元／集成测试覆盖，重复本旅程只会拿到同样的 PARTIAL——登记见 `docs/specs/asset-action-idempotency.md` §5 本轮新增行。证据：`local-logs/staging-r3-paid/real-04-06-08.json` 步骤 S16–S19、`verdicts[2]`。 **2026-09-18 回填**：Founder 2026-09-18（对谈）裁定「改由单元／集成测试覆盖」，不人造供应商侧失败。**本轮判定仍为 PARTIAL**——staging 上那条真实旅程依旧没跑通，改判只是不再等它，本行不因测试绿而升级为 PASS。缺的那半句「新单一次预扣」连同 (a) 失败恰好退一次、(c) 同一张重试卡批两次只扣一次、(d) 整段账本守恒，已由真库行为测试钉住：`apps/web/lib/__tests__/real08-retry-paid-ledger.test.ts`（真 Postgres `*_test`、真 Prisma、真账本；走 `coworkGenerate`／`coworkVaryCard`／`ottoUpdateGenCardOptions` 三个真业务动作，钱这一层零替身；零 provider 调用、零真实花费）。对应用例名：`克隆卡上改一格(Change something)再批准 ⇒ 新单、键是 cowork:<新卡 id>、恰好一行 RESERVE,原退款不动`、`顺序连按两次 ⇒ 拿回同一单,账本只有一行 RESERVE`、`第一单已经 DONE 之后再按 ⇒ 还是拿回那一单,不是第二次购买(卡键是全状态唯一的)`、`并发双击(两个请求同时在飞)⇒ 仍然一单一扣 —— 全状态唯一索引是兜底`。逐条验收与红→绿实证见 `docs/specs/money-engine.md` §5 2026-09-18 行。 |
| REAL-09 | EXT-05 EXT-12 EXT-10 | 两商家长视频和短任务同时运行 | NOT RUN | [步骤](real-scenarios.md#real-09-商家场景两商家长视频和短任务同时运行) |
| REAL-10 | EXT-05 EXT-11 | 匿名客户看预览但拿不到别家内容 | BLOCKED | staging 第三轮付费旅程第四组（2026-09-17，build `c0d25917`）：两个独立阻断均已复核——①全部 8 个组织零 `ScheduledPost` 行，且本 build 无商家排期入口（`/schedule` 307 回 Home、无导航项、无 `apps/web/app/schedule/page.tsx`；唯一路径是 Otto 的 `sharePostPreview` 技能）；②即便有排期，staging `web` 与 `worker` 两个服务均未设置 `MEDIA_PROXY_SECRET`／`SHARE_PREVIEW_SECRET`（各查 53／31 个变量名，逐一确认不存在）。核证员独立复核并追加第三个阻断——见 R3-F31：即便前两项补齐，`/s/<token>` 在 staging 会把客户 303 到 `localhost:8080`，分享链接对客户端到端仍会失败。脱离分享链即可验证的条款均已证成：账本无新增（264/181 行前后不变，余额 99997621 不变）、匿名读其他租户资源 404（`/api/media/pub/<tenant-B>` 与伪造 token 同一个 404、`/files/u/<tenant-B>/…` 匿名读被弹回 `/login`）、fail-closed 页面文案（`This preview isn't available`，与过期／伪造无从区分）。**未证**：`SHARE-A10`（拿 owner A 的媒体 token 改指 owner B 的 key）——观察到的 404 证明的是「密钥未配置」分支先于 `keyOwnerMatches` 归属复核触发，不是签名跨租户改指被挡下，该分句在 staging 无法验证。证据：[步骤](real-scenarios.md#real-10-商家场景匿名客户看预览但拿不到别家内容)、`local-logs/staging-r3-paid/real-10-share-anon.json` 全部步骤、`workflow-groups2-4-result.json` `verdicts[2]`。 |
| REAL-11 | EXT-11 EXT-13 | 撤销分享后旧页面和媒体立即失效 | BLOCKED | staging 第三轮付费旅程第四组（2026-09-17，build `c0d25917`）：本组未为本行单独派工——核证员指出 REAL-11（Revoke 后旧页面与媒体立即失效）与 REAL-10 卡在同一堵墙（零 `ScheduledPost` ＋两把分享密钥缺失），在 REAL-10 未解锁前 REAL-11 同样不可达，直接按同一阻断原因标 BLOCKED，避免另派一组重复撞同一堵墙。解锁条件：staging `web`／`worker` 两服务补齐 `MEDIA_PROXY_SECRET`／`SHARE_PREVIEW_SECRET`、至少一条 `ScheduledPost` 存在、且 R3-F31（`/s/<token>` 303 到 `localhost:8080`）已修。证据：`workflow-groups2-4-result.json` `verdicts[2].findings`（末条）。 |
| REAL-12 | EXT-07 EXT-10 | 上传自有文件并取回真实字节 | PARTIAL | staging 第三轮付费旅程第一组（2026-09-16，build `eed4f079`→`57ce7ee6` 部署漂移期间，见下方 P0／BUILD-DRIFT 登记）：PNG／JPEG／MP4 三份真实夹具（本地先记 sha256／尺寸／时长）经产品自身上传入口上传，服务端 `ingest.ts` re-hash 存活确认存储字节与本地 sha256 逐一相等（3/4；第 4 份是取证工具字符串截断产生的意外损坏 JPEG，无本地原件可比对，另登 R3-F23）；理解未在结算前写成免费（`AssetUnderstanding.priceInternalSnapshot=1` 先于 RESERVE/SETTLE 写入）；`/billing` 披露价与实扣价一致（0.1 credits／文件），供应商账单（arkcli `usage stats`）与产品自身 token 记录逐字段对齐。**未达成**：「下载到本地、逐字节比对」——产品媒体 URL 跨域 302 重定向到对象存储，页面 CSP 拒绝跟随（`opaqueredirect`），沙盒内浏览器亦不支持真实下载，此步骤被沙盒挡住而非被产品挡住；`real-scenarios.md:141-142` 的「下载到本地」「原样下载应同哈希」两句逐字未闭合，故整行 PARTIAL、不进 PASS。证据：[步骤](real-scenarios.md#real-12-商家场景上传自有文件并取回真实字节)、`local-logs/staging-r3-paid/preflight-fixtures.json`（步骤 R12-1 至 R12-8）、`workflow-group1-result.json` 的 `verdicts[0].moneyProof`（逐 refId 账本核对）。 |
| REAL-13 | EXT-05 EXT-11 | 两个账户隔离与后台权限 | PARTIAL | staging第二轮（2026-09-15）：TENANT-A2读方向四条B深链全部诚实拒绝（canvas/library/files/brand），零跨租户数据、双边零新增行；核证收窄范围——FRONT-A6分句无收据被撤销（B org今日零Collection行，取的是生成资产深链而非collection，DB核实A_collections1/B_collections0）；TENANT-A2写方向（改名/删除）与反向（拿A链接当B打开）今日不可达（写被禁、无B会话）。历史ledger34后台面证据仍并入REAL-28。 |
| REAL-14 | EXT-01 | 手机完整找回作品 | PARTIAL | staging第二轮（2026-09-15）量化desktop-only代价：375×812下导航栏仍展开240px（占屏64%）、main仅125px、无横向滚动可达被裁内容，控件被从中截断（"Generation his…"等），26张结果卡缩到7×8–7×11px；已存rail偏好（localStorage fikirtive:nav-rail:v1）使「首次无偏好加载」问题仍待验，键盘激活折叠会覆盖Founder已存偏好故未测。仍是desktop-only批准范围内的探索（wave2-shell.md:403）。 |
| REAL-15 | EXT-02 | 大屏操作同一画布 | PARTIAL | staging第二轮（2026-09-15）：六个overlay两两配对检测零重叠（节点工具条/手型选择列/缩放簇/对话面板/输入框/积分徽章）；但未测overlay-vs-卡片，且未按"Fit to screen"——frontend-baseline.md:102③记录的历史缺陷（Fit to screen后卡片被45%/32%/42%遮挡、点击误触发Otto说明行）正是本轮未覆盖的场景，"零重叠"只证明overlay彼此不撞，不证明1440/1920下工作区可用。 |
| REAL-16 | EXT-03 EXT-04 | 只用键盘完成安全路径 | BLOCKED | staging第二轮（2026-09-15）：键盘REACH成立（Tab顺序完整、可到达每个控件），但键盘ACTIVATION本轮工具无法注入——Browser pane只派发keydown不触发原生默认动作（capture阶段监听证实Backspace/Enter/Escape到达焦点输入框但value不变），"Tab到卡片→Enter→Escape"未能用键盘真正跑通；改用鼠标复现了R3-F05（Library对话框Escape后焦点掉到BODY，Connections对话框正确归位）。诚实状态是BLOCKED，不是PARTIAL——工具能力缺口，非产品判定。 |
| REAL-17 | EXT-04 | 读屏与200%放大检查 | BLOCKED | staging第二轮（2026-09-15）：本轮用document.body.style.zoom='2'不是真浏览器缩放（真缩放会收缩CSS视口至约640px并重新求值media query、触发reflow，而不是缩放进一个被裁切的框）；worker自己点出这一点后仍把"无横向滚动"记成PROVEN，属代理假象。Browser pane不支持真实cmd+=/ctrl+-缩放，诚实状态是BLOCKED；本可换用resize_window到640×360模拟200%但本轮未做。读屏NOT RUN（如实未跑）。 |
| REAL-18 | EXT-06 | 空库迁移及备份恢复 | NOT RUN | [步骤](real-scenarios.md#real-18-商家场景空库迁移及备份恢复) |
| REAL-19 | EXT-07 | 当前备份复制核验与既有恢复证据 | NOT RUN | [步骤](real-scenarios.md#real-19-商家场景当前备份复制核验与既有恢复证据) |
| REAL-20 | EXT-08 | 同一批花费四本记录对齐 | PASS | staging 第三轮付费旅程第二组（2026-09-17，build `c0d25917`）取代此前本地 mock 记录，四本账首次全部对齐：Book1 确认卡「About 11 credits」／「Generate · 11 credits」；Book2 账本 `RESERVE -110/+110` + `SETTLE 0/-110`（视频）与 `RESERVE -40/+40` + `SETTLE +18/-40`（聊天），零 REFUND、零悬挂预留；Book3 余额 `99997974`→`99997842`（-132 minor units = 110 视频 + 22 聊天），reserved 归零；Book4a `GenJob.spentUsd=0.38038218749999997`、`billedUnits=108900`。**Book4b（供应商实际账单）由核证员补上、worker 自报的 PARTIAL 因此升级为 PASS**：worker 当场查 `arkcli usage stats` 得零记录，10 分钟后核证员重查拿到 1 条记录——`ModelName dreamina-seedance-2-0-mini`、`Hour` 落在该单实际提交的那个小时、`ReqCnt 1`、`TotalTokens 108900`，与 `GenJob.billedUnits` 逐位相等；`ReqCnt 1` 同时证明供应商侧只收到一次调用（无双扣）。worker 的空结果是 arkcli usage 5–30 分钟查询延迟的假象，不是真实缺口——规格 REAL-20 预期原文本就允许「未拿到供应商实际账单标未知」，本组把这一未知也填上了。证据：[步骤](real-scenarios.md#real-20-商家场景同一批花费四本记录对齐)、`local-logs/staging-r3-paid/real-03-person-video.json` 步骤 S06、S09、S13、S18；`workflow-groups2-4-result.json` `verdicts[0].findings[0]`。 |
| REAL-21 | EXT-09 | 真实收码耗时与受控并发登录 | NOT RUN | [步骤](real-scenarios.md#real-21-商家场景真实收码耗时与受控并发登录) |
| REAL-22 | EXT-10 | 连接状态与停放排期入口 | PASS | staging第二轮（2026-09-15）：Checking（各服务"Status unavailable"+Retry status）→2秒内落定"Nothing connected"（IG/FB "Not connected"、X "Unavailable"）→7秒稳定；"Add connection"对话框可开、Escape可关且焦点正确回到触发按钮；"View X connection"显示服务不可用、无Connect按钮；全程未点Connect。新发现R3-F14另行登记：wave2-shell.md:394-395要求的顶部一句"IG/FB暂不可连接"实话提示，apps/web全文找不到，与本行验收分句无关，按冻结规格条款未实现单独待裁。 |
| REAL-23 | EXT-11 | 会话退出与旧入口 | PARTIAL | staging第二轮（2026-09-15）：SIGNIN-A4三条分句全PASS——/signup、/forgot-password、/reset-password三处地址匿名curl均308→/login，登录态下三处字节级落在Home（与已登录访客访问/login同一结果）；/login页面markup只有"Continue with Google"/"Continue with email"，零password输入框/Forgot/Sign up/Create account字样；7个规格点名端点加/verify-password、/admin/set-user-password、/admin/create-user、`/reset-password/<token>`、三个email-otp端点共14条路径28次请求全404，对照POST /sign-in/email-otp成功返回400说明路由本身是活的；SIGNIN-A11"没有任何途径能建立密码"在本session能达到的面全部成立，可由server.ts:197 emailAndPassword:{enabled:false}加围栏测试补证。sign-out步骤按指示NOT RUN（保留会话，未点击Sign out）；SIGNIN-A11未做穷举式扫描（只扫了14条named/derived better-auth路径）。 |
| REAL-24 | EXT-12 | 真实慢网观察和客户端离线重连 | NOT RUN | staging 第三轮付费旅程第二组（2026-09-17，build `c0d25917`）确认为工具缺口、非跳过：in-app 浏览器工具集没有网络状态／离线切换动作，本组指令列表里也没有可替代的步骤，如实标 NOT RUN，不伪造离线体验。证据：`local-logs/staging-r3-paid/real-03-person-video.json` `verdicts[3]`。 |
| REAL-25 | EXT-13 | 正式核心页逐页四态和深链 | PASS | staging第二轮（2026-09-15）：9个核心面（/、/create、/library、/brand、/billing、/profile、/settings、/settings/connections、Hi!画布）登录态全部新标签直开即落自身、零跳转；每页零个≥400状态的同源资源请求（PerformanceResourceTiming，每页14–73个资源）；空态文案已采（Home营销数据、Brand"Nothing in brand voice yet"、Library"No result for…"、Billing"Nothing on hold"）。核证补充边界：跨域且无Timing-Allow-Origin的资源会把responseStatus记成0而非真实状态，文档本身响应不算资源条目——读作"零同源资源失败"而非"零≥400请求"，量级下不足以降级。错误态未自然出现，NOT RUN。 |
| REAL-26 | EXT-13 | Campaign与Schedule旧入口停放 | PARTIAL | staging第二轮（2026-09-15）：OTTO_VIEW_KEYS 11个视图键（otto-view-param.ts:13-16）全部探测、逐一落到navigation.ts:370-389经SHELL_ROUTES解析的正确目的地，无第12个键，覆盖完整（本半PASS）；但MERCHANT_NAV_REDIRECTS六条旧地址中/schedule、/schedule/analytics、/library/editor在HTTP层实测回200再由客户端redirect()，不是wave2-shell.md:188要求的"一律307"（新发现R3-F10，根因是各自旁挂了loading.tsx），故整体降级为PARTIAL；另三条（/campaign/calendar、/campaign、/crm）在layout层真307。商家侧落点全部正确，差异是机器可见层面。 |
| REAL-27 | EXT-13 | 退役CRM与Otto旧书签 | PASS | staging第二轮（2026-09-15）：旧版Otto深链/otto?project=&thread=最终落到/?otto=1&project=…&thread=…且参数保留，面板确实打开对应画布/线程（Home头"Canvas · Hi!"+线程chip"Cat drinking coffee video"）；DB层交叉核实thread标题与projectId与页面所见完全一致，比worker自己的读法更强。新发现R3-F11另行登记（不计入本行分句失败）：/crm/anything落到裸Next.js 404、无导航壳无回路，本行验收分句只承诺/crm本身重定向，未点名任意子路径。 |
| REAL-28 | EXT-13 EXT-05 | 后台只读运营面 | BLOCKED | staging第二轮（2026-09-15）：正控成立——super-admin staff帧能读全部六个运营面（/admin、/admin/money、/admin/tenants、/admin/queue、/admin/reconcile、/admin/audit），未记录任何租户邮箱、未点mint/adjust/refund/retry/clear任何控件。但TENANT-A6验收原文要求的"发一次积分、退一次款、跑一次对账"三个动作全部是写，被本轮零写入边界禁止；核证明确推翻worker自报的PARTIAL——零个TENANT-A6子分句真正落地，PARTIAL意味着"验收行部分兑现"，而这里一条都没兑现，诚实状态是BLOCKED（零写边界结构性挡住，不是产品缺陷）。/api/ops/dlq证据被核证剔除：该端点本就免鉴权（proxy.ts matcher排除，同/api/health），匿名curl拿到同一个503，证明不了staff帧或super-admin权限。 |
| REAL-29 | EXT-06 EXT-12 | 故障与恢复隔离验证 | NOT RUN | [步骤](real-scenarios.md#real-29-商家场景故障与恢复隔离验证) |
| REAL-30 | EXT-01 EXT-02 EXT-04 | 关键确认页跨设备对照 | PARTIAL | staging第二轮（2026-09-15）曾以「1280×720 与 1920×1080 两个视口逐项比对完全一致」判 PASS（5 张待批确认卡数量/尺寸/余额/按钮文案四项全同）——该轮同样只测了桌面与大屏，未测手机，但当时未把缺一态计入判定。staging 第三轮付费旅程第二组（2026-09-17，build `c0d25917`）用一张真实的付费未批准确认卡重复同一比对，逐字节一致（引用数「Uses 3 of your reference photos」、规格「16:9 / 5s / 720p / No sound」、`About 11 credits`、按钮「Generate · 11 credits」四项在 1280 与 1920 下完全相同），切换视口不产生新意图（`GenJob` 计数切换前后均为 0），批准后可见结果与账本核对上（11 credits = 110 minor units，RESERVE/SETTLE 精确匹配）。规格原文 `real-scenarios.md:320-321` 明写要在「手机/桌面/大屏」三态查看，本组指令范围仍只到桌面/大屏，手机腿未执行——按验收行字面收紧，本次改判 PARTIAL，以本轮判定为准（第二轮的 PASS 在同一缺口下未收紧，视为历史记录而非现行状态）。证据：[步骤](real-scenarios.md#real-30-商家场景关键确认页跨设备对照)、`local-logs/staging-r3-paid/real-03-person-video.json` 步骤 S07–S09、`verdicts[2]`。 |

| REAL-31 | EXT-13 EXT-11 | 账户菜单与个人资料身份一致 | PASS | staging第二轮（2026-09-15）判定R3-F01为RESOLVED、工具取证假象而非产品缺陷：四次独立读取（首次加载/刷新/新标签/离开再返回）/profile的#profile-email DOM value均为17字符、非空、与账户邮箱一致；根因是浏览器工具的无障碍树read_page从不打印input的value（对Display name输入框同样如此，DOM与截图均能证实非空），并非应用清空了邮箱。本条不牵涉规格分句，关掉的是取证方法问题。 |

## 计数

65行历史基线＋59行新增规格＋13组范围索引＋31项可执行子检查。原65基线目前7行PARTIAL、1行FAIL、57行NOT RUN；扩展组和真实子检查已有部分回填，详见各行；13组索引不与子检查混算，59行验收与真实旅程也存在交叉。不得声称总行数等于独立测试用例或计算混合通过率。

### 本次回填边界（2026-09-14）

仅回填上述5条原基线中的实际分句；没有新增任何整条PASS。FAIL为Library侧编辑入口经现场和当前代码确认缺失，不是未执行即FAIL。创建无图、未Send、未删除、未换主图均保留未验。

原图导出追加：R2-18只到原始字节取回/尺寸/哈希，Download按钮路径未验证，保持PARTIAL；自动验证仍运行，不据阶段摘要宣告全绿。

证据同步：Profile截图正常，BASE-52不计产品FAIL；手机仍desktop-only批准范围下探索；没有新增整条PASS。实际消费0美元，环境例外待用户回答，自动quality初轮DB3失败并继续后续验证，不能宣称全绿。

FRONT-A11分句补证（不增加原65行、不计整条PASS）：个人显示名临时保存/刷新保持及恢复原名/刷新保持均已验（run-ledger27–29和最终复核）；工作区名称、充值包与结账等完整分句未执行。

路由更正：Campaign/Schedule根入口本轮已实测回Home，见REAL-22/26；CRM/Otto其余映射不借此判已测。连接弹窗Escape后焦点回Add connection已证，不能替代Asset details焦点回归。无外连、新业务写入或付费。

工作区补证（ledger33）：3空格和仅原名前后空格均Save disabled，最后还原原名；未Save，无工作区写入。仅校验窄断言成立，FRONT-A11完整验收仍未通过。

本地链路与真实验收分界：mock供应商、预制Otto卡的真实入队/独立worker/落文件/账本证据仅加入适用扩展PARTIAL。原页收敛断言未跑，后续只读重开成功不补成该断言PASS；所有真实供应商交付行保持原状态，不新增PASS。

### 本次回填边界（2026-09-15）

staging第二轮（登录态只读旅程）：build `14bcd038`，以Founder org `founder`（租户A，super-admin）已登录会话跑4个并行worker，全程未登出、US$0、零远端写入——只读证明见`docs/audits/fullstack-staging-2026-09-14/local-logs/staging-r2/workflow-r2-result.json`的`result.results[1].writesMade`（自2026-09-15 03:55 UTC起CreditLedger/GenJob/Generation/ChatMessage/CanvasNode/Project/ChatThread零新增或更新行；CreditAccount(founder)余额与更新时间未变）。

以上REAL-05/08/13/14/15/16/17/22/23/25/26/27/28/30/31共十五行的状态与证据已按本轮独立核证员（`result.verdicts[*]`）的最终裁定回填，裁定推翻了worker自报的若干条：REAL-26自报PASS降PARTIAL（wave2-shell.md:188"一律307"与实测不符，见R3-F10）、REAL-15自报PASS降PARTIAL（overlay-vs-卡片与Fit to screen未测）、REAL-17自报PARTIAL收紧到BLOCKED（zoom代理法不是真缩放）、REAL-28自报PARTIAL收紧到BLOCKED（TENANT-A6三个子分句零兑现，被写边界结构性挡住）、REAL-05的"Enter绝不自动触发"分句被推翻（StartSomething.tsx:288-294，本轮真实花钱风险）、REAL-08的"FSE-204商家侧仍未闭合"分句被推翻（修复commit 6624e832先于证据引用的那单）、REAL-13的FRONT-A6分句被撤销（B org今日零Collection行，无该分句的攻击面可测）。本节只回填这十五行，不新增本轮未触达的其余行，也不据此宣告全绿。新发现七条（R3-F09–R3-F15）与两条既有发现的收尾更新（R3-F01 RESOLVED、R3-F05复现并定根因）另行登记在`findings-catalog.md`，本处不重复列出。

### 本次回填边界（2026-09-16，staging 第三轮付费旅程第一组）

来源：Founder 2026-09-15 授权的真实付费旅程（US$20 封顶、累计 US$16 暂停），第一组「preflight-fixtures」，两个 worker（执行 + 核证）串行跑完，证据入库 `docs/audits/fullstack-staging-2026-09-14/local-logs/staging-r3-paid/{preflight-fixtures.json,workflow-group1-result.json}`。

- **P0＝PASS**：build sha 在预检时两处独立确认为 `eed4f079`（`/api/health` 与账号菜单页脚），worker 角色（worker-compute up、worker-wait up、`worker` 报 `stale`——该行截至此刻尚未随 R3-F19 修复重新拉起，见下）、db up、migrations applied、backup fresh 均有回执；身份、`/billing` 余额基线（9,999,797.8 credits，reserved=0）、DB 基线（founder 155 条既有账本行、GenJob/RefGenJob 24 小时冻结供应商支出 US$0）、arkcli 登录态与当日零用量基线全部留证。
- **REAL-12＝PARTIAL**：回填见上方本表 REAL-12 行；4 份上传、理解结算、账本闭环均证成，3/4 文件本地 sha256 与存储 `contentHash` 逐一相等，「下载比对」被浏览器 CSP／沙盒挡住（非产品挡）未闭合。
- **REAL-03＝NOT RUN（本组）**：回填见上方本表 REAL-03 行；R3-F20 指路死路是唯一阻断因素，付费组待修复 PR #1463 合并或另行授权后重跑，不占用本组预算继续硬闯。
- **BUILD-DRIFT＝已登记，非本组可关闭项**：本组执行窗口内（2026-09-16 12:48–13:50 UTC）staging 自动重部署**四次**——`eed4f079`（预检时）→`4496bc3b`（PR #1460，~13:13Z）→`57ce7ee6`（PR #1455，~13:24Z）→`1a03bb71`（PR #1456，~13:39Z，核证员事后用未认证 `GET /api/health` 复核到，执行 worker 原报告只记到前两跳、遗漏第三跳），期间一度整页空白（redeploy 重启窗口）。三张图片上传（12:55–13:02Z）可回溯归属 `eed4f079`；MP4 上传（13:35Z）已在 `57ce7ee6` 之上。该组本身的证据不因漂移而失效（每笔操作已按时间戳回溯到具体 sha），但任何**后续付费组**若不先钉住主干或重新以当前 sha 定基线，会在不知情的情况下悄悄测到另一个 build——第二至第四组安排在主干短暂静默期执行，或每组开跑前重新核 `/api/health` 的 sha 并把它写进该组证据文件。
- **Money proof（本组账本，逐笔核过，无一笔例外）**：全天（2026-09-16）`CreditLedger` 恰好新增 8 行，4 组 RESERVE+SETTLE 配对，每个 `refId`（`understanding:<AssetUnderstanding.id>`）都恰好 1 条 RESERVE + 1 条 SETTLE + 0 条 REFUND，`balanceDelta` 净 -1／`reservedDelta` 净 0；结构性防重放由两条唯一索引担保——`CreditLedger_ref_kind_once`（`UNIQUE(orgId, refId, kind) WHERE refId IS NOT NULL`）与 `CreditLedger_finalizer_once`（`UNIQUE(orgId, refId) WHERE kind IN (SETTLE, REFUND)`），另有 `Asset_ownerId_contentHash_key` 与 `AssetUnderstanding_ownerId_assetId_kind_key` 保证同字节重传不会被二次计费（本组一次意外的重复上传验证了这一点：产生了第 5 条 `Generation`／`ActionEvent` 但零新增 `Asset`／计费行）。`CreditAccount(founder)` 余额 `99997978`→`99997974`（内部单位，= 9,999,797.8 → 9,999,797.4 显示 credits，恰好 -0.4）；`reserved` 全程归零，无悬挂预留。供应商侧核对：`arkcli usage stats` 当日汇总 4 请求／9308 input token／196 output token／单一模型 `seed-2-0-mini`，与产品自身 `UnderstandingSpendDay` 行、及四条 `AssetUnderstanding` 逐行 token 记录（926+860+860+6662 in、57+24+69+46 out）逐字段吻合。
- **本组花费**：US$0.00 生成（全程零 `GenJob`／`RefGenJob` 新增行，24 小时冻结供应商支出未变）＋ 0.4 显示 credits 理解（内部记账，非直接美元支出）；累计仍远低于 US$16 暂停线，US$20 封顶完整保留给后续付费组。
- **第二至第四组**：待跑（NOT RUN，占位）——依 `plan.md` 首批顺序，下一组覆盖 REAL-03（待 R3-F20 修复或授权解锁）／REAL-04／REAL-06／REAL-08，随后 REAL-09（四长一短并发，需整组报价确认在预算内才执行）。

### 本次回填边界（2026-09-17，staging 第三轮付费旅程第二至第四组）

来源：PR #1463（R3-F20 修复）与 #1464（上传回执）合并后，main = `c0d25917`；3 名 journeys worker + 3 名独立 verifier 串行跑完第二至第四组，证据入库 `local-logs/staging-r3-paid/{real-03-person-video.json,real-04-06-08.json,real-10-share-anon.json,workflow-groups2-4-result.json}`。本表上方 REAL-03／04／06／07／08／10／11／20／24／30 十行的状态与证据已按本轮独立核证员（`workflow-groups2-4-result.json` 的 `result.verdicts[*]`）的最终裁定回填；两处 worker 自报被核证改判——REAL-07 由自报 PASS 降为 PARTIAL（深链与第二标签两腿均在终态之后才验证，未在飞证实），REAL-20 由自报 PARTIAL 升为 PASS（核证员 10 分钟后重查 `arkcli usage stats` 补齐 worker 当场查到的空记录）；REAL-30 本次按验收行「手机/桌面/大屏」三态字面收紧为 PARTIAL，与第二轮同一缺口下曾判 PASS 的历史记录并存说明，以本轮为准。本节只回填这十行，不新增本轮未触达的其余行。

**Money proof（三组逐笔核过，无一笔例外）**：第二组（`real-03-person-video`）US$0.380（1 段视频 11 credits + 1 轮聊天 2.2 credits），窗口内 `CreditLedger` 恰 4 行（2 组 RESERVE+SETTLE），零 REFUND；第三组（`real-04-06-08`）US$0.485（1 段视频 11 + 1 张图 1 + 1 张 variation 1 + 1 次 Regenerate 1 + 3 轮聊天合计 8.1 credits），窗口内 14 行，`sum(balanceDelta) = -221`、`sum(reservedDelta) = 0`，4 组 RESERVE/SETTLE 配对、零 REFUND、零悬挂预留、零重复结算；第四组（`real-10-share-anon`）US$0，窗口内零新增账本行、零新增 `GenJob`／`ScheduledPost`。三组合计 US$0.865764375（四舍五入 US$0.87），远低于 US$16 暂停线，US$20 封顶完整保留。三组「禁写」扫描（`Organization`／`Membership`／`BrandKit`／`ChannelConnection`／`MetaConnection`／`RuntimeConfig`／`AllowedEmail`／`ScheduledPost` 等敏感表列）均为零，无一笔越权写入；`arkcli usage stats` 交叉核对第二组的视频单（`ReqCnt 1`、`TotalTokens 108900` = `GenJob.billedUnits`），第三组因 SSO 到期未能交叉核对（记为未知，非估算）。arkcli 开跑前花费快照存放编排者 session 本地路径 `reports/ark-spend/before-groups2-4-20260917T042559Z.json`，**session-local，未入库**。

**新发现（另登 `findings-catalog.md`）**：R3-F25（画布拖放上传延迟入队，补登记编号）、R3-F26（P2，文生视频提示词声称有首帧但该单确无首帧）、R3-F27（客户端 Back 后 Otto 面板空 40–60 秒）、R3-F28（P1，第二标签重放或确认 variations 把画布撞进错误边界）、R3-F29（失败卡 Try again 零反馈致四次克隆，代码注释自相矛盾）、R3-F30（派生图 variation／Regenerate 两条路径 `entitySnapshot` 均为空）、R3-F31（P1，`/s/<token>` 在 staging 303 到 `localhost:8080`）、R3-F32（旧式 `?t=` 链接令牌留在地址栏约 1 秒）。

**第五组（REAL-09，四长一短并发）**：仍待跑——需整组报价确认在预算内才执行，本轮未派工。
