# Creation 引擎 规格书（S1）

> 状态: 已冻结 · v2
> 批准: https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1101 Founder 评论「S1 批准 creation-engine.md」(2026-08-29 v1;2026-08-30 v2 改签重签)
> 规格前缀: CREATE（验收编号 = CREATE-A1、A2…）

## 0. 一句话

商家说人话、丢几张素材，就能拿到可直接提交投放流程的图片与短视频广告——提示词手艺由引擎代劳，花钱前看得见、改得了。（成片观感不入 S5 验收，由评测基线另场标定。）

## 1. 九问（S1 grill 的答案，2026-08-29 Founder 逐项拍板）

1. **商家做什么动作、看到什么结果？**
   五个直接变化：
   ① 商家在生成提交面输入人话，花钱前先看到引擎替他写好的专业提示词（**可改可直接用**，Founder 拍板「花钱前可见可改」）。
   ② 丢素材说人话，引擎**自动指派参考角色**（这张当产品参考、那段学镜头、这条配节奏——始终落在官方合法组合内），商家不学任何引用语法（拍板「全角色自动指派」）。指派结果以增强稿里的指派句呈现——商家改文字即改指派；点选式结构化改指派本版不做（见「不做」）。
   ③ 视频有**声音开关**（落点＝视频规格选择器；默认开）。**开关不影响我们的报价**（售价只看档位与时长，可实证），界面文案照此说，不让商家误以为关掉能省钱；供应商侧声音是否另计费列入 §7 实测轮核查。
   ④ 需要 1080p 高清时引擎自动升档，**报价照实前置显示**——商家只见能力与价格，不见型号名。新档位在钱引擎线定价落地前**不可售**（fail closed，见九问 5）。
   ⑤ **AI 形象出镜（演员库）**：平台自建虚拟代言人演员库——每个角色＝一张 Seedream **纯文生**多视角角色表（beta 首发 50 名，Arcads 演员库形态的虚构版），商家挑角色连续出片，同一角色跨场景同脸（2026-08-30 三场景实证），零认证零摩擦。上传真实人脸照片＝诚实拦截＋人话出路（提示口径 English sentence case：「Real human faces aren't supported yet」＋引导选演员库角色；Founder 2026-08-30 拍板）。真人出镜后续唯一正门＝字节 ACR 实名素材库（Entry 档已开通，见「不做」节触发条件）。
   片型**全部铺开**（Founder 拍板），不设片型白名单。片型表以手艺文件为**单一来源**；初始底稿＝社区指南场景节**全收**（中文版 12 节：角色一致、镜头复刻、特效模板复刻、视频延长、视频编辑、卡点音乐、对白配音、一镜到底、电商产品展示、科普教育、AI 短剧/漫改、视频融合/续写）——此处仅为快照，以手艺文件为准。

2. **入口在哪里？（列全，含深链）**
   不新增入口。生成提交面现有：画布 composer（直接生成）、画布卡片 animate、资产详情面板的三个付费动作（Regenerate／Animate／Generate edit）、Otto 对话（卡片确认）。本轮增强稿口径逐面写死：**画布 composer 与 Generate edit 必落**（两处都是商家自写提示词的直接花钱面）；两处 animate 本轮均不增强——事实口径按 2026-08-31 严口径重查纠正：资产详情 Animate 为模板化动作、无自由提示词；画布卡片 Animate 的 **Custom 选项存在一条自由文本运镜输入、原样进付费生成**（`FlowCanvas.tsx` Animate 弹窗），该通道要不要纳入增强稿与 A12 覆盖＝中途想法，登记变更登记待 S5 裁；**Regenerate 本轮改为重发该资产上次的 `sentPromptText`**（与商家批准的一致——否则增强出的片按一次 Regenerate 就变回生话直出）；Otto 路径随已冻结 otto-engine.md（ENGINE-A3）施工后在确认卡片上同源生效——「花钱前可见可改」是能力级口径，两种施工先后都成立，不与 ENGINE 冲突。参考音频的商家入口＝画布 composer 素材区（与图片/视频参考同一入口）。

3. **四态：空、加载、错误、成功各长什么样？**
   生成四态沿用现有画布卡片状态代数（`canvas-card-status`，不明即 unknown 绝不永转）。新增**增强预览**一态：输入 → 增强中 → 可改预览＋报价 → 提交。**增强失败不挡生成**：回退商家原文，预览处诚实标注「未增强」，照常可生成（错误不外溢到钱路）。

