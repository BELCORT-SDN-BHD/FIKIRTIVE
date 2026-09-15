# 第三轮真实 staging 执行记录

日期：2026-09-14。产品代码：`14bcd038`。环境：`https://web-staging-7901.up.railway.app`。执行：主线程独占浏览器；本文件由证据整理 worker 根据主线程转交的本轮工具事实编录，未独立重放操作。

使用既有 `E2E Café tester 中文` 会话；邮箱只记「测试邮箱（已掩码）」。没有记录一次性码、cookie或分享token。具体时分秒未随事实提供，不补造时间戳。

**本记录是已执行步骤，不是整条规格PASS。** 截图已经显示在本轮工具输出，但未提供本地截图路径，因此不声称已落盘或编造文件链接。环境前置见 [preflight.md](preflight.md)，问题与证据矛盾见 [findings-catalog.md](findings-catalog.md)。

## 执行顺序

| 序号 | 操作与可核验现场 | 本步骤结论与边界 |
|---|---|---|
| 01 | 打开 `/login`，自动进入Home；已有会话仍有效 | 证明已有会话可进入首页；没有输入邮箱、收码或走Google，不算新登录或任何完整登录验收通过 |
| 02 | 打开Account菜单；显示测试邮箱（掩码）与build `14bcd038` | 记录当前菜单身份显示和版本；未独立查询身份数据库 |
| 03 | 进入Profile，DOM snapshot／value读取曾返回空字符串；之后截图视觉核验，disabled Email清楚显示同一测试邮箱 | 证据矛盾，不能判“商家看到空邮箱”；后续视觉证据显示邮箱正常。见R3-F01，不计产品FAIL |
| 04 | Billing截图：侧栏余额与Available均11 credits，Nothing on hold，11条history entries、9 charges，cap为No cap | 只证明此时两个可见余额一致及这些页面数字；未查账本、不等于资金守恒或cap行为通过 |
| 05 | Library有3张历史image卡；键盘Enter打开商品图Asset details；显示Delivered、Cost 1 credit、3:4，以及原Canvas和thread链接 | 证明历史素材详情可用键盘打开且元数据可见；没有新生成、没有核原始字节尺寸、没有跟随链接验证完整回链 |
| 06 | 对详情Download按钮按Enter；没有下载落盘回执；检查 `~/Downloads` 最近5分钟无新文件 | 仅确认触发尝试。不能判下载成功；亦不能据无文件判产品失败，因工具/浏览器下载去向未闭合。完整下载验收未完成 |
| 07 | 按Escape关闭Asset details dialog成功；尝试读取焦点时evaluate超时 | 关闭行为已观察；焦点是否回到原卡未证，不宣称键盘完整闭环 |
| 08 | Search Library用程序fill输入 `R3不存在的素材20260914`；无结果界面明确引用该词；对Clear filters按Enter，恢复3张卡 | 查询空态和清筛恢复已观察；这是程序填中文，未做真实IME composition，不宣称中文选字Enter无误提交 |
| 09 | 从1280×720切390×844，原为expanded导航：main约140px，pageWidth=390；截图显示内容裁切、卡极小。Collapse后内容可见、卡约50px；再expand＋reload后main仍约140px | 窄视口挤压及刷新后复现已观察；不是整页横向滚动；不是手机硬件验证；没有验证无存值首次默认状态。见R3-F02 |
| 10 | 切1920×1080，截图正常显示3张大卡；之后reset恢复默认1280×720 | 该页该内容大屏视觉正常；不推定所有大屏页面通过。视口已恢复 |
| 11 | 直接goto Profile再看截图，Email正常显示测试邮箱 | 进一步支持不能判Profile邮箱产品缺陷；仍不解释早先DOM空字符串的取证原因 |
| 12 | 从导航用键盘Enter进入Brand；可见5个tab：Brand voice、Audiences、Knowledge base、Style guide、Visual guidelines；Brand voice计数0且有明确empty state | 只证明这5个tab存在、进入Brand及当前Brand voice空态；未逐tab走查、未建立或编辑品牌记录，不算Brand全验收通过 |

