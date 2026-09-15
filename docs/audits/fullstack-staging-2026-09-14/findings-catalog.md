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

### R3-F01 收尾更新（2026-09-15，staging 第二轮登录态只读）

staging 第二轮只读走查（`docs/audits/fullstack-staging-2026-09-14/local-logs/staging-r2/workflow-r2-result.json`，identity-admin 组，对应验收 REAL-31）已把此条**判定为工具取证假象，RESOLVED，非产品缺陷**：四次独立读取 `/profile` 的 `#profile-email`（首次加载、刷新、新标签、离开再返回）DOM value 均为 17 字符、与账户邮箱一致、非空；根因是浏览器工具的无障碍树（`read_page`）从不打印 `<input>` 的 value（Display name 输入框同样表现——JS 能读到 `#profile-display-name` 的 value="tools" 且截图可见"tools"，但 `read_page` 只印裸 `textbox "Your name"`），并非应用把邮箱清空。日后同类取证一律改用 `javascript_tool` 直接读 value，不得只信 `read_page` 的无障碍树输出。原稿的初始 DOM 观察与后续更正保留原样，本节只是收尾追加、不改历史行。

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

### R3-F05 收尾更新（2026-09-15，staging 第二轮登录态只读）

staging 第二轮只读走查已实机复现此症状，把范围收窄并给出根因假说（读码支持，未执行修改）：焦点丢失**只发生在 Library「Asset details」对话框**（Escape 后 `document.activeElement` = BODY；对话框打开时的**初始**焦点正确落在 Close，只有**关闭后的返回**丢失）；同一走查里 Connections「Add connection」对话框在同一会话内关闭后能正确把焦点还给触发它的按钮，是有效正对照（该对话框自身另有 R3-F09 记的初始焦点问题，两者不是同一件事）。根因假说：`apps/web/components/library/LibraryView.tsx:1257` 按需挂载 `DetailPanel`（`{detail ? <DetailPanel … onClose={() => { closeDetail(); router.refresh(); if (gridView) void reload(view, filters); … }} /> : null}`），`apps/web/components/asset/DetailPanel.tsx:809-812` 是硬编码 `open` 的受控 `<Sheet>`（靠卸载而非 `onOpenChange` 关闭）；关闭因此触发列表重取与重渲染，把 Radix 记下的「原卡按钮」焦点回退目标一并换掉，焦点于是落到 BODY。Connections 对话框行为正确，是因为它是持续挂载的受控 `<Dialog open={addConnectionOpen}>`（`apps/web/components/otto/OttoConnections.tsx:580`），触发它的按钮在关闭时仍然存在。**修复见 PR #1446**（「[FRONT] Library 素材详情关闭后键盘焦点回到原素材卡」，状态 OPEN）。以上为读码假说，本轮走查未执行修改、未验证修复后的行为。

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

**状态**：Founder 2026-09-15：根因出来即修；GitHub Actions 两次独立复现，均与触发该次运行的改动内容无关；main 分支 scheduled 夜跑近期全绿。不放宽断言、不加重试掩盖，需要独立复现＋根因。

`e2e/journeys/17-canvas-selection.spec.ts:36`（FRONT-A15「键盘删得掉选中的卡,多选删得掉一组」）第79行 `await expect.poll(() => selectedIds(page).then((ids) => ids.sort())).toEqual([shot.nodeId, dud.nodeId].sort())` 期待 Shift 点选第二张卡后两张都留在 `selectedIds` 里；在该轮 poll 超时窗口内，`selectedIds` 有时只剩一张，断言超时判红。

两次独立触发命中同一断言：
- GitHub Actions run [34820228755](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/actions/runs/34820228755)（2026-09-14，PR #1445「TENANT-A1『重叠在飞互不串帧』补真并发测试」，分支 `claude/tenant-a1-overlap-test`）：attempt 1 在 `17-canvas-selection.spec.ts:79` 判红，attempt 2 重跑通过；该 PR 全部 diff 仅 `apps/web/lib/__tests__/tenant-a1-overlapping-frames.test.ts` 一个测试文件，未触碰 canvas 或 selection 代码。
- GitHub Actions run [34681183175](https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/actions/runs/34681183175)（2026-09-12，PR #1402「切片①钱面建帧」，分支 `claude/tenant-slice1-money`）：同样在 `17-canvas-selection.spec.ts:79` 判红。