4. **数据从哪来、写到哪去？**
   - **手艺文件（单一来源）**：`seedance.md` 与 `seedream.md` 两份内容由本规格负责；**目录形状与路径以已冻结 otto-engine.md 的文件柜（S2 落地版）为准，路径随 ENGINE 走**，本规格不另定路径。内容四源合成，冲突时**以官方口径为最高准绳**：① 官方提示词指南（URL 见九问 7）；② 社区版 Seedance 2.0 指南（逐条证实/证伪裁定表随手艺文件交付）；③ arkcli 实查的参数契约；④ 现有 `seedance-prompt.ts`/`seedream-prompt.ts` 手艺代码沉淀（分镜≤4、情绪外化、声音记号、禁词清单）。官方口径的承重校正（手艺文件必须遵守）：**2.0 不认时间戳，只认 Shot 编号分镜**；**单镜头只写一种运镜**；素材指代＝「类型名＋序号」（官方示例 `@Image1` 等效可用）；官方建议素材 4–5 件效果最佳、不建议顶格；提示词 ≤500 中文字／1000 英文词。官方自家的 Seedance 2.0 提示词改写技能（sd2-pe，官方 TOS 桶分发）施工时取来对照。引擎增强与 Otto 对话**同源取用**这两份文件，不抄第二份；取用机制施工稿（S2）定。**CREATE 施工写入 craft/ 文件时，须重跑 ENGINE-A1 评测基线且不低于基线**——两份规格共用一套评测骨架（`packages/otto/evals/`），不另起炉灶。
   - **模型槽位注册（能力路由，两槽）**：视频＝mini（默认）／2.0（1080p 高清档）；图片＝5.0-lite（默认；组图）／5.0-pro（透明底、人物精修路由；标准图与大图两个 SKU，图层分离本版不卖）。**各槽位能力差异以逐槽 `supported_params` 实查回执为准（S2 开工首件事出回执）**；参考音频是 2.0 全系官方能力（走默认档 mini），不作升档理由。商家永远只见能力，不见型号（蓝图「供应商是内部实现」）。
   - **围栏现状与改造（设计不变量）**：视频侧今天有 fail-closed 毛利地板围栏（`FLAT_PRICED_VIDEO_MODELS`＋`assertSpendableModel`）；**图片侧今天没有等价围栏**；且现有闸每种类型只放行唯一在售型号，与能力路由结构不兼容。本规格施工范围包含把这道闸改造为：**「路由结果必须落在已定价、已过毛利地板的槽位白名单内；白名单外＝拒绝生成、$0，不是降级」**，并在图片侧建同形闸。fail-closed 语义一格不放宽。**「已定价」的机械判据**：该 SKU（槽位×分辨率/图种×时长档）在显式价目表里有自己的条目才算已定价；**兜底护栏格（如 `VIDEO_CREDITS_BY_RESOLUTION` 的 1080p=16cr）与图片侧对型号无感的「1 credit/张」一律不算已定价**——新槽位进白名单之前，这两处必须先改成对新 SKU 返回「无价」，属本规格施工范围。毛利表与 CI 闸（`margin-truth.ts`／`check-margin-floor.mjs`）里的图片 SKU 今天是手写死的两行、新增槽位不会自动进名单——pro 上架前须改成与 `sellableVideoSkus()` 同形的按 SKU 枚举，同属本规格施工范围（价格数字仍归钱引擎线）。另注：配置错误的**默认档**沿用今天机制（降级回白名单＋留日志）；商家请求的**路由结果**一律拒绝、不降级。
   - **输入上限按官方契约执行**（2026-08-29 arkcli 实查＋官方 API 参考）：Seedance 2.0 系全模态场景最多 **9 张参考图、3 个参考视频、3 段参考音频**；参考视频/音频**总时长 ≤15 秒**；**音频不可单独输入**；**首尾帧与全模态参考官方互斥**（不能混用）。图片侧**输入＋输出合计 ≤15 张**（官方），参考图上限＝15 − 本次出图张数。引擎在花钱前按此校验，超限诚实拒绝、$0——**此段为目标态**（2026-08-31 严口径重查澄清）：现网主生成路径对元素参考是「取到上限截断＋卡面披露实用张数＋照常收费」，图片侧上限为定值 10（`MAX_CONDITIONING_IMAGES`）；refgen 侧已实现 min(10, 15−出图数)。S2 施工须把主路径改为公式化上限＋花钱前拒绝 $0，处理与既有卡面披露机制的替换，并补图片侧上限的验收行。
   - **血统信任（原「信任回灌通道」，2026-08-29/30 实测改判）**：Seedance 视频端只信任 **Seedream 纯文生产物**作含人像参考（跳过输入审核；4 投 4 中实证）；Seedream 图生图产物、外部模型产物（GPT 等）、真人照片一律创建阶段免费拒收「may contain real person」（13 次实测全档；分销商侧一手佐证＝过滤在模型层、不可配置）。「30 天」时效口径未实证、不再承重——引擎实现为「演员库角色图一律 Seedream 文生产出、产物直引，不落任何外部改写路径」。行业同款机制佐证＝Artlist 帮助文档「Trust ecosystem」节（文生自动信任；图生图在账号实名后信任——该升级在我方直连是否成立＝待验，见变更登记）。
   - **provenance 沿用并扩一格**：`promptText`（商家原文）／`sentPromptText`（实发引擎的字符串，＝商家批准的增强稿逐字）／`finalPromptText`（供应商侧改写记录）三列语义不变；新增**路由理由**落盘，商家可见口径＝能力名词（「你要了 1080p，所以走高清档」）；**引擎不得为商家不可见的理由路由到更贵槽位**——那等于替商家花钱却给不出理由。参考角色指派结果随生成落盘（沿用 entitySnapshot＋sentPrompt 编号行机制）。
   - **配额口径**（2026-08-31 严口径重查回填纠正）：concurrent_requests=10、create_task_rpm=600 是**整个账户的共享总量**，不是各模型各自可加总——仓内 2026-08-08 已实测并落码（`apps/worker/src/plan.ts` 明注「这是整个账户的额度」；gen 与 refgen 共用同一闸门实例，实际可用并发＝10−2＝8）。原「是否另有账户级总闸未查，S2 前补一次」**取消**——答案早已在仓内。

5. **碰不碰钱路（credits / 计费）？碰则幂等键是什么？**
   碰。人话版：老三样（预扣→交付→结算，失败退款）一格不动；本规格新增的只有「没定价的档不许卖」这道闸，和增强这笔平台自付的小成本。
   - **沿用 reserve→settle→refund 单一通道与既有幂等键（`refId`=GenJob.id、`canvas:`/`cowork:`/`asset:`/`batch:` 四族请求键），不新增键。** 成立前提（S2 必须守住）：增强稿不得做成按次计费或带独立付费副作用的东西。
   - **新档位定价不在本规格**：Founder 2026-08-29 裁定——毛利与定价的事**归钱引擎线统一处理**，creation 引擎只管 creation。本规格只立规矩：①未定价槽位不可售（fail closed，见九问 4 围栏不变量）；②任何新档定价必须过仓库法毛利地板。1080p 档与 pro 图两 SKU 的 credit 数字由钱引擎线算出后回填变更登记、Founder 追认。
   - **增强成本**：平台吸收，不入商家账、不动现有单价（Founder 拍板）。上界与口径：单次增强成本设计上界 **$0.01**（按注入上限换算的封顶值，施工时以实测校准）；每个生成动作增强调用 **≤6 次**（1 次自动＋手动重写至多 5 次）；成本计量为**独立指标**（照 `founder_absorbed` 计量先例），不悄悄摊进档位 COGS；是否计入毛利口径由钱引擎线统一裁，登记变更登记。
   - 供应商实价（2026-08-29 arkcli 实查，USD 牌价）：视频按 K tokens——mini NV2V **$0.0035**／2.0 **$0.007**（1080p $0.0077）；图片按张——lite **$0.035**／pro **$0.045**（大图 $0.09、图层 $0.0225 计价单位未实证）。**「账户 25% 折扣」经实查不存在**（推翻 2026-08-08 档案）；mini 60% off 与 fast 25% off 两档公开促销均 **2026-09-07 到期**。定价与毛利不受影响（一直按牌价算，`spend.ts` 现行做法，列为不变量）；但给 Founder 的白话——**9 月 7 日之后我们付给供应商的视频账单约涨到今天的 2.5 倍**。账户并发与限速见九问 4 配额口径。
   - 已知钱路暗礁随规格记录：图片模型供应商侧 `watermark` 默认 true（我们已显式关）。2.5 相关未验证项不入本规格。

6. **权限与租户边界是什么？**
   人话版：谁能花钱、花谁的钱、要不要审批，一律不变；增强层只碰提示词文字，碰不到钱、身份和审批。
   不变量清单：身份只来自 `requireOwner()`；手艺文件不携带、不接触身份；信任 WeakMap（服务端铸键）、幂等键形状-出处双校验、fail-closed 模型开关（`ModelRegistryOverlay`）全部沿用。

7. **参考对照：抄哪家？（Mobbin 截图或链接，稿上注明）**
   - 官方提示词口径（2026-08-29 网页实查，最高准绳）：Seedance 2.0 系 prompt guide https://docs.byteplus.com/en/docs/ModelArk/2222480 ＋ tutorial https://docs.byteplus.com/en/docs/ModelArk/2291680 ＋ 视频 API 参考 https://docs.byteplus.com/en/docs/ModelArk/1520757 ＋ https://docs.byteplus.com/en/docs/ModelArk/2607689（该页是 2.5 指南，但本规格三处承重取用——九问 4 的「2.0 不认时间戳」「单镜头单运镜」与 A8 的「官方镜头术语表」——的官方原文出自此页的 2.0 对照节，取用范围随手艺文件逐条留档）；Seedream prompt guide https://docs.byteplus.com/en/docs/ModelArk/1829186（官方将 5.0 也指向此页）＋ 图片 API https://docs.byteplus.com/en/docs/ModelArk/1541523 ＋ 5.0-pro tutorial https://docs.byteplus.com/en/docs/ModelArk/2582774。
   - 社区版 Seedance 2.0 指南 https://github.com/dexhunter/seedance2-skill（即梦 App 形态；对 API 的逐条证实/证伪裁定表随手艺文件交付）。
   - 增强稿「先出稿再让你改」形态：Canva Magic Write（凭印象，未取证）。
   - 画布对话形态：Grok Imagine（已在 otto-engine.md，不重复）。