## 工具可靠性与取证边界

点击工具多次出现CDP超时，其中部分动作随后DOM验证已生效。工具请求超时不能单独登记为产品故障，也不能不检查就重复可能有副作用的动作。改用键盘后大部分操作可完成。焦点读取失败和下载无回执分别保持未验证。

Profile的DOM与截图相反尚未定位：可能是工具对敏感字段处理或取证时序，但无证据支持任一根因。以该矛盾建立R3-F01，未建立产品缺陷。

手机检查仅在浏览器受控视口进行；已批准产品规格仍为desktop-only，见问题目录R3-F02的来源核对。本轮发现不自动批准重设计。

## 费用、写入与恢复

截至步骤12，本批真实费用 **US$0**，尚无产品数据写入。没有生成、上传、发送邮件或外部消息、删除远端数据、部署、修改环境。仅浏览、搜索、导航、尝试下载和变更本地视口／导航展开偏好。步骤14追加的首次产品写入见下节，不能再将全轮概括为无写入。视口已reset到默认1280×720；没有清理远端夹具。

本轮真实生成预算仍以 [plan.md](plan.md) 为准；本批未消耗额度。没有供应商账单或新任务，因此不产生生成成本／扣费核对结论。

## 问题交叉引用

- **R3-F01**：记录03与11，DOM空值与可见邮箱矛盾，未确认产品缺陷。
- **R3-F02**：记录09与10，窄视口压缩、折叠缓解、刷新仍有、大屏正常；无存值首次载入待验。
- **未闭合的执行证据**：记录06下载落盘，记录07焦点恢复，记录08真实IME；分别保留未验证，不混入产品失败清单。

## 后续执行（13–16）：首次产品数据写入

| 序号 | 操作与现场 | 结论与边界 |
|---|---|---|
| 13 | Brand的Knowledge base计数1；进入record editor，商品计数1 | 读取现有状态，未查数据库 |
| 14 | 通过真实UI创建 `R3 Test cup 中文 20260914`，价格RM39，无图片；成功，商品计数变2 | 本轮首次staging产品数据写入，仅这个测试商品；无图片不能完整证明PRODID-A1“名字主图价格”全部条件 |
| 15 | Library → Elements → Products出现同名商品，0 linked images；侧栏11 credits | UI跨面出现已观察；未比对数据库Entity id，不据同名宣称身份数据全链通过；可见余额未变化不替代账本零新增证明 |
| 16 | 打开该商品dialog，只有名称heading、Products/0 linked images、No image saved、Remove from Library、Close；没有改名入口 | Library改名原计划未执行；当前代码与批准规格核对见R3-F03。没有点击Remove，没有删除测试商品 |

截至步骤16，生成／上传／外发／远端删除／环境修改均未发生，真实费用US$0；已创建并保留一个测试商品。RM39是商品营销价格，不是本轮扣费。无图商品仍保留，以便后续追踪，不擅自清理。

## 后续执行（17–20）：正向改名、演员与引用选择

| 序号 | 操作与现场 | 结论与边界 |
|---|---|---|
| 17 | Brand Actions → Edit，将商品改为 `R3 Test cup revised 中文 20260914`；价格RM39保持，产品数2 | 实际产品第二次写入为改名；不称全轮无写入。未换主图 |
| 18 | Library → Products显示同一新名字，0 linked images | Brand→Library改名显示同步已观察；反向Library改名仍因无入口未完成，见R3-F03 |
| 19 | Official avatars看到Aisyah、Arjun、Rahman、Weijie、Xinyi五个，各显示2 images；Aisyah详情明确Read only，只有Close，无edit/remove | UI目录与只读呈现已观察；没有验证五位演员全部详情、底层图片字节或生成人脸一致性 |
| 20 | Create输入 `@R3`，找到唯一新商品并标Product；选中后textbox为 `@R3 Test cup revised 中文 20260914`；未Send | 商品搜索与选择分句成立；未发送、不出现本轮生成确认卡、不证明approvedEntities谱系；后续清空输入尚待复核 |

