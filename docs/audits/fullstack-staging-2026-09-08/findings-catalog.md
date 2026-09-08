# 工程修复目录 — staging 2026-09-08

适用版本：`0e1f2ab3f1b05fba6112ee9544d6de5930648f83`（简称 `0e1f2ab3`），web/worker同版。下列源码行号均指该commit，不默认等于当前checkout。此目录整理已执行浏览器流程、只读DB/日志及定向源码证据；没有实施修复。

P1表示阻塞受影响核心流程或付款确认可信度；P2表示需要修复的可靠性/展示问题。严重度是本次工程分诊建议，不是已获准的改动范围。已退款不能使核心生成失败变为通过；单次双击/退款样本也不证明全应用安全。

证据入口：[后台回执](backend-evidence.md)、[执行记录](run-ledger.md)、[设计对照](design-parity-evidence.md)、[覆盖矩阵](coverage-matrix.md)、[自动检查边界](automated-checks.md)。截图29/30为1280×720；截图31实际1000×994，虽文件名含desktop，也不能当完整桌面截图。其他视口以执行记录为准。

## FSE-001 · P1 · 官方演员合成后的视频被拒，恢复建议无法帮助用户

- 复现：普通新账号验证后选官方Aisyah与自己的商品图，按系统建议先生成合成首帧，再批准5s/720p/3:4视频。
- 预期：已声明支持的官方演员路径可完成；若该输入不可用，应在下一次付费前准确说明限制与可执行的选择。
- 实际：合成图成功，视频HTTP400，`InputImageSensitiveContentDetected.PrivacyInformation`；提示却要求“Pick a cast member from your Library”，用户本来就用了官方演员。视频110 internal完整退款，无残留hold；未反复重试。
- 证据：[合成图25](25-avatar-product-first-frame.png)、[失败26](26-official-avatar-video-blocked.png)；合成job `01M1ZSRWZBJ5Q6RV95WV6ZZSYB`，video job `01M1ZSVK3CMWZ4754BY4J647MP`；provider在 `06:04:08Z` 拒绝input content[0]。`packages/generation/src/byteplus.ts:240` 将此错误分类为permanentInputError。
- 根因置信度：**拒绝来源及错误建议已确认；底层脸部识别为何不认可合成图尚未定位**。视频引用合成Generation，entityIds为空，不能仅凭该字段断定身份遗失是供应商拒绝原因。
- 建议：核验现役provider对官方演员原件、合成产物及视频输入的真实支持边界，保存原始字节与生成谱系的可核对证据；将拒绝恢复文案结合实际引用来源，避免再次推荐已失败的同一路径。不要用换脸、裁剪或伪造许可绕过provider限制，也不要无限自动重试。
- 复测：在同版、限额条件下走官方演员＋商品完整旅程；卡片引用与真实输入一致；失败只退款一次，建议明确；成功视频验证人物/商品连续性。未完成前保留此流程阻塞。

## FSE-002 · P1 · 双typed引用已保存，确认卡却丢失商品图

- 复现：在@菜单分别选择Aisyah和新生成商品图，提交双引用请求，再让Otto出合成图报价。
- 预期：两项引用跨消息、确认卡和任务完整传递；无法解析时在付款前拒绝并点名缺失对象。
- 实际：USER `01M1ZSCD0KB45H3NC0GJD084B2` 的referenceRefs包含官方演员及真实Generation；GEN_CARD `01M1ZSEKJ51KASJHDB9534D65Q` 仅含演员，无sourceGenerationId。要求纠正后又把旧GEN_CARD消息ID `01M1ZS6Z94N92QE2JHD5QT8DV8` 当商品ID，新卡仍缺图。最后改用Choose from Library实际附件才恢复双绑定。
- 证据：[引用22](22-avatar-product-references.png)、[缺图23](23-combined-reference-card.png)、[恢复24](24-corrected-reference-card.png)；真实商品Generation `01M1ZS96Z1K7QD7JPMSB5F3E9J`。恢复卡 `01M1ZSPV4ST83PC7M174YBWHZV` 同时保存sourceGenerationId＋Aisyah entityIds。
- 根因置信度：**持久结果差异、错误ID类型已确认；具体tool参数丢失过程未完整观测**。`propose.ts:73` 查询Entity；`propose.helpers.ts:895` 静默过滤非owned Entity，不能承载Generation引用。
- 建议：从已验证typed refs统一构造执行引用，按类型解析，禁止把卡片ID当Generation/Entity；显式报错替代无声丢弃。卡片和任务消费同一已解析结构，必要的跨轮引用继承也从持久记录恢复。
- 复测：@双引用及Library附件两条路径得到等价绑定；增加错误类型ID、引用已删除、跨租户ID、后续“显示卡片”短回复测试；断言无引用缺失的可付款卡。