8. **胃口：轻／中／重挡，为什么？**
   重挡：碰钱路（围栏改造）＋ 新模型槽位与新输入类型（音频参考，落在现有素材区、不新增入口）＋ 生成提交面行为变化（增强预览）。

9. **Otto 怎么协助这个功能？或明写「不适用」。**
   同源协助：Otto 的 `seedance-prompt`/`seedream-prompt` 动作与引擎增强取用同一份手艺文件（正名与改造随 otto-engine.md 施工，不在本规格重复）。Otto 路径上「增强稿可见可改」的落点与时序同九问 2：ENGINE-A3 施工后在确认卡片上生效。

## 2. 验收表（S5 只认这张表；一行一个可当场演示的判定）

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| CREATE-A1 | 商家在画布 composer 或资产详情 Generate edit 输入人话、按生成 | 花钱前先见增强稿预览，可编辑可直接用；同一条人话走增强预览提交与直接提交，前置报价数字相同（otto-engine.md 的画布对话验收落地后，画布路径的判定落在 Otto 确认卡片上） |
| CREATE-A2 | 商家丢产品图＋一段参考视频，说「照这个感觉拍我的产品」 | 引擎自动指派角色（图＝产品参考、视频＝镜头参考），指派句在增强稿中可见、改文字即改指派；无需任何引用语法。商家改出的指派若越出该素材的合法角色枚举、或撞上官方互斥组合（首尾帧×全模态参考），花钱前诚实拒绝并说明原因、ledger 零新增行 |
| CREATE-A3 | 商家在视频规格选择器关掉声音开关后生成 | 交付视频无 AI 配音配乐（`generate_audio=false` 实发可查）；界面明示声音开关不影响报价 |
| CREATE-A4 | （工程演示）为 1080p 档配置一条过毛利地板的测试价后，商家要求 1080p | 路由到高清档；前置报价数字＝ledger 中 `reserve:<refId>` 绝对值＝`settle:<refId>` 绝对值；全程界面与消费历史不出现型号名；该次路由理由（能力名词）可查。测试价仅存于演示配置，演示后撤回并重跑 A5 同形判定（1080p 回到拒绝、$0）；生产价目以钱引擎线回填、Founder 追认的数字为准 |
| CREATE-A5 | （工程演示）把默认视频模型环境变量指向未定价/未过地板槽位；另直接请求一个未定价槽位的能力 | 前者被降级回白名单并留日志；后者拒绝生成、ledger 零新增行（不是降级） |
| CREATE-A6 | （工程演示）图片侧同形：请求未定价的 pro SKU | 拒绝生成、$0——图片围栏与视频同形生效；演示同时出示该 SKU 在显式价目表无条目（对型号无感的兜底价不算已定价） |
| CREATE-A7 | 增强服务不可用时商家照常提交 | 用商家原文生成，预览处诚实标注未增强；生成与计费不受影响 |
| CREATE-A8 | （工程演示）跑增强评测：≥10 个人话任务，覆盖手艺文件片型表逐项各≥1 题 | 输出全部通过机械检查：角色指派完整、分镜为 Shot 编号结构（零时间戳）、禁词零命中、镜头词全部命中手艺文件 seedance.md 的镜头术语表（该表来源逐条注明）；检查项与判分落 `packages/otto/evals/`；且改动 craft/ 文件后重跑 otto-engine.md 的评测基线（其验收表第一行），总分不低于基线 |
| CREATE-A9 | 商家上传含真人脸（或任何非平台血统的写实人像）的参考图生成 | 创建阶段拦截＋人话提示（「Real human faces aren't supported yet」口径）＋出路指向演员库角色；余额净变化为 0（ledger 上 `reserve:`/`refund:` 成对、无 SETTLE），绝不静默失败 |
| CREATE-A10 | 商家选演员库角色（平台 Seedream 文生角色表）在不少于两个不同场景连续出片 | 正常生成，不触发人脸拦截（血统信任，2026-08-30 三场景 3/3 实证）；跨场景同脸由 Founder 验收样片判定；生成记录可查到所引角色（引用落盘） |
| CREATE-A11 | 商家丢一段音频说「照这个节奏剪」；另丢 4 段音频（或总长超 15 秒） | 前者自动指派为节奏参考、报价前置；后者花钱前诚实拒绝、给出人话原因、ledger 零新增行 |
| CREATE-A12 | （工程演示）任取一次走增强路径的生成（含对该资产按一次 Regenerate），查记录 | `sentPromptText` 与商家批准的增强稿逐字一致（Regenerate 重发同一串）；路由理由字段有值可读 |

## 3. 不做（非目标；写明为什么和触发条件，防「遗漏」误会）

- **不接 Seedance 2.5**：牌价 $10.70/M＝mini 三倍，破毛利地板（2026-08-08 已裁，`gen.ts:40-44`）；且 2.5 换了提示词底座（sd25 模板），2.0 手艺不能直迁。触发条件：价格降到地板之上，或评测证明 2.0 家族卡住质量上限。
- **不接 Seedance 1.5-pro**：上一代模型，参考角色与手艺规则与 2.0 家族不对齐，接它＝维护第二套手艺（顺带记录事实：1.x 侧尚有约 195 万 tokens 免费额度与批量计费项）。触发条件：2.0 家族被证实卡住某类片型时，再评估其免费额度价值。
- **不接 2.0-fast 槽位**（Founder 2026-08-29 拍板改两槽）：「参考音频独有」被官方口径证伪（全 2.0 系都收），独有升档理由不存在；按现行 720p 档价格出片毛利 44.7%（按牌价推算）破 45% 地板。触发条件：评测证明 mini 质感卡住，且钱引擎线为它单独定价过地板。
- **不做 seed 复现（「一模一样再来一张」）**：2026-08-29 实查，官方目录已将 seed 标为 Seedance 2.x 全系 `support: false`。触发条件：官方目录重新声明支持后实测再议。
- **不做视频多条同出**：今天强制 1 条；多条＝花费翻倍＋报价 UI 另案。触发条件：商家真实需求出现。
- **不卖图层分离（pro 独有能力）**：官方计价单位语义未实证（预扣 17 IPM 模式）。触发条件：商家需求出现＋单位实测＋钱引擎线定价。
- **不做点选式结构化改指派**：本版指派随增强稿文字可改；触发条件：商家真实反馈要求点选改。
- **真人出镜广告——beta 不做，正门已定**：v1 的「身份层前置」（商家照片→图像模型出 AI 肖像→进 Seedance）已被 2026-08-29/30 实测**证伪**——Seedream 图生图血统与外部模型（GPT）血统的写实人像，视频端一律拒收（连纯文字生成的外部产物、带 AI generated 标记版也拒；13 拒零过；证据 preserved/creation-probe-2026-08-29/）。分销商换道亦**证伪**（2026-08-30 七家调查＋判官复核：过滤在模型层、分销商不可配置，且无一家便宜过直连；结案表见变更登记）。beta 口径＝Founder 2026-08-30 裁决：真人照片诚实拦截（A9）。真人出镜后续唯一正门＝ACR 实名素材库（见下条）；Kling／MiniMax 海螺／Google Veo 二引擎降为 ACR 被拒后的备选（Q17 裁决沿用）；「Seedance/Seedream 独家且保密」原则因不换供应商而无需修订。
- **ACR 真人素材库——beta 不做，门已开着**：Entry 免费档已由 Founder 2026-08-30 在控制台开通（4 份条款已签；`liveness_writable:true` 实查回执在案），全账号 50 个真人名额、逐人扫码活体＋平台代劳同意机制；付费档 $14,000/年起。v1「对多商家 SaaS 走不通」修订为：beta 期 50 名额够用、正门保留暂不接。触发条件：商家真人出镜需求出现＋Founder 点名——先跑 Founder 本人活体实测（顺带 $0 验「实名后 Seedream 图生图是否获信任」彩蛋）。注：虚拟形象上传写权限实查仍关（`aigc_writable:false`），演员库以角色表参考图交付，不依赖素材库。
- **新档位定价不在本规格**：Founder 2026-08-29 裁定归钱引擎线统一处理；定价落地前新槽位不可售（fail closed）。触发条件：钱引擎线开场。
- **不动画布输入框→Otto 对话**：那是 ENGINE-A3 的验收，本规格不重复、不抢跑。触发条件：ENGINE 施工。
- **不做 MCP 化、外部 agent 接入**：沿用既有 deferred 与 otto-engine.md 裁决。