后端交叉证据已由专职worker追加至 [backend-evidence.md](backend-evidence.md)：创建/改名保持相同Entity及BrandRecord ID；分别以操作时间前后2分钟读取该租户账本，均零行、余额及冻结额delta均0。结合步骤14–18可证明该次创建及改名的部分验收；未删除，不能扩成PRODID-A10建改删全通过。

截至步骤20，累计真实费用US$0；已创建并改名同一个测试商品，没有生成、上传、发送消息或删除远端对象。商品仍保留，Create中引用草稿是否清空待下一记录，不臆称恢复完毕。

## 后续执行（21–22）：草稿清空与原图字节证据

| 序号 | 操作与现场 | 结论与边界 |
|---|---|---|
| 21 | `fill('')`未清空（工具／时序原因未定）；随后ControlOrMeta+A、Backspace，DOM确认textbox为空且Send prompt disabled | 引用草稿已清空，没有发送请求；此记录更新步骤20“待复核”，不将首次fill失败归为产品bug |
| 22 | 使用CUA pageAssets bundle按当前Asset details的img.src精确匹配，导出真实历史商品原图；复制至本目录artifacts/product-original.jpeg | 此路径不同于步骤06的Download按钮，没有补出Download落盘回执；只证明原图可取回真实字节 |

原图文件：[product-original.jpeg](artifacts/product-original.jpeg)。主线程ffprobe实测codec=mjpeg、1728×2304，即3:4。整理worker复制后独立核SHA-256为 `fe1873ef730ac1b76b2a6fd6c5949bed21e5089f8614b1ba5c08019927491c75`，与主线程给出的原内容寻址对象名一致。没有用截屏冒充原图；未据此声称Download按钮有效。

## 阶段检查摘要（执行尚未结束）

已观察：已有会话进入、账户菜单版本、Profile视觉邮箱正常、Billing两处余额11及无hold、历史素材详情、搜索无结果及清筛恢复、dialog关闭、窄视口挤压与大屏对照、Brand无图商品创建和正向改名、Library同名同步、五位官方演员目录和Aisyah只读详情、产品@选择后清空。创建和改名有同一身份及对应时间窗口零账本变化的后端交叉证据。

未闭合：新登录完整两扇门、Download按钮落盘、Escape后焦点、真实IME组合输入、Library反向编辑、主图双向同步、删除恢复、发送后谱系及真实生成。生成路尚未运行，环境例外问题等待用户选择；不得以已批准预算代替尚未解决的环境边界。

自动验证仍在运行，结果由对应记录持续回填；本摘要不宣称自动测试全绿或第三轮完成。截至本记录费用仍US$0，远端测试商品保留，输入草稿已清空。

## 后续执行（23–25）：历史画布刷新与新标签恢复

| 序号 | 操作与现场 | 结论与边界 |
|---|---|---|
| 23 | 从原商品Asset details的 `E2E Product + avatar journey` 来源链接进入历史Canvas；有2张Image cards、1张失败Video card，余额11，Conversation20；打开会话可见原报价、Done 1 credit和历史退款失败卡 | 历史结果与会话可以恢复；全是既有结果，不是本轮生成或本轮退款。历史Otto长文本不复制，不登记成当轮新增生成缺陷 |
| 24 | 对当前画布执行reload，画布与历史会话恢复 | 证明该历史深链在刷新后可恢复；未在生成中刷新、未断网，不声称在飞任务恢复通过 |
| 25 | 新标签通过相同深链打开；真实getByRole计数Image cards=2、Video cards=1，Conversation20 visible=true；随后关闭新标签，原页goto Billing准备末次费用对照 | 新标签恢复相同历史内容已观察；末次Billing费用对照尚未提供，不能提前写通过 |

