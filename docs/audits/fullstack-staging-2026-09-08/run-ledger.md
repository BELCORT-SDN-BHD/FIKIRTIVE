# 本轮执行记录（持续更新，非最终报告）

预算：Founder USD20，本轮共享 storage 上传／生成豁免见 preflight.md。禁止清理既有素材、充值、购买套餐或修改实现。

基线：staging web/worker 0e1f2ab3。首次观察余额 9,999,927.4 displayed credits；这个余额不是授权预算。

## CRE-01 产品图 → 官方人物 + 产品视频

- Canvas：canvas_adbb6b80-b83c-4502-965e-be4dfe92b9c8。
- Thread：thread_adbb6b80-b83c-4502-965e-be4dfe92b9c8。
- Handoff：handoff_adbb6b80-b83c-4502-965e-be4dfe92b9c8。
- 首句话：虚构马来西亚咖啡店，需要 coral-orange insulated travel mug、plain cream lid、no logo/text、warm background、4:5。一张产品图优先，之后希望官方 avatar 使用同一杯子做视频。明确要求先报价。
- 已观察：Create 显示 Starting Canvas，跳转唯一 Canvas；Otto 询问替代 4:5 的比例。选择 3:4 后呈现 1 credit 确认卡（1728×2304）。单击批准，队列中刷新，恢复同一 Canvas，最终图完成。截图 03–06。
- 真实回执：job `01M1ZQ2Z3K3M8W8YAC0TTN4F1R`，IMAGE，DONE，1 张；2026-09-08 05:15:39.015–05:16:06.670 UTC；generation `01M1ZQ3T2SW24FDX4P41XRYJ1C`。后台只读核查：一个 reserve、一个 settle、无剩余 hold，billedUnits=1，应用成本快照 spentUsd=0.035（并非最终供应商账单）。
- 费用：两条聊天 2.2 + 0.8 displayed credits，加图 1，共 4 displayed credits。余额 9,999,923.4。客户收费等值 USD0.40 不等于已证明所有供应商成本 USD0.40；聊天成本未取得完整回执。保守顺序执行，不把余额当预算。
- 复用：生成图自动出现在 Library；通过 Choose from Library 附加同一张产品图成功。
- 阻塞：`@ → Official avatars` 与 Library → Elements → Official avatars 均为空（截图 06、07）。后台证明 scoped ownerId=founder 无 Entity；其他 tenant 的素材不借用。不是把其他人像替换进来就算官方 avatar 流程通过。

## CRE-02 产品图 → 无人物短视频（独立测试）

- 在同一 Canvas，附加实际生成图，请求 5 秒 portrait 产品视频，gentle camera push-in，原杯子/盖子不变，no people/logo/captions，先确认价格。
- 已批准 11 displayed credits；真供应商任务完成，用生成产品图作为 starting frame，5.04 秒视频在桌面实际播放成功。job `01M1ZQDMXJ0K7H9BXJ41F2ZE39`，耗时约 100.44 秒，单次 reserve/settle，详见 backend-evidence.md。截图 08–11、14。

## 后续执行（2026-09-08，持续更新）

- 完整桌面已补验：Chrome 1920×958，后为 1920×902；此前 1000px 是工具限制，不混为桌面缺陷。
- CRE-03：用 @ 选中真实生成图，中文请求规划、Malay headline/CTA，不生成、不搜索；返回排版建议，未新增生成任务。聊天约 67.5 秒总时长，非首字延迟；收费 2 credits。
- CRE-04：通过正常文件选择器重新上传本轮产品图成功；复用原 Asset，未产生 Understanding 任务。不能用这个去证明全新外部图片理解成功。
- CRE-05：拖动节点、Fit to screen、添加中英/Malay文字便签成功。编辑背景为 sage green，保留杯子；新图成功，原图保留。Otto 声称只能 1:1，但确认卡和最终图均为 3:4，作为能力说明矛盾记录。
- CRE-06：Create variations 确认卡快速双击：只产生一个 job `01M1ZRF0D1JWSCZGHN8EX6YCNJ`、一次预扣；供应商返回 0/1 usable images，生成失败且全额退款一次，reserved=0。资金幂等通过此单一样本；生成失败。截图 19。
- 失败节点出现时 current turn 仍显示上一轮 Done / Made 1 image，Conversation 17；手动刷新后显示 Failed / Edit and retry，Conversation 19。实时反馈不同步。刷新后便签和生成结果仍在。
- Edit and retry 恢复完整展开后的文字，但没有引用 chip；源码也只恢复 text，不恢复参考图（backend-evidence.md）。没有继续提交，以免把丢失引用的重试误当正确恢复。
- Library：搜索、Oldest first、Favorite、建立测试 collection、打开 collection 均成功；空白 collection 名称禁止创建。Download 仅点击，尚未证明完整下载。Crop 打开/取消，footer 低对比截图 13。资产详情与批准设计明显不一致，来源见后续报告。
- Brand：创建测试 Audience、预览、Save context 后 Ready，后台 Memory/revision 对应；H1 随 Audiences 切换。只触及新建测试内容。
- Settings：General 空改动禁用保存；Connections 空态与 Add connection 弹窗可访问，未连接第三方。Billing 与后台余额/hold 对应，未充值。Home 空数据诚实显示，Customize 可打开取消。
- 注册：在独立 IAB 退出已有会话，不影响 Chrome。空白注册表单原生 required 校验；`tools+e2e20260908@belcort.com` / E2E Cafe 2026-09-08 已到确认邮箱。邮件在 13:44 MYT 送达（不宣称精确投递 SLA）。未验证前 ba_user 存在但无 canonical User/组织/额度，符合预期；正在验证确认链接后结果。
- 预算更新：商家净消费 24.2 displayed credits（约 USD2.42 收费等值）；生成供应商成本快照合计 USD0.4853821875，含失败 attempt USD0.035。聊天实际供应商成本尚未完整核对，这两个数不应混用。授权总上限仍 USD20。
- 测试工具：05:45 UTC 左右 Chrome 控制报 Debugger unattached；原生桌面截屏也空白。已尝试重连与独立 IAB，后者可读邮件。属于测试基础设施限制，非产品缺陷。