## 4. 异议栏（AI 必填）

- 最大风险：**增强层是 LLM 改写，可能歪曲商家意图**——商家批准的增强稿与他心里想的片子有偏差时，钱已花出。对策三条全部入验收：预览可改（A1）＋增强质量机械检查（A8）＋批准稿与实发串逐字一致、路由理由可查（A12）。另记一实：能力路由替商家挑档＝替商家花钱，对策＝报价前置（A4）＋路由白名单 fail closed（A5/A6）＋路由理由只认商家可见的能力名词（九问 4）。

## 5. 变更登记（两类条目：① 冻结后的中途想法——不当场执行，下次 S5 批量裁决；② 已批事实与他线裁决的回填（如钱引擎线定价）——Founder 追认即生效，裁决列填追认日期）

| 日期 | 想法 | 裁决（留空待 S5） |
|---|---|---|
| 2026-08-30 | 实测轮结案回填（实验 1/2/5）：①真人脸直传＝创建阶段免费拦截（与预期一致）；②「30 天信任回灌」机制被证伪，改判**血统信任**（Seedream 纯文生 4/4 过门；图生图与外部血统 13/13 拒，含分胜负实验与跨厂商对照）；③Seedream 图片端不拦真人脸＝证实，但其图生图产物进视频被拒→「身份层前置」证伪。证据：preserved/creation-probe-2026-08-29/（team1/2/3 回执＋sheet-test-20260830/RESULT.md） | 随 v2 重签追认（2026-08-30） |
| 2026-08-30 | Founder 裁决：beta＝自建演员库（50 名 Seedream 文生虚拟代言人，Arcads 形态）＋真人照片诚实拦截；真人出镜后续走 ACR 正门 | 2026-08-30 |
| 2026-08-30 | 分销商调查结案（Higgsfield/Artlist/fal/Freepik/Krea/Replicate/聚合商）：无一家解锁真人参考（一手引文＝「blocked at the model level…not configurable」），无一家低于直连 $1.89/条（5s·1080p 实价 $1.97–$3.58；Artlist 无视频 API 且条款禁 automation/resale；Higgsfield 服务端 API 无 2.0）——维持直连 | 随 v2 重签追认（2026-08-30） |
| 2026-08-30 | 待验彩蛋登记：账号实名/活体完成后，Seedream 图生图产物是否获视频端信任（Artlist 文档口径「Image-to-Image after account identity verification (KYC)」；我方直连未验）——Founder 活体日顺带 $0 实测 | 登记待验 |
| 2026-08-30 | Founder 裁决：beta 演员库规模由「首发 50 名」改为**创始 5 名即全量**（A1–A5 五人组已定妆：Aisyah/Weijie/Arjun/Rahman/Xinyi，组图法产出特写＋全身对、五脸两两互认 QC 过；无损原件＋人物卡归档 preserved/actor-library-v1-2026-08-30/）。扩产与否 beta 后再裁；九问1⑤「beta 首发 50 名」按本条口径读 | 2026-08-30 |
| 2026-08-30 | **像素完整性铁律**（九问4「产物直引」的工程收紧，Founder 当日追问确认）：血统信任的标记在**像素**里，演员图必须**端到端保留 Seedream 原始产物字节**。实证两笔：①原字节重新上传（base64 直传）过门出片（task `cgt-20260830161827-p28pq` succeeded）；②对已过门文生图做**裁剪**后提交＝拒收「may contain real person」（request id `021788096448297c…`，任务未创建 $0）。工程规则：提交视频端一律用无损原件；显示用缩略图/裁剪图只能另存副本、永不回流生成路径；缩放/滤镜/加字/转格式/再压缩等一切像素级再处理**未实测＝未验先禁**。证据 preserved/creation-probe-2026-08-29/pixel-integrity-20260830/ | 2026-08-30 |
| 2026-08-30 | Founder 两想法＋当场实证三笔：①「参考图不加钱」**证实**——成片账单 `prompt_tokens: 0`，输入侧（提示词＋参考图）零计费，只按输出视频计费（单参考与多参考同价 245,025 tokens/5s·1080p）；组图上限实证 `max_images` 1–15/次（API 校验回执）。②职业/类型 preset 判定＝**prompt 层换装成立**：素装定妆对＋一句厨师服 prompt → 同脸换装出片（task `cgt-20260830213513-zb8zt`，样片 preserved/actor-library-v1-2026-08-30/wardrobe-test-chef.mp4）。落地形状＝人物卡加 wardrobe preset 块（厨师/门店/诊所/健身/办公等，S2 定清单），零新图零重铸；职业造型**展示**图走显示层（可 i2i，按像素完整性铁律永不回流生成路径）。③character sheet **免重设计**判定：视频端角色图 1–2 张＝官方配方上限（多则同脸漂移），免费参考图真正解锁的是同请求免费加挂商品/场景图（官方甜点 4–5 件总素材）；多图请求需逐图 `role`（`reference_image`，实证）。 | 2026-08-30 |
| 2026-08-30 | Founder 拍板:演员库**两轴模型+九套造型 preset+新增演员铸造法**——后续每次加 avatar 一律遵循本行。**两轴模型**:演员(定妆对+人物卡)× 造型 preset(prompt 层 wardrobe 块)正交组合,任何演员可穿任何 preset;preset 定的是「意图」,细节按人物卡适配(如 Aisyah 一律 hijab 友好 modest 版、厨师装=围裙版不动头巾)。**九套 preset(Founder 2026-08-30「就先这九套」)**:①素装(默认定妆原样)②Street wear(UGC/年轻向)③厨师后厨白制服(已实测过片)④门店服务(polo/围裙前场,咖啡/零售/便利店)⑤商务(blazer/smart casual,房产/金融/B2B)⑥医护(白袍/刷手服,诊所/牙科/药房)⑦美容沙龙(黑制服围裙)⑧健身(运动装)⑨节庆传统装(Raya baju kurung/melayu、CNY 旗袍、Deepavali kurta)。每套上架前 mini 480p 各验一条同脸(约 $0.05/套,帽饰头饰类重点盯同脸稳定性),验过才挂给商家。**新增演员铸造法**:①人物卡先行(ID/FACE/HAIR/身高/BUILD/WARDROBE+防撞脸独有特征各不相同),与库内全部现役演员**两两互认** QC 过才收编;②seedream-5-0 组图(sequential auto,max_images=2)一次调用出「特写+全身」同身份对(官方配方 ModelArk/2222480:竖幅正面、特写无表情脸占 2/3、全身正面;2.0 禁多视角拼表);③素装统一制服+#8a8a8a 棚灰背景+photorealism 拉满;④`.bin` 无损原件=生成层唯一资产(像素完整性铁律见上,端到端直传永不再处理),`.jpg` 仅展示;⑤preset 适配块写进人物卡,Otto 与 UI 同源取用(一卡三用)。 | 2026-08-30 |
| 2026-08-31 | 严口径重查落账（Founder 裁决「严口径，重查 Creation」；125 条主张逐条对码＋Opus 复核＋Codex 跨厂判官）：①九问2 animate 口径为事实错误，已按改签记录机械纠错；②九问4 配额口径纠正（账户级总量）；③九问4 输入上限段标注为目标态；④中途想法：**画布 Animate Custom 通道要不要纳入增强稿＋A12 覆盖** | ①②③ Founder 2026-08-31 拍板「机械纠错，本轮不增强」；④留空待 S5 |
| 2026-09-01 | 钱引擎线定价回填(类型②,money-engine.md 九问4 已冻数字+S2 施工稿 7.2 落地):**1080p 视频=11cr/秒**(5 秒=55cr,毛利 65.7%)、**pro 图=2cr/张**(毛利 77.5%)——公式=成本×1/(1−0.65) 向上取整到收费格;上架仍随本规格施工(围栏改完才可售),数字待 Founder 追认 | |
| 2026-09-02 | **Founder 现场令**：「今天直接做完一个部分——像在 beta 那样用 Creation 的所有东西，要真实的、完全可用的版本、真的 product」。本稿据此把 12 条切三批（§8）；**「一 session 一阶段」本场例外**：S2 呈批与批 I 施工同日进行，范围只限本场（Founder 现场裁决，写回于此） | 2026-09-02（随 S2 批准生效） |
| 2026-09-02 | §7 实验 4 结案（零成本只读，`arkcli models get … --transform supported_params`）：mini 与 2.0 的 `supported_params` **唯一差异是 resolution 枚举**（mini=[480p,720p]，2.0=[480p,720p,1080p,4k]），其余 20 个参数逐字相同；价目表 ChargeItems 无任何音频计价项＝`generate_audio` 在价目层面不另计费；图片 lite `optimize_prompt_options.mode` support:false、pro 有 `optimize_prompt`(boolean, default true)。与规格预期一致，回填。原始 JSON 归档 preserved/creation-probe-2026-09-02/ | 回填（随 S2 批准追认） |
| 2026-09-02 | §7 实验 3 **问题形状被实查改变**：在产图片型号 seedream-5-0（lite）没有可关的优化开关；只有 pro 有 `optimize_prompt`（默认 true）；我方请求体从不发该字段＝一直跑服务端默认。承重口径「`sentPromptText`＝商家批准稿逐字」**未被推翻**（它管我们发出的串；供应商改写记录在 `finalPromptText`）。剩余 A/B（pro 开/关各一张，$0.16–0.48，§7 已批额度内）在批 I 执行，结果决定 pro 请求体默认值 | 待批 I 回执 |
| 2026-09-02 | 演员库归属模型（§8.0 拍板建议）：**每租户播种**——org 引导时把 5 名创始演员各建一份 CHARACTER 实体＋2 张参考图，字节经 `storage.put` 原样落各 owner；`Entity` 新增可空列 `catalogKey` 标记官方角色；**不引入跨租户共享实体**，租户边界零变化 | 随 S2 批准生效 |
| 2026-09-02 | **Founder 裁决（分两阶段验收）**：§8 批 I（今晚：现有生成全链在新前端、1080p/pro 上架与报价前置、未定价拒绝、声音开关、演员库五人可经 `@` 引用、真人脸口径）作为**阶段一**单独出 S5 证据表由 Founder 勾选（只勾批 I 覆盖的验收行：A3/A4/A5/A6/A9/A10 后端半/A12 路由理由半）；批 II＋批 III 合为**阶段二**＝完整 Creation，另出 S5。Founder 原话：「这个当一个阶段，我验收；完整的 creation 当第二阶段」；并令「全速前进，不浪费 attention 与资源，做好 checkpoint 就报告然后继续」 | 2026-09-02 |
| 2026-09-02 | **§7 实验 3 第二轮结案**（Founder 清欠费后重跑，pro 图开/关各一张，估算 ≈$0.19，T+1 账单待核）：①API 响应不暴露任何改写字段（`prompt` 与发出串逐字相同，无 revised_prompt 类字段）→「sentPromptText＝批准稿逐字」不受影响，供应商侧改写无从记录进 `finalPromptText`；②质量：`optimize_prompt=false` 那张凭空出现提示词未要求的乱码标签，`true` 那张构图更贴主体，且同一 size 下画幅不同（true 竖版/false 正方）。**拍板四落定**：按 §8.0 规则「增益明显→保留默认」，pro 请求体**不显式关闭**优化（保留供应商默认 true）；证据强度＝单样本、未固定种子，标注弱证据。触发再验：固定种子多组配对（预算另计）。证据 preserved/creation-probe-2026-09-02/experiment-3/RESULT.md | 2026-09-02（依 §8.0 已批规则落定） |
| 2026-09-02 | **Founder 裁决（阶段一收尾与阶段二衔接）**：阶段一全部 PR 合入并本机起动后，**先由 agent 跑一轮真实端到端验证**（真供应商出图出片、真扣费、真账本、演员引用、真人脸拦截、高清档报价、声音开关），证据表齐了再交 Founder 验收；Founder 验收期间本机服务（localhost）保持开着所需页面；**若无 blocker，agent 不等验收结果直接开阶段二**（§8.2 批 II）。Founder 原话：「在这个阶段完毕的时候，先帮我走一轮真实的 e2e，验证所有东西。然后等我的审核的时候（with local host 开着我需要的页面）你就继续 phase 2（如果没有 blocker）」 | 2026-09-02 |
| 2026-09-02 | CREATE-A3 阶段一只在资产详情 Animate 路径提供声音开关（PR #1133，判官裁定不展示死开关）；画布两条视频路的开关在阶段二（批 II）接线；阶段一验收 A3 按此口径勾。触发＝Codex 第二轮复审指出。证据：`apps/web/components/asset/DetailPanel.tsx` 传 `audioToggle`、`apps/web/components/canvas/FlowCanvas.tsx` 不传；围栏与行为测试 `apps/web/lib/__tests__/video-audio-toggle.test.ts`、`apps/web/lib/__tests__/canvas-video-spec-ui.test.ts`、`packages/generation/src/byteplus-audio.test.ts`；#1133 合并于 main `add6999e`（落修 commit `c3d36d7b`） | 待 Founder 追认 |
| 2026-09-03 | 上传素材 Regenerate：因 regen 路不携带源图（`handleRegen` 无 `sourceGenerationId`），兜底句会让商家花钱得到无关结果，暂维持拒绝；待 i2i 请求形状接上后再开放。触发＝PR #1145 修复者指出。证据：`apps/web/components/asset/DetailPanel.tsx` 的 `handleRegen` 请求体无 `sourceGenerationId`；兜底表 `ASSET_ACTION_FALLBACK_PROMPTS`（`packages/core/src/gen.ts`）只留 `animate`；行为测试 `apps/web/lib/__tests__/animate-uploaded-source.test.ts`「上传的图按 Regenerate ⇒ 原地拒收、$0、连 GenJob 都不建」 | **2026-09-03 Founder 裁决**：维持拒收，但**先把拒绝提示改成人话**——如 "Uploads can't be regenerated yet. Try Animate or Edit instead."（今天商家撞到的是 schema 层的整单拒绝，不是一句读得懂的话）；**图生图（i2i）归 Creation 增强层，排进 §8.2 批 II**，请求形状接上后再开放 Regenerate。**落地（人话拒绝句）**：PR #1148 → main `93b72293`。同条已登记 frontend-baseline.md §5（2026-09-03「裁决八」） |
| 2026-09-03 | **staging 真商家走查 S2／S3（浏览器直传）**：①商家看到的是上传库自己的原话「Unknown error」（`OttoChatStream` 的附件报错框 + 两处 `err.message` 直出）——不是我们写的话,也没给出路;②直传的字节走「浏览器 → 存储桶」,服务器不在路上,失败时 web 日志一行都没有,我们零感知。触发＝2026-09-03 staging 走查（桶的 CORS 把直传挡在门外） | **2026-09-03 Founder 令「全速修」**：诚实文案 + 服务端留痕,无钱路变化。落地：失败分两类各一句、单一来源 `UPLOAD_FAILURE_COPY`（`packages/core/src/upload.ts`,上限引用 `UPLOAD_MAX_BYTES`,底层原文只进日志）;直传失败一律回报服务端 `reportDirectUploadFailure`（org 取自 `requireOwner()`,报告体只有枚举与数字,不带文件内容与凭据),服务端打一行可 grep 的 `[upload] DIRECT-UPLOAD-FAILED`。行为测试 `apps/web/lib/__tests__/upload-failure-honest-copy.test.ts`、`apps/web/lib/__tests__/upload-failure-report-log.test.ts` |
| 2026-09-03 | **staging 走查 S4（演员库/素材库删除不真删资产）**：商家删掉一个演员（Entity）只软删 Entity 那一行，底下的 `ReferenceImage` 与存储桶里的字节一直没人删——「商家的 data 商家的权利」不成立，一张真人照片删了之后字节还留在桶里。触发＝2026-09-03 staging 走查（Founder 本人一张真人定妆照）。数据删除类改动，回滚说明：Asset/ReferenceImage 的软删可逆（`deletedAt` 置回 null），**存储对象的物理删除不可逆**——`packages/storage` 的 `deleteObject` 落在两个驱动上都是硬删，没有回收站 | **2026-09-03 Founder 裁「现在就修」**：`softDeleteEntity` / `softDeleteReferenceImage`（人工 UI 与 Otto 共用同一层，`apps/web/lib/actions.ts`）级联把该实体/该参考图**独占**的 Asset 标记 `deletedAt` 并调用 `storage.deleteObject` 真删对象；判据（`apps/web/lib/asset-purge.ts`）＝独占当且仅当没有任何活的 `ReferenceImage`（不分实体/变体）也没有任何 `Generation`（不分 `deletedAt`——生成历史「不可变，永不物理删」）还指着它，共享引用只解引用、不动对象；租户约束沿用既有 `ownerId` 闸。存量清理脚本 `scripts/tools/purge-deleted-entity-assets.ts`（默认 dry-run 只打印计数，`--apply` 才真删，幂等可重跑）补齐修复之前已软删实体漏下的资产。行为测试：`apps/web/lib/__tests__/entity-delete-purges-asset.test.ts`（独占真删／共享只解引用／Generation 永不可删／双租户隔离）、`apps/web/lib/__tests__/purge-deleted-entity-assets-script.test.ts`（脚本 dry-run／--apply／幂等）。**已知未接的口子**：`deleteVariant`（`apps/web/lib/refgen-actions.ts:545`）删变体时只软删该变体的 `ReferenceImage`，从未调用 `purgeOrphanedReferenceAssets`/`purgeAssetStorage`——变体产出的资产不建 `Generation` 行，按同一判据本可真删，但字节至今没人删；本票未接，判官第二轮复审 P1-B 指出、留给另一票单独带测试做（那条事务已经握着 EntityVariant 行的写锁做在飞作业闸，本票不建议顺手接进去，混进另一个更敏感的锁语义）；同时登记 issue #359 |
| 2026-09-04 | **staging 顺滑度走查 P0-2／P0-5（下载与画布加载失败）**：①商家按素材详情的「Download」或画布选中工具条的「Download N」，浏览器不是存文件而是**导航去 R2 的裸地址**（`…r2.cloudflarestorage.com/….mp4`）——人出了应用、片子也没存下；根因＝`/files/…` 在 r2 模式下 302 跨源，`download` 属性跨源被浏览器忽略。②`/create` 与 `/create/canvas` 只有 Suspense 骨架、没有自己的 error boundary，服务器一次 502 之后骨架**永远转下去**，商家既看不到出错也没有重试或回头的路。触发＝2026-09-04 staging 顺滑度走查（Founder「12 小时内 Creation 完全可用」令）。本行属类型①中途想法，验收编号沿用现有 CREATE-A 表（下载与页面加载失败不在其中任何一行，不发明新编号；测试标题逐字带「登记 2026-09-04 P0-2／P0-5」） | **落地（本 PR）**：①下载改**同源附件流**——`/files/<key>?download=1&name=<人话文件名>` 由服务端校验租户（key 命名空间比对＋资产须属当前 org 且未软删）后流式转发字节并加 `Content-Disposition: attachment`，R2 地址不再交给浏览器；改写规则单一来源 `apps/web/lib/download-url.ts`，文件名沿用 `canvas-selection.ts` 的 `canvasDownloadFileName`（详情与画布同名）。②新增 `apps/web/app/create/canvas/error.tsx` 与 `apps/web/app/create/error.tsx`：人话文案＋「Try again」（`reset()`）＋回 Create／Otto 的路，原始报错不印给商家但照旧上报 Sentry。行为测试：`apps/web/app/files/__tests__/route-download.test.ts`（真库：本租户 200＋attachment／他租户 404／软删 404）、`apps/web/lib/__tests__/asset-download-same-origin.test.ts`、`apps/web/lib/__tests__/canvas-download-same-origin.test.ts`、`apps/web/lib/__tests__/create-error-boundary.test.ts` |
| 2026-09-04 | **staging 走查 P1（参考附件类型标注）**：Otto 从素材库附上一张商家产品图（Pandan kaya jar photo）时被标成「(person)」/「Character」；同账号此前正因这种误标触发过真人脸硬拒绝（"Real human faces aren't supported yet."）——商家的产品图被当成真人拦下，直接冲击「Otto 协助生成」主线。触发＝staging 走查报告（scratchpad/creation-friction-audit.html，P1-6）。根因非默认写死在 Otto 侧或供应商侧：`Add to Library` 上传表单（`AddAssetDialog.tsx`）的 Type 下拉曾**默认预选** `REFERENCE_FORMATS[0]`（"Avatar / Cast" → `CHARACTER`），商家未碰下拉即可提交 Add，任何素材（含产品图）静默存成 `CHARACTER`。该标签不是装饰——它原样写进送给引擎的提示词（`packages/core/src/reference-budget.ts` 的 `SLOT_NOUN.CHARACTER = "person"`，构成 "Define the person in <Image_N>"），正是这句话让引擎的真人脸检测在一张果酱罐照片上误判。**真人脸硬拒绝本身是供应商实判**（`apps/worker/src/jobs/gen.ts` 的 adapter `permanent` 标志，引擎自己检视图像后拒绝）——这条路径诚实，未改动 | 已修（PR #1164）：表单不再有默认类型；Add 按钮在商家明确选一个类型之前保持禁用（新纯函数 `apps/web/lib/add-asset-form.ts` 的 `canSubmitNewLibraryAsset` + `NO_TYPE_SELECTED`），与 `createEntity` 服务端动作本就有的 `ENTITY_TYPES.has(type)` 校验同一条口径，只是提前到 UI 层不许静默提交猜测值；`submit()` 增加同款防御性校验，Select 加占位提示「Choose a type…」。行为测试：`apps/web/lib/__tests__/add-asset-form.test.ts`（产品图无类型不可提交／显式 `PRODUCT` 可提交／显式 `CHARACTER`——商家或演员库明确标记人物时——仍可提交／名字与文件仍是必需／表单锁定时禁用）；既有 `add-asset-dialog-feedback-ui.test.ts`、`library-guardrails-934.test.ts` 同步补上「先选类型」步骤，两份原有断言保持绿。范围内不改：`propose.helpers.ts` 的 `approvedEntities` 快照（已如实读 DB `Entity.type`）、`SLOT_NOUN` 的措辞映射（对明确类型如实翻译，不是缺陷）、供应商真人脸判定本身 | 待 Founder 追认 |