此批只覆盖历史作品的来源深链、刷新与新标签恢复子检查；生成中离页、关闭后终态、断网重连和新生成账本仍未跑，相关完整验收至多PARTIAL。没有新增生成、扣费、退款或远端清理；新建的浏览器标签已关闭。

## 后续执行（26）：免费操作后的账单对照

末次Billing现场：main Available=11 credits，sidebar=11 credits，Nothing on hold，11 history entries、9 charges，cap为No cap；与步骤04一致。Create草稿已在步骤21核空且Send disabled，未发送。

此证据证明本轮已执行免费操作后可见账单数字未变，结合backend-evidence中的限定窗口零账本证据；不外推全库账本或未执行付费流程。实际费用US$0，已批准预算仍US$20（16暂停），不是预算为0。生成环境例外问题尚待用户选择。

自动验证状态更正：本地quality初轮数据库集成有3项失败，正在继续验证后续阶段；不能写最终全绿，详情以automated-checks.md为准。

隐私边界追加：工具截图中可见测试邮箱，本地报告文字已掩码，但未声称截图已经脱敏或持久化。截图外发／进入仓库前须脱敏；没有完成全审计秘密扫描，不宣称全量隐私检查通过。

## 后续执行（27–29）：显示名保存与菜单刷新

| 序号 | 操作与现场 | 结论与边界 |
|---|---|---|
| 27 | Profile把显示名从 `E2E Café tester 中文` 保存为 `R3 Café tester 中文`；出现Saved回执，Save按钮disabled；立即开Account仍旧名，头像E | 截图与DOM都证实两处不同，与邮箱取证矛盾不同；不能解释成保存失败 |
| 28 | 硬reload后Profile仍为R3新名，头像R，Account菜单R3新名一致 | 新名刷新后保持，菜单经刷新同步；未查DB，不声称逐表存储核证 |
| 29 | 通过UI把显示名恢复 `E2E Café tester 中文`，出现Saved；随后硬reload，最终确认原名、头像E、Save disabled | 已执行恢复保存请求；原显示名恢复且刷新保持已验证；不扩大为所有Profile验收通过 |

这两次Profile显示名写入是新增的真实staging数据修改，除先前商品创建／改名外还包括测试账户名字修改及恢复；没有改email或权限。步骤26的钱包对照在此次Profile操作之前；后续再次打开Billing实测仍11 credits、Nothing on hold、No cap、11 entries/9 charges，与先前一致。没有生成或付费请求。R3-F04记录菜单刷新缺口。

### 最终恢复复核追加

临时新名保存后硬刷新仍为新名且菜单同步，随后恢复原名并Saved，最终硬刷新确认为`E2E Café tester 中文`、头像E、Save disabled。之后Billing仍11 credits、Nothing on hold、No cap、11 entries/9 charges。FRONT-A11仅“个人显示名刷新仍在”分句已验；工作区改名、充值/结账等未执行，不能据此整条PASS。

## 后续执行（30–32）：连接状态与停放入口

| 序号 | 操作与现场 | 结论与边界 |
|---|---|---|
| 30 | `/settings/connections`先Checking后Nothing connected；Instagram/Facebook为Not connected，X为Unavailable；Add connection弹窗同样3状态，未点Connect | 真实状态加载及未连接呈现成立；没有连接第三方、没有外发、新业务写入或付费 |
| 31 | 在弹窗Close处按Escape；DOM dialogCount=0，document.activeElement.textContent为Add connection；View X connection显示 `This service is not available to connect.`且无Connect | 此弹窗关闭与焦点回归已证；不补证Asset details旧步骤07的焦点。X不可连接诚实提示已观察 |
| 32 | 访问`/schedule`最终URL为`/`并显示Home；访问`/campaign`同样最终URL`/`和Home | 两入口停放重定向符合当前映射，不是功能失败；没有实际排期或Campaign操作 |

