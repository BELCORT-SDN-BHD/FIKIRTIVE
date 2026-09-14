# 第三轮问题目录

版本：staging web `14bcd038`。本文件区分现场症状、当前代码证据与未验证推测；历史报告仅是检索线索。规划／诊断 worker 未操作浏览器、数据库或产品代码。

## R3-F01 · Profile 邮箱取证矛盾，未确认产品缺陷

**现行状态（2026-09-14 更正）**：取证矛盾／未确认产品缺陷，不计产品FAIL、不定产品严重度。初始DOM空值观察保留在下文作为时间顺序记录，已被后续视觉截图证据否定其“商家看到空邮箱”的推断。关联真实检查 REAL-31；旧症状标签 FSE-011 仅用于追溯，不作为本轮事实证明。

### 本轮现场证据

主线程在 2026-09-14 的 staging `14bcd038` 中，以既有测试账户进入 Account 菜单，菜单显示测试邮箱；进入 Profile 页面后，Email input 为 disabled，读取 DOM 得到 `value === ""`。显示名为 `E2E Café tester 中文`。来源是主线程本轮浏览器观察并转交给本 worker，非本 worker 独立目击；具体时间、截图／DOM回执由主线程补入 `run-ledger.md` 后在此加定位链接。真实邮箱不在本目录留明文。

复现步骤：同一会话打开账户菜单 → 记录脱敏邮箱 → `/profile` → 读取 `#profile-email` 的 `value`、`defaultValue`、`getAttribute("value")`、disabled/readOnly 状态；刷新和新标签重复。主线程已完成的只有上述症状观察，不将后续步骤记为已跑。

预期：Profile 的只读 Email 显示当前登录邮箱，与同一账户菜单一致。依据当前产品页 `apps/web/app/profile/page.tsx:33–41` 明确注释和绑定：身份系统持有的只读邮箱，说明文案 `Your sign-in address.`；没有规格批准的“空白显示”行为。

### 追加更正：后续截图显示邮箱正常

2026-09-14，主线程继续对同一Profile页面作截图视觉核验：disabled Email字段**清楚显示测试邮箱，并与Account菜单一致**。截图为本轮工具输出，未宣称已存本地文件。此前DOM snapshot及读取value为空与该视觉证据相矛盾，因此撤销“产品邮箱为空”的缺陷判断。商家视觉邮箱空白未获证明；不计产品FAIL。

可能涉及工具对敏感DOM字段的脱敏、hydration取证时序或其他读取偏差，均未验证，不能当根因。下一步应先核取证方法与同一时点的截图/DOM差异，而不是修产品。下文初始影响与修复建议仅保留诊断历史，**不表示影响已证、也不作为开修依据**。

### 当前代码已经证明的事实

| 环节 | 当前代码证据 | 能证明的范围 |
|---|---|---|
| 身份门 | `apps/web/lib/auth-guard.ts:74–80`、`:94`、`:106` | `requireOwner` 读取 session.user.email；缺／空邮箱返回错误，不走成功分支；成功返回同一email |
| Profile读取 | `apps/web/lib/profile-names.ts:63–77` | 成功分支返回 `email: gate.email`，没有把email置空或从数据库名称字段覆盖邮箱 |
| Profile页面 | `apps/web/app/profile/page.tsx:20–24`、`:37–41` | 读取失败跳登录；成功把names.email直接传到Input value |
| Input封装 | `apps/web/components/ui/input.tsx:9–23` | 原生input透传props；disabled只加样式，没有清空value逻辑 |
| 表单children | `apps/web/app/profile/ProfileNames.tsx:86–109` | 邮箱由children原样插入；显示名state只控制自己输入框，不重写邮箱 |
| 账户菜单数据 | `apps/web/lib/account-actions.ts:170–173`、`:221` | getMyAccount同样从requireOwner得到email并返回，静态链条未见两份邮箱规则 |

**结论边界**：当前成功代码链预期邮箱非空，与本轮DOM为空相矛盾；静态阅读不能判定在哪一层发生分歧。没有直接证据支持“数据库邮箱缺失”“租户守卫丢email”或“disabled导致空白”。不应凭症状回填用户数据或把邮箱改从另一张表读来掩盖问题。