## FSE-003 · P1 · “Send to Otto”未发送修改请求

- 复现：确认卡Change→输入“补上确切商品图”→Send to Otto。
- 预期：按该文案执行发送，或清楚显示需再次发送的草稿状态。
- 实际：没有新USER消息；最后USER时间仍 `05:56:23.340Z`。UI展开Conversation，没有生成新回复；用户最终只能改用主输入框。
- 证据：执行记录与后台“Change表单未发送”；`CardOptionControls.tsx:359`→`OttoTurnCard.tsx:321–323`→`OttoChatStream.tsx:1146`→`seedComposer:952–961`，最后只设置text，不submit。
- 根因置信度：**不发送的调用链已确认**；主输入框空白/旧表单仍有字的额外表现未完整定位。
- 建议：统一修改表单与主输入框提交动作，携带原卡/引用上下文；若产品决定仅创建草稿，则改成准确文案并明确交接，不能继续叫Send。
- 复测：点击一次产生一个用户修改事件与一轮回复，重载保留；双击不重复计费；无效输入与失败时草稿可恢复。

## FSE-004 · P1 · Edit and retry只恢复文字，遗漏原引用

- 复现：带原商品图的variation失败，刷新后点Edit and retry。
- 预期：重试保留原图及可编辑意图，用户能看到完整材料再确认。
- 实际：恢复扩写长提示词，但没有参考图chip；未继续付费测试。
- 证据：[失败19](19-variation-failure.png)；job `01M1ZRF0D1JWSCZGHN8EX6YCNJ`；`OttoChatStream.tsx:990` 只读latestUserText，`:952–961` 只setText。
- 根因置信度：**文字单独恢复已确认**。
- 建议：将重试草稿定义为文字＋typed refs＋源任务标识；从失败任务/原消息恢复，保留用户原话与生成稿区别；引用不可用则要求重新选择，不能静默变无条件生成。
- 复测：失败→刷新→重试草稿包含同一源图/演员；取消不收费；重新确认建立新授权，旧失败账本不重复结算。

## FSE-005 · P1 · Canvas终态与Conversation未实时同步

- 复现：Create variations失败或完成新合成图后，观察节点、Current turn及Conversation，再刷新。
- 预期：异步任务终态在同一Canvas及时一致呈现，不要求手动刷新。
- 实际：失败节点已出现，Current turn仍上一轮Done、Conversation17；刷新变Failed、19。另一次原商品节点暂时不在可见列表，刷新恢复；DB节点/Generation一直存在。
- 证据：[19](19-variation-failure.png)、[恢复27](27-refresh-restores-original.png)；原节点 `01M1ZS88FGYF4JQP43XBN9GHM1` 与合成节点 `01M1ZSRXGYY0ABM473M75E2Y82` 均done且未删除。
- 根因置信度：**实时显示缺口已确认；具体同步根因中等置信度**。`useCanvasGen.ts:837` 更新节点，`OttoChatStream.tsx:649` 的轮询依赖本地hasWorkingJob，直接Canvas动作可能没进入该消息投影。
- 建议：将任务终态作为共享刷新依据，统一使节点、聊天、余额失效并重读；避免依赖某一入口已先插入的本地消息才能启动同步。不要以强制整页刷新掩盖遗漏。
- 复测：直接variation及Otto批准两入口，成功/失败/退款/断网恢复均在无刷新条件下收敛；原节点保留，历史无重复，后台输出先于DONE提交。

## FSE-006 · P1 · 图片编辑能力说明与付款卡矛盾

- 复现：要求只改商品图背景并保留3:4。
- 预期：自然语言、确认卡、任务参数和输出画幅一致。
- 实际：Otto称编辑只能square/1:1；卡片、job和浏览器实际产物都是1728×2304、3:4。
- 证据：[矛盾16](16-edit-ratio-contradiction.png)、[产物17](17-edit-result.png)；job `01M1ZR6AG91BZ5DGGTEPPFWP3F`。`gen.ts:1490` 传aspectRatio；`packages/generation/src/byteplus.ts:271,295,382` 根据型号/比例发真实size。
- 根因置信度：**错误能力陈述已确认**；没有发现adapter强制square，模型错误知识来源未定位。
- 建议：把可售能力及拒绝原因从服务端能力表提供给Otto；付款前文本不能重新发明不在卡片里的限制。修复知识来源，不仅删除这句显示。
- 复测：同源图3:4/1:1编辑、未支持比例请求；所有可付款信息与验证payload相符。

## FSE-007 · P1 · Brand产品不能进入Library/@Products复用