## 环境与证据限制

- 当前工具真实视口为 1000×994；请求 viewport 1440×900 没有生效。此处截图不可冒称完整桌面验收；1000px Home 显示 desktop 引导不算 desktop defect。完整桌面视觉另验。
- 三段费用说明按 Founder 最新裁决记 accepted design difference，不报缺陷。

## 普通新商家：注册、官方演员和产品双引用

- 邮箱确认链接成功完成注册，落到 Home，获得 25 starter credits。后台：独立组织 `org_cmts923pm00002mptbuoube0j`，一次 GRANT 250 internal，五位官方演员各有两张参考图。截图 20 显示 Aisyah 只读详情；详情缺乏 Use in Canvas 等批准的能力，详见 design-parity-evidence.md。
- 以该账号打开 Founder 本轮 Canvas 深链，没有看到 Founder 资产；系统静默创建/回退到自己的空 Canvas，而不是给权限错误。只证明此单一路径没有可见泄露，不代表完整 tenant penetration test。
- 新商家自己生成产品图：job `01M1ZS883B063F2ADC822925KQ`，generation `01M1ZS96Z1K7QD7JPMSB5F3E9J`，05:53:29.209–05:54:00.855 UTC；1 credit，真实生成成功。
- 数量 1→2→1：最终确认卡金额正确更新；更新过程中选择值已变而旧价格按钮仍可点击。没有在混合状态支付，不能声称实际错扣。代码支持父子 pending 状态不同步，详见 backend-evidence.md。
- 使用 @ 菜单选择 Aisyah 和新产品图，数据库 ChatMessage 正确保留两个 typed references。但第一张合成确认卡只有 Aisyah，没有产品 Generation ID。Otto 文案却称用了两者。截图 22、23。
- Change→Tell Otto what to change→Send to Otto 没有写入消息；源码该按钮只转交文本、不真正发送。随后用主输入框发送修正，Otto 又把旧 GEN_CARD 消息 ID 当成商品 ID，重建卡仍缺产品引用。
- 使用 Choose from Library 显式附加产品原图后才恢复：新卡同时包含 product sourceGenerationId + Aisyah entity ID，截图 24。又出现“image edit 只能 square”的错误解释，与 3:4 卡及产物矛盾。
- 合成首帧成功：job `01M1ZSRWZBJ5Q6RV95WV6ZZSYB`，output `01M1ZST5CQHVX7XZ0KKJ3159EM`，实际为 Aisyah 持橙色杯子，截图 25。卡自动接到 5s / 3:4 / 720p / 11 credits 视频确认。
- 批准该视频后失败：job `01M1ZSVK3CMWZ4754BY4J647MP`；错误为 `Real human faces aren't supported yet. Pick a cast member from your Library instead. You weren't charged.`。本次明确用了官方演员，因此建议形成能力/身份传递排查项，而非让用户重复选同一演员。截图 26。11 credits 全额退款，无 hold。没有反复收费重试。
- 原产品图在合成后未出现在当时可见 Canvas application 的节点清单，只有合成图；数据库原产物和节点仍在。必须区分客户端显示缺口与数据丢失，不能写成后台删除。
- 普通资料：Display name 保存 `E2E Café tester 中文`，刷新保留；Email 输入框 disabled 且 value 为空，但数据库邮箱非空。没有操作 Delete account。
- Billing：新账号赠额、聊天、图收费分别可见。Spend cap 打开后 -1 和 0.5 禁止保存；没有改变上限、充值或进入 Stripe。
- `/brand/records` 手动新增产品 `E2E Coral travel mug` / RM 49 / e2e,cafe 并从 Library 关联原图成功；该产品未出现在 Library Products，Canvas `@E2E` 为 No references found。源头查询 BrandRecord 与 Entity 不一致，详见 backend-evidence.md。
- 最新余额：新商家 14.9，Founder 9,999,903.2；两者净收费 34.3 displayed credits，约 USD3.43 收费等值。生成供应商成本快照合计 USD0.5553821875；聊天供应商真实成本仍未恢复，不等同最终账单。