路由代码核证：`packages/core/src/navigation.ts:311–323`映射说明Beta parked/deferred；schedule/page.tsx直接redirect Home；campaign/layout.tsx以父layout捕获所有campaign子路由并redirect Home。`apps/web/proxy.ts`负责鉴权跳登录，并非这两项停放重定向的执行者。曾仅依据campaign/page.tsx含真实取数组件而称正式Campaign页的规划判断已更正；父layout决定该页面实际不可达。

## 后续执行（33–34）：工作区校验与商家后台拒绝

| 序号 | 操作与现场 | 结论与边界 |
|---|---|---|
| 33 | `/settings`先Loading your settings后General；Workspace name为`E2E Cafe 2026-09-08`，Save disabled；输入3空格仍disabled；输入` E2E Cafe 2026-09-08 `，isEnabled=false；最后填回原名并DOM确认原名、disabled | 空白及仅前后空格无实质变更不启用Save，这两个窄断言成立；未点Save、无新增工作区写入，不能判工作区改名刷新持久通过 |
| 34 | 当前既有商家会话分别访问`/admin/money`与`/admin/tenants`，最终URL均`/`、DOM为Home，无后台数据可见 | 仅两个商家拒绝入口已证；无合法staff对照、未覆盖全部API或双租户隔离；没有改角色 |

后台路由源码：`apps/web/app/admin/layout.tsx`外层对非isFounderAdmin身份redirect(`/`)；此窄检查只证明当前外层拒绝与本轮商家现场，不替代内部能力或资源范围检查。步骤33草稿已恢复原值，无新增数据写入。

## 后续执行（35）：素材详情关闭后焦点落BODY

主线程在Library Generation history以键盘Enter打开 `Open 22-avatar-product-references.png, image`，再在Close处按Escape。两轮分别为加载中关闭、以及等待完整Asset details（Cost0.1、Uploaded by you和操作按钮齐全）后关闭。两次dialogs=0，document.activeElement.tagName=`BODY`，aria-label=null，没有回到原素材。第一轮列表随后恢复3卡，焦点仍BODY；截图确认列表正常，不是空库。

这补足步骤07当时未能取证的同类焦点问题，但不改写旧时点。Connections弹窗步骤31会回Add connection，构成本轮正对照。最后关闭后未再按Tab，不能声称下一Tab具体从哪里开始。

首次读取BODY.textContent带大量脚本，这些内容不纳入报告证据；只采用窄DOM tag/label及工具截图。没有付费、新业务写入或删除。见R3-F05。

## 独立本地链路追加（与真实staging分账）

本段由主线程转交本地执行事实，不是staging真实生成。使用模拟供应商与预制Otto方案卡，真实独立worker消费本地队列；未向真实provider提交。

1. 前两次runner分别被登录helper预期落点不符、预制方案缺model挡住。缺model时产品正确拒绝、GenJob为0；两次属测试准备问题，不记产品生成失败。
2. 第三次实际入队，独立worker消费到DONE，产生1条Generation和1条Asset及非空本地文件；文件SHA与Asset相符。内部账额1000→990，换算100→99 credits；RESERVE为(-10,+10)，SETTLE为(0,-10)，无REFUND，reserved归0。这一单扣费一次，不在SETTLE再扣一次。
3. 第三次runner退出1，原因是临时断言错误要求SETTLE再扣10；原页自动收敛断言没有执行。不因这个runner错误判产品钱路失败，也不能记整个端到端PASS。
4. 后续同fixture只读重开退出0，不重新生成。图片naturalWidth>0，页面Done且99 credits；主线程已看 [fullstack-readback.png](local-logs/fullstack-readback.png)，内容为蓝色mock方块。只证明重开读取结果，不证明原页自动收敛、真实Otto提案或真实供应商质量。

此本地账额与staging11 credits不同，必须分账。真实staging供应商费用仍US$0。本段不替代真实生成验收；完整自动计数以automated-checks.md最新记录为准，本文不补造未收到的最终计数。