- 复现：Brand创建E2E Coral travel mug / RM49，关联真实商品图，保存后查Library Products与@Products。
- 预期：批准的产品实体可以复用并保留同一身份/媒体。
- 实际：Ready BrandRecord存在且有imageAssetId；Entity PRODUCT为0，搜索无结果。
- 证据：BrandRecord `01M1ZSPTMDDGGHQ0VCHCJ85QWA`；`reference-search.ts:54`只查询Entity PRODUCT；后台“两个产品记录路径”证据。
- 根因置信度：**读写来源未接通已确认**。
- 建议：先明确canonical产品身份与现有BrandRecord/Entity关系，再接Library/reference reader及写入链；保留业务字段和媒体关联，不复制第二套可分叉产品真相。涉及schema/迁移需按项目重型流程。
- 复测：Brand保存→Library→@→确认卡→结果谱系指向同一产品；更新名称/图片传播，跨租户不可引用。

## FSE-008 · P2 · founder账号缺官方演员播种

- 复现：既有founder进入Official avatars。
- 预期：同一产品目录能力可用。
- 实际：founder Entity总数0；普通新用户验证后5位演员各两张参考图，功能并非全局缺失。
- 证据：[06](06-official-avatar-empty.png)、[07](07-avatar-library-empty.png)、[新用户20](20-new-user-avatar-detail.png)；`auth-guard.ts:79` founder直接返回，`better-auth/converge.ts:59–86`仅非founder调用bootstrap；`:315`才seed。
- 根因置信度：**高**。actor-library-seed测试还mock isFounderAdmin=false，不覆盖该分支。
- 建议：补齐founder/存量租户的同一幂等目录初始化路径；需要一次性补播时使用现有ops入口并明确授权，不借其他租户素材。
- 复测：founder及普通新用户首次/再次登录都有且仅有5位、各自owner及原件完整；不重复赠额。

## FSE-009 · P2 · 上传详情成本遗漏自动理解费

- 复现：新字节截图正常上传，等待Understanding完成，比较详情与Billing。
- 预期：用户能分清上传费、生成费、理解费及总费用。
- 实际：详情“No credits charged”，但理解任务一次扣0.1credit；Billing正确，非重复收费。
- 证据：[详情29](29-upload-detail.png)；Asset `01M1ZTC1RF2ZJ603HXAN02WQGJ`；Understanding `01M1ZTDQ133ZYN713PWQ208CG0` DONE，priceSnapshot1 internal，reserve/settle各一次。
- 根因置信度：**展示遗漏确认，具体详情费用聚合实现待查**。
- 建议：素材成本read model纳入关联理解任务，或明确写“Upload cost: 0”并单列理解费；单一账本来源，勿另算金额。
- 复测：全新上传、已理解重传、GENERATED重复上传、理解失败退款四类，详情与Billing逐项对应。

## FSE-010 · P2 · 全局余额跨标签页陈旧

- 复现：一标签页消费，另一标签页打开Billing对比全局栏与正文。
- 预期：同页余额一致，并在重新聚焦/消费完成后刷新。
- 实际：侧栏18.4、正文14.8；DB14.8且hold0。
- 证据：[余额30](30-billing-balance-mismatch.png)、执行记录06:20UTC补验。
- 根因置信度：**陈旧显示确认，具体缓存失效点未定位**。
- 建议：同一账户查询源，消费/退款/理解结算后统一失效；跨标签页或重新聚焦触发刷新。别把旧余额当实际可花预算。
- 复测：两个标签页消费、退款、异步理解，前台同页数字收敛且不闪成零；断网明确陈旧状态。

## FSE-011 · P2 · Profile邮箱字段空白

- 复现：新用户Profile保存含中文显示名后刷新。
- 预期：显示名保留，禁用的邮箱字段显示已登录邮箱。
- 实际：显示名持久化；邮箱disabled且value为空，DB两张身份表邮箱非空。
- 证据：执行记录Profile段；`profile-names.ts`返回gate.email；`app/profile/page.tsx:39`绑定names.email。
- 根因置信度：**UI表现及数据库反证确认，根因未定位**；未抓到该页面服务器返回值。
- 建议：沿认证principal→reader→Input核对返回与受控值，避免用数据库回填掩盖展示错误。
- 复测：新注册、验证码/密码登录、刷新及显示名变更；邮箱只读且正确，不显示别的用户信息。

## FSE-012 · P2 · 数量更新时保留旧报价付款按钮