## 6. 改签记录

- 2026-08-31 机械纠错：九问2 animate 口径——原文「两处 animate 是模板化动作、无自由提示词」与现网不符（画布卡片 Animate 的 Custom 选项是自由文本付费通道，资产详情 Animate 才是模板化；同族复核链与 Codex 跨厂判官双 CONFIRM）。纠正为如实描述，**冻结范围不变**（两处本轮均不增强）；Founder 2026-08-31 收签场 AskUserQuestion 逐字拍板「机械纠错，本轮不增强（推荐）」。同批回填九问4 两处事实纠正（配额账户级总量、输入上限段标目标态），语义零方向变化；签名 #1101 沿用。
- 2026-08-29 冻结落地时机械修订：验收表 A1/A8 两处跨规格编号引用改为不落表格行的写法（M2 前缀唯一闸把表内 `ENGINE-A*` 字样误认作本规格前缀声明），语义零变化；签名 #1101 沿用。
- 2026-08-30 改签 v2：九问1⑤（演员库口径）、九问4「信任回灌→血统信任」、A9/A10 重写、「不做」节真人出镜与 ACR 两条改判、§7 实验 1/2/5 结案——「30 天信任回灌」与「身份层前置」双双被实测证伪；beta＝演员库＋诚实拦截（Founder 2026-08-30 裁决）。签名＝#1101 Founder 重新评论「S1 批准 creation-engine.md」（2026-08-30）。

