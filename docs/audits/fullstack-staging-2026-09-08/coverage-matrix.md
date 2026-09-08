# Staging 审计覆盖矩阵

日期：2026-09-08。版本：web／worker `0e1f2ab3f1b05fba6112ee9544d6de5930648f83`（简称 `0e1f2ab3`）。本矩阵仅汇总同目录四份记录，没有新增浏览器操作、代码调查、网络请求或测试运行。**这是有限样本覆盖，不是全量验收通过，也不是发布批准。**

## 证据与状态口径

- **UI**：[run-ledger.md](run-ledger.md) 的主会话实际操作与截图记录。
- **DB／日志**：[backend-evidence.md](backend-evidence.md) 的版本、只读数据库与供应商日志证据；其中转述浏览器结果的段落仍属于 UI 证据。
- **SOURCE**：[design-parity-evidence.md](design-parity-evidence.md) 的代码／批准设计比较，不升级为运行结果。
- **CHECK**：[automated-checks.md](automated-checks.md) 的测试预检；未运行测试。

PASS 只表示本行明确限定的已执行样本通过；FAIL 表示实际失败或已核实偏离；PARTIAL 表示部分步骤成立但整体未闭合；NOT RUN 表示未执行；BLOCKED 表示已有明确环境／依赖障碍。SOURCE-only 行不等于行为测试结果。

时间较晚的证据补充较早记录：backend-evidence 末轮已证明新字节上传理解完成、刷新后原商品节点重新出现。因此不沿用 run-ledger 尾部“新外部理解仍未验”的旧状态，也不把中途 UI 缺节点写成数据库删除。

## 流程覆盖