main 分支的 scheduled e2e（`.github/workflows/e2e.yml:26` `cron: "0 0 * * *"`）最近 8 次夜跑（2026-09-07 至 2026-09-14，均 `conclusion: success`）全绿；2026-09-06 那次 failure 在此窗口之外，未纳入本条判断。两次红都发生在与 canvas/selection 代码无关的 PR 上、且都精确落在同一行，指向该断言本身或其等待时序存在间歇性问题，而非这两个 PR 引入的回归。下一步：单独重跑该 spec 多次复现，核对 `selectedIds` 轮询窗口与 Shift 点选的实际时序，不在未定根因前放宽断言阈值或加重试次数掩盖。

**根因与修复（PR #1452）**：React Flow 12.11.1 在 Shift keydown 之后要等一个 passive effect 才把 `multiSelectionActive` 写进 store；节点的 `onClick` 处理器同步读这个 store 值来判断这一次点击是「替换选中」还是「加选」。Shift 点选第二张卡时，如果 click 事件在那个 passive effect 落地**之前**触发（快速连续点击时常发生），`onClick` 读到的还是旧值（未激活），于是走了替换分支而不是加选分支，选中集合被换成只剩这一张，而不是两张都在。修法：`CanvasMultiSelectModifier` 改到捕获阶段直接从触发点击的原生事件本身读修饰键（`event.shiftKey`），不再依赖 React Flow store 的异步写入时序；详见 R3-F17（本文件后段）关于本条两次真实红为何拿不到 trace 的记录。

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

## R3-F09 · Connections「Add connection」对话框初始焦点落在首个 Connect 按钮（新发现待裁）

**状态**：Founder 2026-09-15：本版修；a11y／设计问题，staging 第二轮登录态只读走查观察到，未执行连接动作、未改产品。

`apps/web/components/otto/OttoConnections.tsx` 的「Add connection」对话框打开后，**初始焦点直接落在第一个 `Connect` 按钮**（OAuth 起点，如 :602 一类的首个可聚焦元素），不是对话框本体或 `Close`；读码未见任何显式 `autoFocus`/`initialFocus` 覆写，与默认交给 Radix Dialog 把首个可聚焦元素设为焦点的行为一致。商家打开对话框后如果手误按一次 Enter，就会直接对该服务发起 OAuth 连接流程——不是关闭对话框那样安全的默认动作。对照：Library「Asset details」对话框打开时的初始焦点正确落在 `Close`（见 R3-F05 收尾更新）。下一步：若判定需要修，按现有对话框的既有模式把初始焦点显式设到 `Close` 或对话框容器，覆盖 Radix 默认。

## R3-F10 · 停放路由机制分裂：三条旧地址先回 200 再重定向，与规格「一律 307」不符（规格偏差待修）

**状态**：Founder 2026-09-15：本版修；staging 第二轮走查配合读码确认，独立验证员已就此把 REAL-26 由 PASS 降为 PARTIAL。