### 尚未验证的可能性与下一步最小取证

1. **服务端输出与浏览器状态分歧**：同一响应中的初始HTML/RSC邮箱值是否存在？只在本地临时检查敏感响应，不把邮箱/cookie/token整包落报告；记录有值／无值及脱敏摘要即可。
2. **浏览器运行期清空或缓存**：比较value属性、defaultValue和当前value；硬刷新、新标签对照；记录实际页面build与脚本版本、控制台hydration错误。存在自动填充或浏览器扩展影响只是推测，未取证。
3. **请求身份或部署边界不同**：Profile此次请求与菜单请求是否同会话、同部署产物？只记录脱敏一致性，不泄露cookie。当前health sha不能单独证明每个缓存脚本与服务端响应都是该版。
4. 如上述仍不闭合，使用隔离本地环境以非空session邮箱完整渲染Profile，复现后沿响应→hydration→DOM定位；本 worker 未执行此试验。

旧 `docs/audits/fullstack-staging-2026-09-08/backend-evidence.md:184` 曾记两身份表非空，但这是旧版本旧现场，不用于断言当前数据库状态。本轮未查DB。

### 已撤销的初始影响推断与修复建议（非当前结论）

**以下句子为初始DOM观察产生的推断，已被后续正常截图撤销，不是当前已证影响：** 商家在个人资料中无法确认自己的登录地址，和Account菜单冲突；`profile/page.tsx:52` 还把同一names.email传给DeleteAccountCard，若空值源自读取层，支持邮件预填可能受影响，**尚未复测，不算已证影响**。未点删除账号。

修复前先用上述最小取证定位断点，再在断点作最小修改；保留authenticated session为邮箱权威，不新增平行身份源，不改邮箱、权限或计费行为。

必要验证：带非空邮箱的真实Profile页面DOM断言；Account菜单与Profile一致；首屏/客户端导航/刷新均成立；邮件门与Google门既有账号及新账号分别取样；显示名修改不影响邮箱；双租户相互不可见。当前 `apps/web/lib/__tests__/profile-actions.test.ts:95–102` 已验证reader返回email，`settings-production-convergence.test.ts:53` 仅验证源码含names.email；它们不能替代浏览器DOM行为。此轮未运行这些测试。

**执行边界**：仅报告与定位建议；未修改产品、未访问数据库、未运行共享quality、未发生付费调用。修复是否纳入本轮另由主线程按已授权任务范围处理。

## R3-F02 · 390px 窄视口中 Library 被导轨挤窄、素材卡极小

**状态**：窄视口症状已观察，390px刷新后仍复现；CSS成因有当前代码支持；无存值手机首次进入尚未验证。**分类**：已观察到的移动可用性缺口，是否成为本轮必须修复的产品缺陷待 Founder 裁定，不能擅改已批准 desktop-only 方向。建议影响等级 P2；不是已证桌面回归。关联 REAL-14/30、EXT-01。

### 本轮现场与边界

主线程在 staging `14bcd038` 将已有页面从1280×720调整到390×844，未刷新。DOM `innerWidth=390` 且 `pageWidth=390`；展开导航约240px，main实测约140px。Library筛选和文字右侧裁切，三张素材卡缩为极小点。点击Collapse navigation后main约326px，三卡约50px，内容可见但很小。截图在本轮主线程工具结果，准确时间与持久证据路径待run-ledger回填。

这是受控浏览器视口，不宣称真手机硬件验证；**不是整个页面横向滚动**，因为实测pageWidth没有超过390。初始导航是从桌面页面继承的expanded状态；390px reload已在后续更正及run-ledger09补证仍复现，新设备首次载入与localStorage无存值仍未验证；不能声称“手机首次进入必然如此”。主动展开与默认展开必须分开记录。

### 当前代码支持的成因

