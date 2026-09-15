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
| TENANT-A3 | 对已落闸的面发起一次无帧调用，并单独喂一次 `{ ownerId: { not: "" } }` 形状的 where | 两次都被拒（无帧即拒）；伪造过滤器不再过关 | [规格:53](../../specs/tenant-isolation.md#L53) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| TENANT-A4 | **钱守恒**：跨租户伪造一次充值确认、一次扣费、一次退款；再用同租户正常扣费一次并重放同一幂等键 | 三次越权全失败，两边 CreditLedger 余额与流水行数分毫未变；正常扣费恰好一笔，重放不产生第二笔 | [规格:54](../../specs/tenant-isolation.md#L54) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| TENANT-A5 | 每片落闸后走一遍该面的完整商家旅程（钱面：充值→扣费→退款；动作面：建项目→生成→排期；CRM 面：建客户→跟进） | 全程零 500、零新错误；与落闸前同结果 | [规格:55](../../specs/tenant-isolation.md#L55) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| TENANT-A6 | 后台员工发一次积分、退一次款、跑一次对账 | 三次都在 staff 帧内发生，审计行的操作者与目标租户由帧带出；跨租户铸币仍要求 `requireRole("tenants","mutate")` 才放行 | [规格:56](../../specs/tenant-isolation.md#L56) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| TENANT-A7 | 在全新数据库上跑完全部迁移，然后尝试把 A 租户的子行挂到 B 租户的父行 | 迁移零错误；跨租户挂接被数据库直接拒绝（不靠应用层） | [规格:57](../../specs/tenant-isolation.md#L57) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
| TENANT-A8 | 跑 7 条队列各一单（caption / gen / ingest / publish / refgen / render / research） | 7 条全部跑通；帧建立之后该单的所有后续读写都经过值比对（用一次异租户 id 注入证明会被拒） | [规格:58](../../specs/tenant-isolation.md#L58) | NOT RUN | 待本轮执行或关联已核验的同版自动测试；真实环境部分另留回执 |
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
| REAL-03 | EXT-10 EXT-08 | 品牌商品从首页到人物视频 | NOT RUN | [步骤](real-scenarios.md#real-03-商家场景品牌商品从首页到人物视频) |
| REAL-04 | EXT-10 EXT-08 | 不带人物的创作和 variation | NOT RUN | [步骤](real-scenarios.md#real-04-商家场景不带人物的创作和 variation) |
| REAL-05 | EXT-03 EXT-01 | 中文组合输入与英文提交 | NOT RUN | [步骤](real-scenarios.md#real-05-商家场景中文组合输入与英文提交) |
| REAL-06 | EXT-05 EXT-12 | 多标签同一次提交不重复收费 | NOT RUN | [步骤](real-scenarios.md#real-06-商家场景多标签同一次提交不重复收费) |
| REAL-07 | EXT-12 EXT-02 | 付费后刷新、离页和回来 | NOT RUN | [步骤](real-scenarios.md#real-07-商家场景付费后刷新、离页和回来) |
| REAL-08 | EXT-12 EXT-10 | 真实失败之后编辑重试 | NOT RUN | [步骤](real-scenarios.md#real-08-商家场景真实失败之后编辑重试) |
| REAL-09 | EXT-05 EXT-12 EXT-10 | 两商家长视频和短任务同时运行 | NOT RUN | [步骤](real-scenarios.md#real-09-商家场景两商家长视频和短任务同时运行) |
| REAL-10 | EXT-05 EXT-11 | 匿名客户看预览但拿不到别家内容 | NOT RUN | [步骤](real-scenarios.md#real-10-商家场景匿名客户看预览但拿不到别家内容) |
| REAL-11 | EXT-11 EXT-13 | 撤销分享后旧页面和媒体立即失效 | NOT RUN | [步骤](real-scenarios.md#real-11-商家场景撤销分享后旧页面和媒体立即失效) |
| REAL-12 | EXT-07 EXT-10 | 上传自有文件并取回真实字节 | NOT RUN | [步骤](real-scenarios.md#real-12-商家场景上传自有文件并取回真实字节) |
| REAL-13 | EXT-05 EXT-11 | 两个账户隔离与后台权限 | PARTIAL | ledger34：既有商家访问/admin/money及/admin/tenants均回Home无后台数据；admin/layout.tsx外层拒绝。未合法staff对照、未所有API/双租户矩阵，不改角色。 |
| REAL-14 | EXT-01 | 手机完整找回作品 | PARTIAL | ledger09窄视口Library与reload，存在裁切；手机登录/下载/软键盘未验；desktop-only批准下的探索。 |
| REAL-15 | EXT-02 | 大屏操作同一画布 | NOT RUN | [步骤](real-scenarios.md#real-15-商家场景大屏操作同一画布) |
| REAL-16 | EXT-03 EXT-04 | 只用键盘完成安全路径 | PARTIAL | ledger05/07/08/12：键盘打开详情、关闭、清筛、进Brand；焦点回归及全安全路径未证。 |
| REAL-17 | EXT-04 | 读屏与200%放大检查 | NOT RUN | [步骤](real-scenarios.md#real-17-商家场景读屏与200%放大检查) |
| REAL-18 | EXT-06 | 空库迁移及备份恢复 | NOT RUN | [步骤](real-scenarios.md#real-18-商家场景空库迁移及备份恢复) |
| REAL-19 | EXT-07 | 当前备份复制核验与既有恢复证据 | NOT RUN | [步骤](real-scenarios.md#real-19-商家场景当前备份复制核验与既有恢复证据) |
| REAL-20 | EXT-08 | 同一批花费四本记录对齐 | PARTIAL | [步骤](real-scenarios.md#real-20-商家场景同一批花费四本记录对齐) 本地mock账额100→99credits，结算释放hold不再扣款；临时runner错误断言导致exit1，非产品钱路FAIL；真实成本回执未验。 详见run-ledger本地追加。 |
| REAL-21 | EXT-09 | 真实收码耗时与受控并发登录 | NOT RUN | [步骤](real-scenarios.md#real-21-商家场景真实收码耗时与受控并发登录) |
| REAL-22 | EXT-10 | 连接状态与停放排期入口 | PARTIAL | ledger30–32：Checking→Nothing connected，IG/FB Not connected、X Unavailable且无Connect；Escape焦点回Add connection；/schedule回Home。未Connect，连接生命周期未验。 |
| REAL-23 | EXT-11 | 会话退出与旧入口 | NOT RUN | [步骤](real-scenarios.md#real-23-商家场景会话退出与旧入口) |
| REAL-24 | EXT-12 | 真实慢网观察和客户端离线重连 | NOT RUN | [步骤](real-scenarios.md#real-24-商家场景真实慢网观察和客户端离线重连) |
| REAL-25 | EXT-13 | 正式核心页逐页四态和深链 | PARTIAL | ledger核心页面与23–25历史深链已有部分；未每页四态。 |
| REAL-26 | EXT-13 | Campaign与Schedule旧入口停放 | PARTIAL | ledger32两个根地址均最终/及Home；符合navigation:311–323与父layout/page重定向。非正式排期/Campaign取数验收；子路由未全测。 |
| REAL-27 | EXT-13 | 退役CRM与Otto旧书签 | NOT RUN | [步骤](real-scenarios.md#real-27-商家场景退役CRM与Otto旧书签) |
| REAL-28 | EXT-13 EXT-05 | 后台只读运营面 | PARTIAL | ledger34：既有商家访问/admin/money及/admin/tenants均回Home无后台数据；admin/layout.tsx外层拒绝。未合法staff对照、未所有API/双租户矩阵，不改角色。 |
| REAL-29 | EXT-06 EXT-12 | 故障与恢复隔离验证 | NOT RUN | [步骤](real-scenarios.md#real-29-商家场景故障与恢复隔离验证) |
| REAL-30 | EXT-01 EXT-02 EXT-04 | 关键确认页跨设备对照 | NOT RUN | [步骤](real-scenarios.md#real-30-商家场景关键确认页跨设备对照) |

| REAL-31 | EXT-13 EXT-11 | 账户菜单与个人资料身份一致 | PARTIAL | ledger03/11截图显示邮箱一致；27–29临时改名与恢复均刷新持久，末次Billing不变；菜单即时旧名R3-F04，邮箱DOM矛盾未定位，仍PARTIAL。 |

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