## 7. 冻结后、施工前的实测轮（Founder 2026-08-29 已批，预算 ≤$20）

三个实验＋一份回执，结果处置规则：**与规格预期一致＝回填变更登记；推翻九问任一承重口径＝走改签记录**（不预判）。——**2026-08-30 状态：实验 1、2、5 已结案**（结果见变更登记与改签记录；实测轮累计花费 ≈$9.4/$20），实验 3、4 仍开放、为 S2 开工前置。

1. 【已结案 2026-08-30：拦截，如预期】**直传真人脸参考**：预期仍被创建阶段免费拦截（官方口径如此）；若竟通过＝官方文档滞后，即刻报 Founder。用谁的脸另行报备、经 Founder 点头后再跑。顺带在控制台核读 ACR 实际档位（只读）。
2. 【已结案 2026-08-30：机制改判＝血统信任，走改签】**信任回灌链路**：文生 AI 人物 → 30 天内回灌出片，预期通过（对应 A10）。加一组对照：**非本平台产物的 AI 写实人脸**是否同样可过——区分「信任通道放行」与「AI 脸本身可过检测」两种机制（行业侧证：Higgsfield 规模化走「真人照片→自研身份模型→AI 肖像→Seedance」，暗示后者成立，未实证）。
3. **`optimize_prompt_options` 是否改写我们的提示词**：图片侧 A/B 两张便宜验证。**若会改写，动的是「`sentPromptText`＝商家批准稿逐字」这条承重口径，按改签处理。**
4. **逐槽 `supported_params` 实查回执**：mini 与 2.0 的能力差异表（零成本只读查询），S2 开工的第一份输入；含 `generate_audio` 打开时供应商侧是否另计费的口径核查。
5. 【已结案 2026-08-30：图片端不拦＝证实；但其图生图产物进视频被拒，身份层前置证伪】**Seedream 图片端收不收真人脸**（身份层前置的门题）：商家真人照片走 Seedream i2i，拦或不拦？——我们的人脸拒收实测（2026-08-08）只发生在**视频**提交端，图片端历史上从未返回过该错误、但也从未实测。若图片端不拦：身份层可全用现役 Seedream 做（真人照→AI 肖像→存为形象→进 Seedance），**零新供应商**；若也拦：身份层需外部图像模型或 ACR 素材库承担「照片→肖像」一步。真人照片用谁的、如何报备，照实验 1 同一规矩。