- 导轨宽度源头 `apps/web/components/navigation/rail/rail-state.ts:17–19` 固定240/64；`:27–32` 默认collapsed=false。`:6–13`说明按用户选择而非宽度切换、持久化在本设备。
- `NavigationRail.tsx:283–298` 首帧默认后读取localStorage；`:315–316` 设置显式宽度并`shrink-0`，窄视口不会自动缩小导轨。与现场240px/折叠64px相吻合。
- `LibraryView.tsx:229–232` 工具栏水平padding、搜索`min-w-52`；main只有约140px时，这个最小搜索宽度无法在内容列完整放下。该声明支持“内部空间不足”，具体哪层裁切仍须DOM盒模型核验，不能据此断言唯一overflow责任节点。
- `LibraryView.tsx:1043` 内容两侧`px-6`；`MediaGrid.tsx:209`真实网格固定`column-count:5`、间隙0.5rem，`:159`骨架同样固定5列，无窄屏断点。折叠后约326px内容减48px padding再减4×8px列隙，五列每列约49.2px，与现场约50px高度一致。此为以实测宽度及当前CSS计算的解释，不是额外浏览器测量。

### 批准规格是否要求手机

现行已批准 `docs/specs/wave2-shell.md:403` 明写「移动端整层（Founder 裁决：desktop-only）」；`:431–432`规定单层240px、手动64px并删除按宽度自动变形。因此不能将“没有自动手机抽屉”直接判为违反现行规格。

`docs/specs/frontend-baseline.md:56` FRONT-A14要求按批准设计走六面；其验收表`:43–56`未给手机宽度或触控阈值；`:66`非目标“不重开设计”。当前用户追加全面真实测试授权了发现手机问题，不自动批准重新设计导航或撤销desktop-only方向。第二轮plan:86将手机/大屏留第三轮，是测试范围安排，不是手机产品行为批准。

### 影响、下一步与可能修复

窄屏展开时素材识别与筛选操作困难；手动折叠只缓解内容宽度，固定五列仍使卡片极小。没有修改产品或设计。

下一步由主线程记录：①390px刷新且沿用collapsed存值；②仅在专用测试浏览器验证无存值首次载入；③390px主动expanded和collapsed；④桌面1280/1440恢复对照；⑤搜索与网格的clientWidth/scrollWidth及computed columns、卡片宽度。不要删除共享localStorage来模拟新设备，也不把尺寸变化当默认状态。

若Founder要求修复手机支持，应先确认desktop-only方向如何调整，再在单一导轨规则与Library网格源头实现适用窄屏行为；不临时在某页复制第二套导航。测试覆盖初次载入、保存展开状态后切窄屏、折叠、刷新、键盘与触控可达，且桌面批准视觉无回退。若本轮只做诊断，则保留此缺口，不冒充手机PASS，也不凭本条自行给全部产品NO-GO。

### R3-F02 追加现场更新（2026-09-14）

主线程在390px视口刷新后，main仍约140px，窄视口挤压在刷新后复现。1920px大屏显示正常，有本轮截图工具输出；未宣称截图已存文件。以上补足“刷新后是否仍有问题”，不补足“新设备／无localStorage首次默认进入”，也不改变已批准desktop-only规格。原先未刷新观察保留，更新结论以本段为准。

## 本轮执行记录索引（2026-09-14 追加）

原始执行过程现已编录于 [run-ledger.md](run-ledger.md)：R3-F01对应执行序号03及11；R3-F02对应09及10。截图仍为主线程本轮工具输出，没有提供本地截图文件。此索引替代前文“待run-ledger回填”的等待状态，不修改原始观察与更正的时间顺序。

## R3-F03 · Library 产品详情缺少已批准的改名／换主图入口

**状态**：真实UI与当前代码共同确认入口缺失。**建议级别**：P2；影响现行批准验收PRODID-A4的Library侧操作，属于既有规格交付缺口，不是用户临时要求的新产品行为。此结论不声称后端同步函数失败。

现场来源：[run-ledger.md](run-ledger.md)步骤13–16，staging `14bcd038`。主线程通过Brand真实创建无图商品 `R3 Test cup 中文 20260914`，RM39；Library Elements Products出现同名商品，详情只有名称、Products/0 linked images、无图提示、Remove from Library、Close。未找到改名入口，尚未实施Library改名；没有点删除。截图/DOM证据仍由主线程工具输出承载，不编造文件路径。