| 流程／验收范围 | 状态 | 已有证据与实际结果 | 未覆盖／工程交接 |
|---|---|---|---|
| 正常注册 → 邮件验证 → Home → 初始额度与官方演员 | PASS | UI：新商家完成确认邮件；DB：active membership、单次 GRANT 250 internal、25 credits、5 位 actor 各两张参考图 | 单个普通账号；非并发重复注册、邮件 SLA 或全部认证机制证明 |
| 登录／登出整体 | PARTIAL | UI：已有会话工作；IAB 登出后完成新注册验证，不影响 Chrome | 独立密码重登、过期会话、找回密码等未见完整证据 |
| Google callback | BLOCKED | 本轮前置实测出现 redirect_uri_mismatch，截图01-google-oauth-blocked.png；Founder 已说明正在配置 staging callback | 修复后复验 NOT RUN；不能签署 Google 登录成功 |
| Founder 账号官方演员目录 | FAIL | UI 目录为空；DB founder Entity 为 0；SOURCE founder 分支绕过普通账号播种 | 与普通新商家播种成功分开；不可宣称所有人都缺演员 |
| Home 空态／Customize | PARTIAL | UI 空数据诚实展示；Customize 打开取消 | Ready／多源数据、保存与恢复、权限未闭合 |
| Create 目标 → 唯一 Canvas → 第一轮澄清与报价 | PASS | UI CRE-01：4:5 不支持时询问替代、选 3:4、1 credit 报价、进入同一 Canvas；DB job 对应 | 单样本；不代表全部深链／Back／Forward／重复 first-turn 矩阵 |
| Canvas 产品图片生成 | PASS | UI 完成；DB founder 与新商家各有 DONE 图片，单次预扣／结算 | 有限提示、比例、数量样本；不是全部规格能力验收 |
| Canvas 图像编辑 | PARTIAL | UI 新图成功且原图保留；DB sourceGenerationId 正确、3:4；浏览器 1728×2304 | Otto 同时声称只支持 1:1，能力解释 FAIL，不能把成功出图等同完整体验通过 |
| Canvas variations 交付 | FAIL | UI 快速双击确认后无产物；DB 单 job FAILED，provider returned 0/1 usable images | 未成功交付 variation；用户获退款不抹掉创作失败 |
| 上述双击样本的幂等／退款 | PASS | DB 恰好一 RESERVE、一 REFUND、无 SETTLE、reserved=0 | 仅该 UI 双击样本；未构造并发 HTTP、结算竞争或退款竞争 |
| 产品图 → 无人物视频 | PASS | UI CRE-02 实际播放约 5.04s；DB DONE、5s／720p／3:4／audio=false、同一 source、一次结算 | 不代表有演员视频、所有音频／长度／比例组合通过 |
| 官方演员＋产品：typed mention 保存 | PASS | DB 用户消息有 official-avatar 与 generation 两个 typed references | 这里只证明消息保存，不证明执行材料完整 |
| 官方演员＋产品：mention → 生成确认材料 | FAIL | UI 文案称两者均用；DB 初始确认卡只绑定 actor，无商品 sourceGenerationId；修正回复还把 GEN_CARD message ID 当商品 ID | 精确修复 mention／提案／确认材料链；没有错误卡付款证据 |
| Change → Send to Otto | FAIL | UI 无消息写入；SOURCE 按钮只转交文字，不真正发送 | 对齐按钮语义与实际动作；不推断尚未定位的事件冒泡根因 |
| Choose from Library 修正双引用 → 合成首帧 | PASS | UI 显式附件后双引用卡成立，产物为 Aisyah 持橙杯；DB DONE、actor＋product source 正确 | 是绕行恢复样本，不是原始 mention 流程已经修好 |
| 官方演员＋产品合成图 → 视频 | FAIL | UI 错误要求再次选 actor；DB FAILED、退款 11 credits；provider HTTP400 `InputImageSensitiveContentDetected.PrivacyInformation` | 核心旅程未闭合；官方来源合成后的可接受输入／身份链需排查，不应机械反复收费重试 |
| Canvas 当前状态／Conversation 实时同步 | FAIL | UI failed 节点出现时 current turn 仍 Done，刷新后 Failed、消息数17→19 | SOURCE 提供轮询依赖假说，尚非埋点证明的完整根因 |
| Edit and retry 材料恢复 | FAIL | UI 恢复文字但无 reference chip；SOURCE retry 仅 seed text，不恢复 sourceGenerationIds／referenceRefs | 本轮未继续提交不完整 retry；应恢复原材料与报价关系 |
| Canvas 空间操作与持久化 | PARTIAL | UI drag、Fit to screen、文字便签成功，刷新后内容仍在；DB 原商品节点／Generation 未删 | 合成后原商品暂时不可见、刷新恢复；客户端投影／viewport 尚待定位；精确 pan/zoom、所有操作矩阵未闭合 |
| Canvas／全局 Otto 会话名称与pin | PARTIAL | UI历史打开、pin、rename、空白名称不可保存；DB新会话title／pinnedAt持久化 | 未见完整跨会话恢复／排序验收；Thread名与Canvas名不自动要求相同 |
| 报价数量1→2→1 | FAIL | UI 最终价正确，但更新期间新数量＋旧可点击价格同屏；SOURCE 子父 pending 不同步 | **没有在窗口付款，不能报已发生错扣**；需报价材料一致且更新时无法确认 |
| 纯规划与中文／Malay文案 | PASS | UI返回建议；DB保存准确generation reference、无新增生成job；后补OttoTurnTrace steps1、toolCalls=[]，证明该轮没有调用搜索工具 | 仅“不搜索／不生成且返回建议”样本通过；约67.5s是总完成时长非首字延迟；文案质量非全面评测 |
| 只研究Instagram规格，不生成 | PARTIAL | DB／trace：researchWeb calls3、ok3、failed0、steps4、无新增GenJob；单次净扣3.8 credits | UI官方文章读取失败后仍给确定“当前”结论；3次工具成功不等于官方内容成功读取。3:4比4:5更宽的算术解释错误、下一次可直接4:5承诺与早前限制矛盾；工具状态标签不符任务，无Stop为UI观察，取消未执行 |
| 重复上传已有生成图 | PASS | UI 正常文件选择成功；DB 重用 Asset、新 UPLOAD Generation、无理解任务 | source 仍 GENERATED 被扫描规则跳过；不是理解缓存命中证明 |
| 真正新字节上传 → 图片理解 | PARTIAL | backend 末轮：UPLOAD、新 Asset、Understanding DONE、单次0.1 credit结算；实际元数据JPEG1000×994 | UI “No credits charged”仅能描述上传，未表达另收理解费；完整授权披露与用户结果展示尚未闭合 |
| Library 搜索／排序／Favorite／Collection | PARTIAL | UI搜索、Oldest first、Favorite、新建／打开collection成功；空名不可建；后补Generated／Today／Canvas筛选、无匹配与Clear filters恢复样本 | 所有跨页、跨刷新持久化、成员移除、深链／Back等未完整验证 |
| Library 生成详情设计 | FAIL | UI 详情差异；SOURCE 长提示／engine receipt 展开在动作前，缺主要 Use in Canvas | **直接编辑的归属有冻结规格冲突**：Library要求去Canvas，Creation spec允许资产详情Generate edit/Regenerate；先裁定，不静默删功能 |
| Official avatar Library preview／reuse／filter | FAIL | UI Aisyah只读单图详情；SOURCE 本地Dialog、首图＋count、无Use in Canvas/Favorite、仅type tabs | 数据reader也未返回丰富字段；不等同源数据不存在；5个生产演员不因fixture6个而违规；不要求未批准固定voice播放器 |
| Download／Copy link | PARTIAL | UI后补观察到download事件，证明启动；SOURCE有对应动作 | 完整下载文件格式／字节验证NOT RUN，外部链接实际打开／过期未验证；不能算完整导出成功 |
| Crop | PARTIAL | UI 打开／取消；footer低对比截图13 | 未执行裁剪保存／恢复；职责冲突另见Library行 |
| Brand Audience → Save context | PASS | UI 新建／预览／Ready；DB Memory与confirmed revision对应 | 单个测试Audience；未证明保存前draft绝不进入Otto、全部Brand分区或跨租户攻击 |
| Brand Product → Library／@ Product复用 | FAIL | UI 建产品并关联图片成功，但Library Products和@E2E无匹配；DB BrandRecord存在、Entity PRODUCT为0；SOURCE @读Entity | **BrandRecord与Entity两条产品来源未接通**，不是搜索关键词问题 |
| Brand Knowledge base编辑入口 | PASS | UI Knowledge base标题匹配，存在Open the record editor链接到/brand/records | 仅入口可达性通过；不能称产品编辑入口完全不可达，也不证明Product跨模块复用成立 |
| Brand Style guide空白草稿／取消 | PASS | UI分区标题匹配；纯空白Name／Source内容时Review draft禁用，Cancel正常 | 单个无效输入样本；未证明完整Style guide生成／保存／Otto消费 |
| Settings General／Connections | PARTIAL | UI空改动禁保存；Connections空态／Add connection打开；后补Escape关闭并回焦Add connection | 未连接第三方、未验证外部授权与断连；一个Escape样本非全站键盘验收 |
| Profile 显示名／邮箱 | PARTIAL | UI显示名保存刷新保留，DB canonical User对应；邮箱字段disabled却空白，DB两表邮箱非空 | 邮箱展示 FAIL，根因未定位；未修改email／删除账号 |
| Billing 账目与赠额 | PASS | UI可见赠额、聊天、图片费用；DB采样账本对应；最终两个自有账号无hold | 仅本轮记录；充值／套餐／Stripe／账单全矩阵未执行 |
| Billing跨标签页余额同步 | FAIL | UI侧栏18.4而正文14.8；正文与DB一致，截图30 | 全局显示未及时刷新，不是账本丢钱 |
| CAP-01 Library Animate超单次上限拒绝 | PASS | UI设cap1后点Animate11明确拒绝；DB该窗口0新GenJob／0新账目／0余额或hold变化 | 仅此入口样本；非全部Otto／批量／并发／损坏配置覆盖 |
| Spend cap无效值与恢复 | PASS | UI -1／0.5禁保存；0显示Remove cap并风险确认；**后补DB已确认spendCapCredits=0、余额11、reserved=0** | 恢复不再待回执；最初查找Save失败是测试选择器问题，不报产品缺陷 |
| 键盘／无障碍 | PARTIAL | 表单required；后补Connections Escape关闭且回焦样本通过 | 完整Tab／Escape／Enter／IME／focus／屏幕阅读器／reduced motion矩阵NOT RUN |
| Working任务取消 | NOT RUN | 研究任务执行时UI未见Stop，输入／发送禁用，结束恢复 | 未执行取消及退款语义验证；不把无Stop观察等同取消功能测试失败 |
| 删除／恢复／外部破坏性动作 | NOT RUN | 本轮明确不删既有素材、不Delete account、不清理；Crop只取消 | 自有测试数据的删除恢复矩阵须另有清楚范围；生产／他人数据不在权限内 |
| 双租户安全 | PARTIAL | UI新账号打开Founder Canvas不泄露原资产；DB确认回退到自己新Canvas | 静默创建/回退并非清楚拒绝；未执行双向读取／写入／关联／权限攻击矩阵，不是penetration pass |
| Mobile／跨浏览器／完整desktop尺寸 | BLOCKED | UI曾1000×994工具限制，后Chrome1920×958与1920×902；后Debugger unattached | 没有完整mobile／1440×900与1920×1080／跨浏览器矩阵；1000px desktop引导不算desktop缺陷 |
| 自动测试／required CI | BLOCKED | CHECK：候选纯测试未运行，workspace deps指向旧checkout dist且lock不同 | message-reference-refs实际写DB已排除；无测试绿色／required CI结论；需同commit隔离依赖与独立测试DB |