已结案的取证（不再验）：参考图＋首尾帧混用＝官方明文互斥，免实测；mini「API coming soon」雷已排除（`enabled:false`＋8 月 17 次真实成功调用）。

## 8. S2 施工稿（设计阶段产出；S1 正文 §0–§7 一字未动，§5 只追加登记行）

> S2 状态: 已批准
> S2 批准: https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1131 Founder 评论「S2 批准 creation-engine.md」(2026-09-02)；该评论同时追认 §5 2026-09-01 定价回填行（1080p 视频 11cr/秒、pro 图 2cr/张）与本节 §8.0 四项拍板建议

### 8.0 范围、量尺与本场拍板（Founder 2026-09-02）

- **目标**：Founder 现场令「今天做完 Creation，像真产品一样完全可用」。本稿的诚实量尺：12 条验收按依赖切三批——**批 I 今天**（后端、围栏、资产；不碰 PR #1117 重写的商家面文件）、**批 II 新前端纯合并落主干后**（商家面：增强预览、指派句、音频素材、角色选择器）、**批 III 随 Otto 引擎**（A8 评测基线、A1 画布路径的 Otto 卡片）。今天结束时 Founder 能真实用到：现有生成全链＋1080p 高清档与 pro 图上架（报价前置、型号不外露）＋声音开关＋演员库五人可在 `@` 引用出片＋真人脸口径。批 II 估 2–3 天，批 III 随 Otto S2。
- **拍板一（追认）**：1080p＝11cr/秒、pro 图＝2cr/张（§5 2026-09-01 行）随 S2 批准追认；上架随批 I。
- **拍板二（演员库归属）**：每租户播种（§5 2026-09-02 行）。备选「跨租户共享/官方实体」触碰租户边界＝schema 与隔离语义变更，不做。
- **拍板三（手艺文件路径占位）**：`packages/otto/craft/seedance.md`、`seedream.md`；otto-engine.md S2 若另定路径，本稿随之改路径，不算改签。
- **拍板四（pro 图优化开关默认值）**：由批 I 的实验 3 A/B 决定：若开启优化会改写提示词且质量无明显增益，请求体显式 `optimize_prompt=false`（保「实发＝批准稿」的最短链）；若增益明显，保留默认并把改写记进 `finalPromptText`。
- **机器闸**：每段 PR 带 `Spec: docs/specs/creation-engine.md`；验收编号逐字入测试（M3）；两条迁移守形状（M5）；新开关无 `BETA_*`。