**批准契约**：`docs/specs/brand-product-identity.md:3–4`有2026-09-09批准；`:21`明确“改名换图改Entity（两边入口都可改）”；`:35`的PRODID-A4逐字要求“在Library改名或换主图；再在Brand页改名或换主图”，另一边同步。`:36`禁止的是价格、卖点、分类的Library编辑入口，**不禁止名字和主图**。因此不能把缺改名解释为A5的正确行为。

**当前代码证据**：`apps/web/components/library/LibraryView.tsx:499–544`是已观察的Elements详情完整渲染分支，名称仅DialogTitle文本，图片仅img/No image提示；唯一业务操作为`:529–539`的条件删除按钮，没有名称输入、主图选择或更新动作。`:467–472`产品卡只setSelected打开这个详情。因此可确认此产品详情入口缺失，不依赖旧走查报告。

**范围边界**：规格`:74`自身已有未裁登记，描述Library编辑／恢复入口未接、动作层存在；该记录只用于辨认现有范围问题，不作为当前实现证据，也不是Founder批准删掉A4。当前已批准本轮全面E2E只授权调查执行，不能自动把缺口变成修改设计权限。建议主线程呈报“按原A4补齐”或“明确延期并记本条未完成”；未获改口径前A4不能PASS。无图并不取消改名需求，不需要先产生付费素材才能验证此缺口。

**修复与验证建议**：若获准修复，按前端接线规定复核已批准Library设计来源，接现有共享Entity更新动作，不新建第二套产品身份。行为验证需Library改名→Brand同步、Brand改名→Library同步、带图夹具换主图双向同步、同Entity id、价格字段仍仅Brand可改、合法/越权双租户、账本零新增。当前没有运行这些修复测试，也没有修改产品或规格。

## R3-F04 · 修改姓名后账号菜单需刷新才同步

**状态**：真实UI症状确认，客户端刷新接线成因有当前代码支持。建议P2显示一致性缺口；并非名字未保存、并非R3-F01的邮箱证据矛盾。现场版本`14bcd038`，见run-ledger步骤27–29。

主线程把虚构测试账户显示名保存为`R3 Café tester 中文`，Profile显示Saved且按钮disabled；立即打开Account仍旧名`E2E Café tester 中文`、头像E，截图和DOM相互支持。硬刷新后Profile新名仍在、菜单与头像变R3/R。随后用UI恢复原名字并获得Saved，硬刷新最终确认原名与头像E且Save disabled；随后Billing数字未变（run-ledger最终恢复复核）。未改邮箱或权限。

**当前代码链**：`apps/web/lib/profile-actions.ts:49–74`经身份与membership限定更新User.name，之后revalidatePath根layout并返回name。`app/profile/ProfileNames.tsx:69–79`客户端接成功结果只setSaved/setDraft/setStatus，没有账号刷新信号。`components/global-navigation.tsx:180`将account保存为客户端state；`:195–222`只在merchantSurface变化时挂effect，首次load、余额广播及visibilitychange会getMyAccount并setAccount，普通菜单打开/名字保存不触发此load。`navigation/MerchantAccountMenu.tsx:28–30`按传入account.displayName显示，`:119`取该label首字母。静态代码与“刷新前旧、刷新后新”一致；不需要推测数据库没保存。根layout revalidate没有在此客户端state路径保证重新取account。

**批准要求边界**：`docs/specs/frontend-baseline.md:53` FRONT-A11规定改个人显示名“刷新仍在”，本次该分句有现场支持；未找到该验收句明确承诺“保存后一刻菜单立即同步”。当前Profile组件说明“name appears across Fikirtive”与同屏两处不同构成一致性问题，但不能凭本条把FRONT-A11整条判FAIL，更不能说批准规格的刷新持久化未达成。若要将立即同步定为本轮必修，主线程应按当前范围决定／呈报，不擅自扩大验收。

**修复方向（未实施）**：在既有身份读源和客户端刷新机制之间补保存成功后的更新，不新增另一份账户事实；具体是重读或共享事件由实现阶段选择，不借修名改变余额、权限或邮箱。行为验证：保存成功后同页面Profile/菜单/头像同步；错误保存不改变菜单；硬刷新持久；改回原值同步；不同租户只更新自己。当前无产品修改、无新测试运行。