## 剩余发布关卡

1. **核心创作闭环**：修复并重新实际验证官方actor＋product视频400、typed reference到生成材料丢失、retry引用丢失、Product来源断裂；成功变体交付仍缺证据。
2. **付款前事实与状态一致**：修复更新数量时旧报价可确认窗口；统一能力解释与实际3:4支持；明确新上传理解收费披露；终态、Conversation、节点无需手动刷新才同步。
3. **批准设计与范围对齐**：Library详情顺序／折叠／主要复用动作、actor浏览与handoff；先解决Library与Creation spec对直接编辑的冲突。actor具体fixture仍有最终视觉批准边界，不能代理Founder签字。
4. **可复现工程证明**：部署commit对应的依赖与隔离测试环境；相关行为／钱路／tenant测试及required CI；补完整下载、取消、其他入口／并发消费上限、注册重试、Google回调、双租户读写权限与恢复矩阵。CAP-01单入口已通过且cap恢复已查证，不重报为全未验；当前仍没有绿色全suite证据。
5. **最终体验验收**：恢复浏览器控制后补准确桌面尺寸、键盘与辅助技术、跨浏览器／mobile边界、刷新／Back／deep-link；Founder接受实际正式流程。staging成功不自动授予production部署。
6. **费用证据边界**：加入只研究3.8 credits后，backend最新累计商家收费38.2 credits／USD3.82等值；CAP-01无新费用，生成成本快照仍USD0.5553821875。OttoTurnTrace补齐工具调用计数但不含供应商token／USD，聊天实际成本仍未完整恢复，理解为另一类动作。不能据商家扣费宣称供应商USD20硬上限被全面证明。退款并不等于供应商失败账单为零。

同一份来源内较早的检查清单保留历史措辞；本矩阵已用明确后续证据更新对应行，未推断未执行步骤。三段费用说明依run-ledger所记Founder最新裁决为accepted design difference，不作为本矩阵缺陷。