当前不是全量通过。仍需：Chrome 恢复后的完整桌面复验、完整文件下载证据、全新外部文件理解、跨浏览器/键盘辅助技术、真实双租户写操作安全矩阵、消费上限执行、取消任务、Google 回调修复复验等。付款/删除/生产及其他用户数据仍不在自动执行范围。

## 补验：上传理解、历史与账单（截至 06:20 UTC）

- 上段“仍需”是当时快照，下述项目已有进展；不将后续结果回填成更早已通过。
- 原产品节点在刷新后恢复，截图 27；证实客户端实时显示缺口，而非数据删除。
- 全局 Otto 历史可打开、pin、rename；空白名称禁止保存，`E2E Product + avatar journey` 在数据库已持久化。Thread 名与 Canvas 名是否应同步另行核对，不能把不同领域的名称直接报成 bug。
- 新上传本轮 PNG 截图（不是已有生成图片的相同字节），正常文件选择器上传成功，Library Uploads 可见。Generation `01M1ZTC1RMZY4S82P69X39AQSK`、Asset `01M1ZTC1RF2ZJ603HXAN02WQGJ`；后台储存为 JPEG 1000×994。自动理解 `01M1ZTDQ133ZYN713PWQ208CG0` DONE，扣 0.1 displayed credit 一次，无未释放预扣。详见后台证据。
- 上传详情显示 `Cost: no credits charged`，但 Billing 正确列出 Understanding -0.1；应区分“上传/生成费为零”与“该素材总费用为零”。截图 29。不能把账单遗漏于素材详情写成重复收费。
- 新账号余额 14.8，Founder 前述净消费 24.2；合计净消费 34.4 displayed credits，约 USD3.44 商家收费等值，不是供应商发票总额。
- 当前 IAB 实际视口 1280×720。Home 独立 marketing 空态正常，Create something new 进入独立 Create 页面，历史显示自己的 Canvas。1000px 的桌面引导不作为缺陷。
- 同一 Billing 页面侧栏 18.4 credits，正文 14.8 credits，截图 30：跨标签页发生消费后，全局余额未及时刷新；正文及后台一致，非账本丢钱。
- Library Download 已观察到浏览器 download 事件；未取得完整下载文件验证格式/字节，结论仍是启动成功、完整下载验证未完成。
- Library Generated 来源筛选、Today、Canvas 筛选及 Clear filters 均按测试样本变化；无匹配显示空态、清除恢复两张图。未公开分享或移入 Trash。
- Connections 弹窗 Escape 关闭成功，焦点回到 Add connection；没有授权外部账号。此样本通过不代表全部键盘/读屏合规。
- 截图 31 名称带 desktop 但实际画布标签页仍为 1000×994；只能作为窄视口 Conversation 证据，不作 1920px 设计对照。不同标签页视口不同，截图 29/30 为 1280×720。

## CRE-07：只研究、不生成

- 在普通新商家当前 Canvas 请求 current official Instagram portrait photo sizes，最多两条官方链接，明确不生成/编辑。
- Otto 返回两条 Help Center 链接，并诚实说明无法读取官方文章；但接着将旧知识称为当前官方限制、说 4:5 是最高且 3:4 会被裁切。测试方访问同一 Help Center 也遇 429，故不能把外部最新规格当成已独立证实的事实。
- 可直接验证的错误：称 3:4 比 4:5 更宽，实际 0.75 < 0.8；还承诺下次直接生成 4:5，与同轮之前的能力限制提示矛盾。
- 工具进度显示 Researching your brand / Otto is making it，而任务不是研究品牌也不是生成；执行中输入框、发送禁用，未见 Stop 控件。结果完成后输入恢复，UI 标示此回复 3.8 credits，后台金额和无额外生成待独立回执。
- 最新预计合计净收费约 USD3.82 商家收费等值（此前 3.44 + 本轮 0.38），仍不是供应商成本总账。

## CAP-01：超额动作必须不入队、不扣款

- 普通新测试组织通过 Billing 正常 UI 设置单次上限为 1 credit，后台确认 settings.spendCapCredits=1。
- Library 选择原始无人物商品图，点击 Animate · 11 credits。系统返回明确 cap 拒绝：需要 11，上限 1，去 Billing 修改；截图 32（1280×720）。没有再次点击重试。
- 后台确认此窗口 0 新 GenJob、0 新账本行、delta=0，余额 11 credits、reserved=0。此入口/样本通过，不代表全部 Otto/批量/并发入口都已覆盖。
- 恢复时输入 0，按钮正确从 Save 变成 Remove cap；弹出风险确认，完成确认恢复。后台最终确认 spendCapCredits=0，余额 11、reserved=0。
- 后续 Brand 分区检查：Knowledge base、Style guide 标题与分区匹配；Knowledge base 有 Open the record editor 链接到 /brand/records，因此不应声称产品编辑入口完全不可达。Style guide 纯空白名称/内容禁止 Review draft，Cancel 正常。