## R3-F05 · Library素材详情关闭后焦点未回原素材

**状态**：真实键盘体验发现，建议P2；根因尚未由运行时链路证明。现场`14bcd038`见run-ledger35。加载中及完整加载后两轮Enter打开同一上传素材、Escape关闭，均dialogs0、activeElement BODY、aria-label null；列表恢复3卡后仍BODY。Connections同类关闭回Add connection是独立正对照。未继续按Tab，不推断后续焦点顺序。

**当前代码支持的风险路径**：`components/library/MediaGrid.tsx:101–111`是普通Button调用onOpen，不是详情Sheet的Trigger；`LibraryView.tsx:1257–1274`仅detail存在才挂DetailPanel，关闭立即closeDetail清state，router.refresh并reload网格；`:692`reload会setLoading(true)，`:1071–1074`加载期用骨架替换MediaGrid。`components/asset/DetailPanel.tsx:809–824`Sheet恒open、onOpenChange false直接onClose；当前该入口没有显式原卡ref／finalFocus恢复逻辑。可能是触发元素卸载、详情根卸载与焦点恢复时序组合，但静态代码不能证明具体先后及唯一成因。不得把“没有Trigger”单独当已证根因。

**规范边界**：`DetailPanel.tsx:5`代码注释宣称Sheet traps/restores focus；本轮行为与此工程意图不一致。已批准Library pattern README开头有批准标记；design-qa.md:24写当时检查视口无missing focus target，但这是历史夹具QA，不是当前真实资产详情运行证明。frontend-baseline FRONT-A14要求批准设计一致，当前未找到该规格或Library README逐字明确“每次关闭回到原素材”验收行，不能把体验发现伪装成某编号整条FAIL。该症状明确影响键盘用户继续浏览，是否本轮必修按范围处置。

下一取证：记录关闭前原按钮是否仍connected、网格加载/重建与焦点变化顺序，再看关闭后首个Tab实际落点；对未发生列表重取的正对照区分原卡卸载与弹窗根卸载。不记录BODY文本脚本。若修复，保持真实列表刷新与原素材焦点恢复两者，素材确已删除时按已批准合理落点处理，不跳过列表重取掩盖问题。测试覆盖加载中/加载后、关闭后原卡仍在/已删、下一Tab、与Connections对照。未改产品、未跑测试。

## R3-F06 · 输入附近不再堆叠重复费用说明

**状态：Founder 2026-09-14 已批准移除此类说明；本场仅记录，尚未实现或复测。** 来源是 Founder 在当前对谈提供的截图及主线程转交的明确裁决；本 worker 没有独立重跑浏览器，也没有本地截图文件可引用。现码核对基准 `14bcd038b386d6e7d6ad98bbc716aaf018a23314`。这是一项对旧展示要求的明确变更，不把此前遵循旧规格的实现倒写成原有缺陷。

**裁决范围**：截图在 Otto 输入框附近长驻「Uploads are understood automatically…」「Otto searches the web…」「Otto checks with you…」，末段还解释「Each message holds up to 4 credits…」。Founder 表示这些不必要，同类不用这样处理。按截图例子解释为跨受影响入口移除重复常驻的费用／机制说明段落，不能只换成 tooltip、折叠区或挪到另一块持续展示；并非泛指删除全部 alert。实际逐动作报价／确认、交易回执、可操作错误、认证／安全行为及后端定价、预留、结算、退款不在删除授权内。图上 4 credits 仅为本次示例，不是新价格决定。Billing 实际价格、消费明细与账目不因本条自动删除。

**当前单一文案源与挂点（静态阅读，不代表每个分支已现场打开）**：