- 复现：确认卡count1→2，观察响应返回前。
- 预期：未完成重报价时不能从互相矛盾的选择与旧报价付款。
- 实际：选择先显示2，Generate仍可点且显示1credit；完成后正确显示2。付款前恢复1，**未测试窗口内支付**。
- 证据：执行记录数量测试；`CardOptionControls.tsx:75,88,127`子busy/pending，与`OttoTurnCard.tsx:234,347`父busy分离。
- 根因置信度：**混合状态窗口确认；错误收费未证明**。
- 建议：把报价pending与审批禁用同步，并在服务器批准时校验所见版本/参数。最终以一个已确认payload报价。
- 复测：快速连续改数量/比例后立即审批，拒绝旧报价并无预扣；成功只执行最后明确批准的配置。

## FSE-013 · P2 · 官方来源不可达后仍给确定规格，工具状态也不符任务

- 复现：只请求当前Instagram portrait photo尺寸与两个官方链接，不要求生成。
- 预期：获取到的官方证据支持具体结论；无法验证时保留不确定性；进度准确表示资料查询。
- 实际：主会话观察Help Center受阻后仍确定声称4:5上限/3:4裁剪，进度却为Researching your brand / Otto is making it。本轮独立Help Center请求亦429，**尚无依据将尺寸结论本身判为错误**。
- 证据：执行记录研究补验；OttoTurnTrace `otto-stream:01M1ZTZ4F2MFHWSQEZEMA5JXMA`，4steps、researchWeb调用3次成功返回，净扣3.8credits，无新GenJob、无hold。工具成功返回不等于官方网页成功读取。
- 根因置信度：证据不足却作确定陈述及错误进度标签为UI观察；内部搜索/读取子请求与具体推理来源未完全重建。
- 建议：把“找到链接”“成功读取”“内容支持结论”分开记录与呈现；缺证时明确未验证，不用记忆包装当前规则。进度根据实际工具动作显示。Working时Stop是否必需另核验批准契约，未凭此次缺按钮直接判违规。
- 复测：官方源200/429/超时/冲突四类，答案确定程度与证据相称；仅研究不启动生成、结算一次、输入恢复。

## DESIGN-001 · 需Founder对齐 · Library编辑职责存在批准规格冲突

已确定的展示偏离：大预览后缺主要Use in Canvas；长prompt/engine receipt未折叠且先于复用动作。证据：[详情12](12-library-asset-details-desktop.png)、设计对照；Library README:71–79与DetailPanel:890–950、1019。

但不能把全部Regenerate/Generate edit/Crop直接列成未经批准：Library README:98,110要求编辑去Canvas；冻结creation-engine.md:65/76允许资产详情Generate edit/Regenerate。**动作归属是已批准文档冲突，不是工程师可静默删除的bug。**建议在change register统一职责；随后接共享业务动作和typed handoff，复测Library→Canvas→返回上下文。顺序/折叠偏离可单独评估，不等待以任何一方抹掉另一方批准。

## DESIGN-002 · P2 · 官方演员详情缺已批准复用能力

新账号5位演员真实存在，但正式详情仅首图和计数，没有Use in Canvas/Favorite/route-backed detail；过滤与完整reference预览不足。证据：[20](20-new-user-avatar-detail.png)、设计对照中LibraryView:396–543、library-elements:22–65、Library README:64–69、133。

建议从真实catalog数据扩展reader并接已批准入口，缺metadata/样片时诚实留空。不得用fixture补假演员许可或样片；fixture6人不意味着正式必须6人，voice按视频设置，无批准依据要求固定voice播放器。复测真实refs、只读身份、Favorite持久化、Back/深链、Use in Canvas不自动花钱。最终actor视觉fixture仍有待Founder验收边界。

## 不混作既有缺陷的新设计反馈

Founder已明确要求优化左下Conversation history，见[原话与边界](founder-design-feedback.md)。截图31仅1000×994局部环境；过窄气泡、按钮遮挡等应在新方案中验证。请求优化不等于具体布局已批准；本轮未重设计。

## 交付门槛与未覆盖项

推荐优先复测FSE-001至007的Creation/付款确认/引用恢复链，再修P2显示一致性；跨规格动作归属单独取得Founder决定。本目录不授权部署、改生产、数据删除或继续生成。

本轮成功样本包括图片、无人物视频、双击一次预扣、失败退款、新账号25credits与五演员播种、上传理解，以及 Library 动画超额动作在 cap=1 时被拒且不入队、不扣费（随后恢复 cap=0）；仍不能宣称整个应用安全或全量E2E绿色。数据库并发攻击、全面双租户写隔离、全部入口及并发cap执行、任务取消、完整下载字节、辅助技术/跨浏览器覆盖按coverage-matrix与automated-checks保留未完成状态。研究轮后客户收费USD3.82等价与供应商费用不同；聊天供应商真实总额仍未完整核对。