`docs/specs/wave2-shell.md:188`（§2.5 深链兼容）逐字写「每一条旧地址都 **307**，永不 404（`MERCHANT_NAV_REDIRECTS` 的老纪律照旧）」。`MERCHANT_NAV_REDIRECTS`（`packages/core/src/navigation.ts:309-350`）恰好六条：`/campaign/calendar`、`/campaign`、`/schedule`、`/schedule/analytics`、`/library/editor`、`/crm`。走查按登录态实测发现其中三条——`/schedule`、`/schedule/analytics`、`/library/editor`——在 HTTP 层**不是**重定向，而是先回 `200` 并流出一具骨架页再由客户端 `redirect()` 跳走；根因是这三条各自的 `page.tsx` 旁边挂了 `loading.tsx`（`apps/web/app/schedule/page.tsx` + `apps/web/app/schedule/loading.tsx`；`apps/web/app/library/editor/page.tsx` + `apps/web/app/library/loading.tsx`），Next.js 在这类结构下先流式返回 `loading` 骨架、状态码 200，重定向发生在其后。其余三条（`/campaign/calendar`、`/campaign`、`/crm`）在 LAYOUT 层重定向（如 `apps/web/app/campaign/layout.tsx`），没有旁挂 `loading.tsx`，因此确实是一次真 HTTP 307、无骨架闪烁。商家侧最终落点全部正确、未观察到骨架闪烁，差异是**机器可见**的（爬虫或探活脚本会把 `/schedule` 当成一个存活的 200 页面，而不是一条已收敛的旧路由）。项目此前已经把「防止旧路由先回 200 再走」当成要避免的事——`docs/specs/wave2-shell.md:698` 的 W2-13 曾专门删掉 7 个 CRM 的 `loading.tsx` 好让 CRM 真的走 HTTP 重定向，而这三条恰恰是同一种结构仍然存在的地方。下一步：若要与规格逐字对齐，删掉这三条 `page.tsx` 旁的 `loading.tsx`（或把重定向提到 layout 层），使其在 HTTP 层也回 307。

## R3-F11 · `/crm/anything` 落到裸 Next.js 404，无导航壳、无回路（新发现待裁）

**状态**：Founder 2026-09-15：本版修；staging 第二轮登录态只读走查确认。

`/crm` 本身与其下全部七个真子路由都会重定向回 Home（符合 `MERCHANT_NAV_REDIRECTS` 与规格），但任何**不存在**的 `/crm/*` 子路径（如 `/crm/anything`）落到的是裸 Next.js 404 页面（标题「404 / This page could not be found.」，文档 title「Fikirtive」），没有导航壳、没有任何回到产品内的链接或按钮。一条被误输入或过期收藏的 CRM 深链会把商家直接甩出应用外壳。下一步：若判定需要修，让 `/crm/[...catchall]` 之类的通配路由也统一进 `MERCHANT_NAV_REDIRECTS` 的重定向逻辑（回 Home），或至少套上应用壳的 404 页面而不是框架默认页。

## R3-F12 · Billing 花费历史把 RESERVE+REFUND 合并成一行且金额显示 0，商家看不到扣退了多少（新发现待裁，有迹可循原则）

**状态**：Founder 2026-09-15：本版修；staging 第二轮登录态只读走查 + 只读账本核对确认，命中「有迹可循」产品原则。

`/billing` 的花费历史把一笔 `RESERVE`+`REFUND` 配对显示成单独一行、金额栏是字面的 `0`：`['Video','Held, then refunded in full','Sep 11, 9:02 PM','0']`，该行没有任何 `title`/`aria` 属性携带真实数字。核对 `CreditLedger` 账本：这笔恰好是 `RESERVE -110` / `REFUND +110`（内部积分，110 内部 = 11 显示积分），对应 GenJob `01M288VJS12BBT536TZF5T0S01`（该单失败原因已存库：`error = "generation provider video submit failed (400)"`，与 `docs/audits/fullstack-staging-2026-09-11/backend-evidence.md:246-248` 记录的同一单一致）。商家能看到「有东西被扣过又退了」，但看不到扣退的是多少——这与产品「有迹可循」的方向相悖（花了多少、退了多少，商家应该看得见）。注：此条与 FSE-204（失败卡不显示失败原因）是两回事——`creation-engine.md:183` 裁定的 FSE-204 修法本身只要求「付费前拒绝并说出实际短边」，`frontend-baseline.md:136 ④` 另外裁定失败卡只留「You weren't charged.」不留原因、不留重试按钮，此二者均已按裁定落地（commit `6624e832`），失败卡不显示原因是**按设计**，不是本条要修的问题；本条要修的是**金额显示**，与失败原因无关。下一步：给花费历史这一行补上真实金额（数字或至少 `title`/`aria-label`），不影响卡片本身的失败文案裁定。