| 说明 | 单一来源 | 当前渲染入口 |
|---|---|---|
| 上传后自动理解的说明 | `apps/web/components/otto/UnderstandingCostHint.tsx:43`；价格由 `pricedUnderstandingCredits` 推导 | `OttoChatStream.tsx:2362`、`start-something/StartSomething.tsx:369`、`otto/TemplateModal.tsx:447`、`otto/stuff/AddAssetDialog.tsx:310`、`asset/DetailPanel.tsx:1350`、`canvas/FlowCanvas.tsx:1799`（均在 `apps/web/components/`） |
| 自动搜索与次数说明 | `apps/web/components/otto/SearchCostHint.tsx:53`；同文件 `:42–49` 导出价格标签供 Billing 复用 | `otto/OttoChatStream.tsx:2363`、`start-something/StartSomething.tsx:370`、`otto/OttoFrontDoor.tsx:333`（均在 `apps/web/components/`） |
| 对话收费与每轮预留说明 | `apps/web/components/otto/ConversationCostHint.tsx:33`；预留句来自 `apps/web/lib/credit-format.ts:211` 的 `CHAT_HOLD_NOTE` | `otto/OttoChatStream.tsx:2364`、`start-something/StartSomething.tsx:371`、`otto/OttoFrontDoor.tsx:332` 及 `:378` 两分支（均在 `apps/web/components/`） |

`apps/web/app/billing/page.tsx:21` 仍直接导入 SearchCostHint 模块的价格标签，`:276` 用于 Billing 价格说明；后续清理组件时须保住这个真实价格读源，不能因删除 JSX 顺带删计价导出。主表列出的挂点应在下场用当前 HEAD 重查，不把此清单当永久权威。

**旧规格冲突已写回原处**：`docs/specs/frontend-baseline.md`、`docs/specs/money-engine.md`、`docs/specs/otto-engine.md` 的 §5 均追加 2026-09-14 **批准:／APPROVED** 变更登记，保留此前记录。它们确实分别曾要求起步页三条披露、上传／搜索常驻小字、对话常驻费用段落。当前裁决覆盖这些展示处方，不重新裁定计费规则。

**下场实现与验证**：先让 docs-only 规格变更按项目规则经 PR 合入主干；再完整阅读前端接线 handoff，核对设计来源，从上述共享源及全部真实挂点移除本类段落、空容器与本次造成的无用引用。不能只在截图页设隐藏样式。更新要求这些旧提示始终挂载的测试（至少检查 `understanding-disclosure.test.ts`、`money-a10-search-disclosure.test.ts`、`front-a15-create-start-disclosure.test.tsx`、`front-baseline-acceptance.test.ts` 的相关断言），替换为当前批准行为并保留真实价格、动作确认和钱路保护。按验收逐入口作浏览器检查、类型与相关单元／集成验证；不能因删旧形态断言而整份移除计费测试。

**未闭合项**：本场未提交／合并 docs-only PR，项目「规格先入主干」前提尚未满足；只记录不施工正是 Founder 本次要求。此裁决没有授权重设计其他通知、新增每次上传／搜索确认步骤或改变计费方式；若下场发现实现必须改变这些行为，先记录具体缺口与最小方案交 Founder 决定，不拿本条扩大范围。目前没有证据表明移除这三类段落本身需要改变后端钱路。

## R3-F07 · CI 旅程不稳：canvas 多选断言间歇失败（调查中）

**状态**：调查中，GitHub Actions 两次独立复现，均与触发该次运行的改动内容无关；main 分支 scheduled 夜跑近期全绿。不当场判产品缺陷、不放宽断言、不加重试掩盖，需要独立复现＋根因。

`e2e/journeys/17-canvas-selection.spec.ts:36`（FRONT-A15「键盘删得掉选中的卡,多选删得掉一组」）第79行 `await expect.poll(() => selectedIds(page).then((ids) => ids.sort())).toEqual([shot.nodeId, dud.nodeId].sort())` 期待 Shift 点选第二张卡后两张都留在 `selectedIds` 里；在该轮 poll 超时窗口内，`selectedIds` 有时只剩一张，断言超时判红。