### 8.1 批 I（今天；写集见 8.4）

① **能力路由＋SKU 白名单（A4/A5/A6）**：`packages/core/src/gen.ts` 视频菜单加第二槽位 `seedance-2-0`（能力：480p/720p/1080p；4k 不卖）、图片菜单加 `seedream-pro`；`packages/generation/src/byteplus.ts` 型号映射加 `dreamina-seedance-2-0` 与 `dola-seedream-5-0-pro`；`model-config.ts` 的 `assertSpendableModel` 判据从「等于唯一在产型号」改为「SKU 级已定价白名单」（消费钱引擎已落地的 `sellableVideoSkus()/sellableImageSkus()`），白名单外＝拒绝、$0、不降级；默认档配错仍降级留日志（现行）。新增路由器：视频按分辨率（1080p→2.0，其余→mini），图片按能力（透明底/人物精修→pro）；`Generation` 新增可空列 `routeReason`（迁移），商家可见口径只写能力名词。`spend.ts` 图片分支按型号取价（lite 1cr / pro 2cr）；`seedanceDisplayCredits` 认 2.0 档。测试：CREATE-A4、A5、A6 逐字。
② **声音开关（A3）**：`VideoSpecPicker` 的 `VideoSpec` 加 `audio`，开关文案「Sound doesn't change the price」；`DetailPanel.tsx:402` 一行改为传商家选择（该文件是 #1117 冲突文件，只改这一行，合并方保留）。测试：CREATE-A3 断言实发 `generate_audio=false` 且报价不变。
③ **演员库入库（A10 后端）＋真人脸口径（A9）**：迁移加 `Entity.catalogKey String?`；脚本 `scripts/ops/seed-actor-library.ts` 读 `preserved/actor-library-v1-2026-08-30/` 的 `.bin` 与 `card.json`，走 `storage.put(原字节,'jpg')`→`assetUpsert`→`Entity(CHARACTER, catalogKey)`＋2 张 `ReferenceImage`(closeup/fullbody)；org 引导（`requireOwner` bootstrap）对新租户播种；九套造型 preset 写入 `Entity.descriptionJson.presets`（一卡三用）。**像素完整性防回归测试**：断言送供应商的参考图字节 sha256＝入库字节 sha256，生成路径零再处理。A9：`gen-failure.ts` 口径改「Real human faces aren't supported yet」＋出路句指向演员库（按钮 UI 归批 II）。测试：CREATE-A9、A10（后端半：演员实体经 `@` 引用出片、引用落盘）。
④ **实验 3 A/B**（pro 开/关各一张，$0.16–0.48，§7 额度内）＋回执归档 `preserved/creation-probe-2026-09-02/`；结论回填 §5，决定拍板四。
⑤ **A12 前半**：`routeReason` 落盘随①；Regenerate 改发 `sentPromptText`（`DetailPanel.tsx:337`）归批 II。
⑥ **复审**：每段 Codex 跨厂复审；全量 apps/web 测试＋typecheck＋production build＋e2e。

### 8.2 批 II（新前端纯合并落主干后）

- **增强层（A1/A7/A12）**：新建 `packages/core/src/enhance.ts`（读手艺文件、单次上界 $0.01、每动作 ≤6 次、`founder_absorbed` 计量、失败回退原文＋「Not enhanced」标注）；画布 composer 与 Generate edit 新增「输入→增强中→可改预览＋报价→提交」一态；增强稿即付费请求携带的 `sentPromptText`；Regenerate 重发上次 `sentPromptText`。
- **自动指派＋拒绝闸（A2）**：素材→合法角色枚举指派器；指派句入增强稿；越界指派与首尾帧×全模态互斥＝花钱前拒绝、$0（替换现行「截断＋披露＋照收」）；输入上限公式化（九问 4 目标态）。
- **参考音频（A11）**：composer 素材区收音频；适配器发 audio 部件；三条上限（≤3 段、视频＋音频总长 ≤15 秒、音频不可单独）花钱前拒绝。
- **演员库商家面（A10 UI、A9 出路）**：Library Elements 与 `@` 显示官方角色（`catalogKey` 标记）；真人脸拦截卡的出路按钮。

### 8.3 批 III（随 Otto 引擎 S2）

- **A8**：依赖 ENGINE-A1 评测基线与 `packages/otto/evals/` 骨架（今天不存在）；Creation 评测集 ≥10 题与四项机械检查建在同一骨架上。
- **A1 画布路径**：ENGINE-A3 落地后判定在 Otto 确认卡片上生效。

### 8.4 写集互斥表

| 施工线 | 写集 |
|---|---|
| Creation 批 I | `packages/core/src/{gen,model-config,spend,margin-truth,gen-failure}.ts`、`packages/generation/src/byteplus.ts`、`apps/worker/src/jobs/gen.ts`、`packages/db/prisma`（两条迁移）、`scripts/ops/seed-actor-library.ts`、`apps/web/lib/auth-guard.ts`（播种钩子）、`apps/web/components/gen/VideoSpecPicker.tsx`、`apps/web/components/asset/DetailPanel.tsx` 第 402 行一行 |
| 前端基线纯合并 | 9 个冲突文件＋`apps/web/design-system/`＋`apps/web/components/ui` symlink（frontend-baseline.md §7） |
| 交集 | `DetailPanel.tsx`：批 I 只改一行，合并方保留该行 |

### 8.5 环境前置（Founder 钥匙）

- 本地真出片：worker 需 `GENERATION_PROVIDER=byteplus`＋`BYTEPLUS_API_KEY`（主检出 `.env.local` 已有部分变量；缺则 mock 出纯色假图）。
- 实验 3 与实查：`arkcli` SSO 已到期，需 Founder 重新登录。