## R3-F13 · 旧版 Otto 深链 `/otto?project=&thread=` 从对话第一轮渲染，46 轮线程落在数月前的欢迎语（新发现待裁）

**状态**：Founder 2026-09-15：本版修；staging 第二轮登录态只读走查确认，独立核证已在数据层复核过深链本身能正确定位到目标画布/线程（对应 REAL-27 的 PASS）。

从旧版深链 `/otto?project=<id>&thread=<id>`（无 `?view=` 等新参数）打开的 Otto 对话面板，会从该线程的**第一轮**开始渲染并显示「Scroll to end」提示，而不是停在最新一轮；在一条 46 轮的真实线程（`Cat drinking coffee video`，画布 `Hi!`）上，商家因此会先看到数月前的欢迎语，须自己点「Scroll to end」才能回到最新对话。深链本身对目标画布/线程的定位是对的（同一批走查已在数据库层核实：该线程的 `title` 与 `projectId` 与页面上看到的 header/thread chip 完全一致），本条只是渲染起始位置的问题。下一步：若判定需要修，让这条旧版深链打开面板时也定位到线程末尾（与新参数形态的行为一致）。

## R3-F14 · 已冻结规格条款未实现：Connections 顶部缺失「无法连接 IG/FB」实话提示（冻结规格条款未实现待裁）

**状态**：Founder 2026-09-15：本版修；staging 第二轮登录态只读走查 + 全文检索确认。

`docs/specs/wave2-shell.md:394-395` 要求在 Connections 页顶部加一句今天缺的实话：「No Instagram or Facebook account can be connected right now, so nothing here can be linked yet. Your schedule stays real either way.」（规格原文标注来源 `simulated-features.json` 第 12 条）。对 `apps/web` 全文检索未找到这句话，唯一近似的是 `packages/core/src/schedule-draft.ts:162` 的另一句不同的话；页面上 Instagram 一行今天渲染的是正常的 `Connect` 按钮，不是这句免责声明。留一句说明：规格引用的账本文件 `simulated-features.json` 在仓库里已不存在，也可能是这句话已被有意撤销/不再适用——本条按「未验证到底哪种情况」登记，不代表已证的产品缺陷，留给 Founder 一句话判断是已经不需要这条规格条款，还是需要补上。

## R3-F15（低，UNVERIFIED，仅读码）· 内联文件链接不查存活性，指向已软删素材的旧链接可能仍可打开

**状态**：Founder 2026-09-15：本版修；低优先级、仅代码阅读、未经运行时验证（staging 当前没有已软删的 founder 素材可供实测）。

`apps/web/app/files/[...key]/route.ts` 的内联 GET（非 `?download=1` 分支）只过 `keyOwnerMatches()`（:71）与既有的 allowlist 拦截；只有 `?download=1` 分支才额外查一次 `Asset` 活行（`where: { ownerId, contentHash, deletedAt: null }`，:30）。同一租户命名空间内、指向已软删素材的旧内联链接，理论上可能仍能被这条内联路径解析出来——不是跨租户可利用（命名空间闸本身成立，已由本轮其他验收证实），只是「软删是否真的让旧内联链接失效」这件事今天代码层面看不出保证。因 staging 当前不存在任何已软删的 founder 素材，本条无法实测，按纯读码记录，不当场判定为缺陷。下一步：找一个可安全软删的测试素材，核对其旧内联链接（非 download）是否仍可打开；若可，评估是否需要给内联分支也加上活行校验。

## R3-F16（候选）· 画布结算积压扫描可被静默吞掉，积压可能永不清

**状态**：Founder 2026-09-15：本版修；来源 PR #1451 worker report，PR 本身未改这一段（只把测试的并发形状改成产品真实形状），此发现是顺带记录。