两次独立触发命中同一断言：
- GitHub Actions run [34820228755](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/actions/runs/34820228755)（2026-09-14，PR #1445「TENANT-A1『重叠在飞互不串帧』补真并发测试」，分支 `claude/tenant-a1-overlap-test`）：attempt 1 在 `17-canvas-selection.spec.ts:79` 判红，attempt 2 重跑通过；该 PR 全部 diff 仅 `apps/web/lib/__tests__/tenant-a1-overlapping-frames.test.ts` 一个测试文件，未触碰 canvas 或 selection 代码。
- GitHub Actions run [34681183175](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/actions/runs/34681183175)（2026-09-12，PR #1402「切片①钱面建帧」，分支 `claude/tenant-slice1-money`）：同样在 `17-canvas-selection.spec.ts:79` 判红。

main 分支的 scheduled e2e（`.github/workflows/e2e.yml:26` `cron: "0 0 * * *"`）最近 8 次夜跑（2026-09-07 至 2026-09-14，均 `conclusion: success`）全绿；2026-09-06 那次 failure 在此窗口之外，未纳入本条判断。两次红都发生在与 canvas/selection 代码无关的 PR 上、且都精确落在同一行，指向该断言本身或其等待时序存在间歇性问题，而非这两个 PR 引入的回归。下一步：单独重跑该 spec 多次复现，核对 `selectedIds` 轮询窗口与 Shift 点选的实际时序，不在未定根因前放宽断言阈值或加重试次数掩盖。

## R3-F08 · 环境漂移：CI 与 staging 的 Postgres 大版本不一致

**状态**：已登记，建议另开票统一版本；本身不是产品缺陷，是测试环境与生产/staging 环境的版本口径缺口——RELY-A10 备份全灭（见 `docs/specs/fail-closed-reliability.md` §5 变更登记 2026-09-14 行）正是这条缺口在 staging 首次暴露成的真实后果。

- CI 服务容器固定 PostgreSQL 16：`.github/workflows/ci.yml:374`、`:447`、`:495`、`:555`、`:603` 与 `.github/workflows/e2e.yml:49` 均 `image: postgres:16`（`/usr/bin/grep -n "postgres:" .github/workflows/*.yml` 核实，见下方证据）。
- staging app DB 现场实测 PostgreSQL **18.6**（`environment-investigation.md` §数据库与存储隔离：`BEGIN READ ONLY` 查询得到 server version 18.6）。
- 本地开发 `docker-compose.yml:7` 现为 `image: postgres:16-alpine`（`/usr/bin/grep -n "postgres:" docker-compose.yml` 核实）；修复 PR #1442 计划将其改为 `18-alpine`，本仓库当前 HEAD 尚未合入该改动。
- 影响：版本类缺陷（如本轮暴露的 `pg_dump` 大版本不兼容导致 backup 全灭）在 CI 上永远测不出——CI 用 16 对 16 dump，从不对 18 dump；只有 staging 的真实 18.6 环境才会暴露。
- 状态：已登记，建议另开票把 CI 服务容器版本（ci.yml、e2e.yml）与本地 docker-compose.yml 统一到 18，对齐 staging/生产；不在本轮范围内直接改 CI 配置。

证据（`/usr/bin/grep -n "postgres:" .github/workflows/*.yml docker-compose.yml`）：
```
.github/workflows/ci.yml:190:  DATABASE_URL: postgresql://postgres:postgres@localhost:5432/fikirtive_test
.github/workflows/ci.yml:373:      postgres:
.github/workflows/ci.yml:374:        image: postgres:16
.github/workflows/ci.yml:446:      postgres:
.github/workflows/ci.yml:447:        image: postgres:16
.github/workflows/ci.yml:494:      postgres:
.github/workflows/ci.yml:495:        image: postgres:16
.github/workflows/ci.yml:554:      postgres:
.github/workflows/ci.yml:555:        image: postgres:16
.github/workflows/ci.yml:602:      postgres:
.github/workflows/ci.yml:603:        image: postgres:16
.github/workflows/e2e.yml:48:      postgres:
.github/workflows/e2e.yml:49:        image: postgres:16
.github/workflows/e2e.yml:66:      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/fikirtive_e2e_test
docker-compose.yml:7:    image: postgres:16-alpine
```

CodeGraph: not used — worker 在独立 worktree，按项目要求使用 rg 与直接文件阅读；未建立或借用主检出图。