`packages/db/src/canvas-settlement.ts:414` 定义 `CANVAS_BACKLOG_STATEMENT_TIMEOUT_MS = 2_000`，`:495` 用它对积压扫描查询 `SET LOCAL statement_timeout`；机器负载高时扫 1001 块板会被 Postgres 用 57014（`statement timeout`）取消该语句。`apps/worker/src/jobs/canvas-backfill.ts:94-96` 的 `catch` 把这次取消吞掉，只 `console.error` 后 `return 0`——PR 作者称其为刻意的 fail-safe（宁可这一轮扫描 0 行，也不要一条烂查询拖垮 worker），但对外表现是**没有任何告警**：生产上持续高负载时，这条积压扫描可能悄无声息地永远清不完，且没有任何信号提醒运维。PR #1451 本身在真实并发形状下验证了这个吞掉分支存在（10 跑里之前 4 次撞到 57014），修复的是测试自己的并发假象，不是这条 fail-safe 的告警缺口；该缺口已登记进 `docs/specs/fail-closed-reliability.md` §5 变更登记（2026-09-15 行）。下一步：给这条 catch 分支补一次可观测信号（Sentry 或 founderAlert 一类既有告警通道），不是简单删掉 `try/catch`——2000ms 语句超时本身是刻意的保护，要修的是「取消之后没人知道」，不是超时设置本身。

## R3-F17 · CI 工件上传跳过隐藏目录，e2e 失败 trace／截图从未上传

**状态**：Founder 2026-09-15：本版修（对谈）。

`.github/workflows/e2e.yml:152` 用 `actions/upload-artifact@v4` 上传 `e2e/.report`（:156）与 `e2e/.artifacts`（:157），两条都是点号开头的隐藏路径；`upload-artifact@v4` 默认跳过隐藏文件/目录，job 日志因此打印「No artifacts will be uploaded」，即便这一轮确实有 Playwright 失败产生 trace 与截图。后果：R3-F07 记录的两次 `17-canvas-selection.spec.ts` 真实失败（run 34820228755、34681183175），都没有留下 trace.zip 或失败截图可供下载复核，只能靠日志文本定位——这正是 R3-F07 当时只能引 job 日志、引不出 trace 的原因。修法：给这一步加 `include-hidden-files: true`。

## 本轮补记（2026-09-15，staging 第二轮登录态只读旅程）

来源：`docs/audits/fullstack-staging-2026-09-14/local-logs/staging-r2/workflow-r2-result.json`（4 个 worker 并行、build `14bcd038`、以 Founder org `founder`（租户 A，super-admin）已登录会话跑，绝不登出、US$0、零远端写入——只读证明见该文件 `result.results[1].writesMade`：自 2026-09-15 03:55 UTC 起 `CreditLedger`/`GenJob`/`Generation`/`ChatMessage`/`CanvasNode`/`Project`/`ChatThread` 零新增或更新行），并经一名独立核证员对每条自报状态复核（`result.verdicts[*]`，找到能推翻的就推翻，找不到的原样通过）。**REAL-05 的一条自报「Send 是独立、绝不自动触发」的分句被核证推翻**：`apps/web/components/start-something/StartSomething.tsx:288-294`——`if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && draft.trim()) { event.preventDefault(); startCanvas(draft); }`——回车（非输入法组字中）会直接调用会创建 Project + ChatThread 并起一轮 Otto（该页面同屏就写着每条消息预留 4 credits）的 `startCanvas`；`apps/web/components/otto/OttoChatStream.tsx:1205` 是同款处理。核证员的浏览器控制工具能把 keydown 递到页面 JS、只是不触发原生默认动作，因此走查过程中输入框里躺着一句真实中文草稿「为这款杯子做广告」时，一次未加修饰键的真实 Enter 本会当场发生真实写入与真实扣费——本轮走查全程零写入是靠核证员自己的清空动作与只读复核兜住的，不是这条自报分句成立的证据。这是**观察记录，不是产品缺陷**：Enter 发送是聊天类产品的市场通用行为（业界常见，不属反常设计），只是本轮 US$0／零写入前提下这一按键路径构成过一次真实的花钱风险，记在案供下一次同类只读走查设计防护步骤（例如复核前先清空输入框，而不是只考虑鼠标路径）。

CodeGraph: not used — worker 在独立 worktree，按项目要求使用 rg 与直接文件阅读；未建立或借用主检出图。
