# 生成 API 供应商调研：时机 + fal vs 直连（2026-06-11）

4 路并行 web 调研（fal 现状 / 厂商直连门槛 / 聚合器横评+创作者实况 / 参考图生成选型），各路完整报告见附录。本节为综合裁决。

## 裁决

### 时机：不是现在，是「阶段二开建时」，且图像先于视频

1. **当前序列不变**：T4b 直传 → 创始人真实项目（升级门）。生成 API 不阻塞任何当前工作。
2. **第一个接的是图像 API，不是视频**——阶段二旗舰=引导式参考图生成（第一个收费点）。工作马 Seedream 5.0 Lite（fal $0.035/张，10 参考图）+ Qwen Multiple-Angles LoRA（确定性 96 相机位姿转角）+ Nano Banana Pro 高级档（$0.15）。一次完整引导流程（master+4 角度+重试）成本 $0.25-0.35，毛利空间充足。
3. **视频 API 紧随其后，复用同一 fal 适配层**（同一账单/queue/webhook，零新增账务）。
4. **战略发现（本次调研最大收获）**：2026 年所有头部视频模型都标配 multi-reference，但 schema 完全不互通——Kling 元素库（每元素 4 图多角度）、Seedance 2.0（9图+3视频+3音频）、Veo 3.1 Ingredients、Vidu Q3（4图+2视频）、Wan（150 参考帧）。「@实体 → 自动拆装到目标模型的 reference 槽位（数量裁剪/角度筛选/格式转换）」正是 Fikirtive 楔子的接口价值；快手自己做 Element Library = 厂商验证了"持久化实体库"方向，但没人做跨模型的那一个。**这应该直接写进产品叙事。**

### 选型：fal 主渠道 + 适配层做薄留退路

- **fal 是默认正解**：Kling/Veo 在 fal 上与官方零差价（fal 赚厂商分成）；Seedance 约 2 倍溢价，但字节官方渠道对海外个人/小公司门槛高，fal 反而是最低摩擦的官方授权渠道。day-0 上新 track record 扎实（Kling 3.0/Hailuo 2.3/Grok 1.5 都是 day-0；Seedance 2.0 全球 API 首发就在 fal）。queue+webhook+5xx 不计费+幂等回调，和我们 pg-boss 架构天然对齐。无企业认证，信用卡即用。
- **省钱路线（量起来后）**：Seedance 用量大了申请 BytePlus ModelArk 直连压价（个人可开，180RPM/3 并发，Johor 端点离新加坡极近，约为 fal 一半价）；Veo/Kling 留在 fal（同价没必要动）。
- **双供应商是行业标准**：provider port 从 day 1 可插拔（fal 主、Replicate 备）。Sora 2 全线关停（2026-09-24 API 终止）和 Seedance 被版权风暴一夜阉割证明：单一模型会死，单一渠道也会死。
- **不碰灰色渠道**（kie.ai/PiAPI 式低价 = ToS 风险转嫁，Midjourney API 停服是先例）。毛利建立在 fal 牌价+打包 credits 之上（Higgsfield $75/月模式）。

### 工程备忘（接入时要做的）

1. 任务层 fallback：fal 无 SLA（月度有小时级故障窗口）→ 审核失败/服务故障自动换同类模型重试，比单模型重试更有价值（各厂审核敏感度不一）。
2. 商用条款透传到 UI：fal 按模型打 Commercial/Research badge；Seedance 现在过滤名人/IP/版权音频，广告创作者必须在生成入口看到限制。
3. MiniMax 产物 URL 9 小时过期 → 我们的 R2 转存流程天然解决（生成产物一律立即转存，本来就是设计）。
4. Google 系输出带 SynthID 隐形水印（不可关）→ 告知用户即可，投放无实际影响。
5. fal ToS 未显式 assign 输出 IP → 开放注册前让律师过一遍我们的用户条款措辞。

### 价格速查（2026-06，fal）

- 图像：Seedream 5L $0.035/张 · NB2 $0.08 · NB Pro $0.15 · FLUX.2 pro $0.03/MP · gpt-image-2 high $0.21（慢+审核严，只做高级档）
- 视频：Veo 3.1 Lite $0.05/s · Kling 3.0 720p $0.084/s（无音频）· Hailuo 2.3 Pro 1080p $0.49/条 · Seedance 2.0 $0.30/s（fal）vs ~$0.15/s（BytePlus 直连推算）· Veo 3.1 $0.40/s
- 退场：Sora 2（API 2026-09-24 停）· Runway 不上任何聚合器 · Pika 转消费端

---

# 附录 A：fal.ai 现状（调研员 1）

（fal 视频目录：Seedance 2.0 / Kling 3.0+O3 / Veo 3.1 全系 / Hailuo 2.3 / Wan 2.7 / LTX-2.3 / Grok Imagine 1.5 / Luma Ray 3.2 / PixVerse V6 / Vidu Q3 / HunyuanVideo-1.5；缺 Runway、Sora 2 退场、Gemini Omni Flash 未上）

- 定价核实：Veo 3.1 与 Google 官方逐分不差（$0.40/s 标准、$0.15 Fast、$0.05 Lite）；Kling 3.0 与官方积分价逐项对齐（≈$0.084-0.196/s）；Seedance 2.0 fal $0.3034/s vs 国内官方≈$0.14/s（约 2 倍，但国际个人无低门槛直连替代）
- DX：queue API（request_id+轮询/回调）；webhook 15s 超时后 2h 内重试 10 次、按 request_id 幂等；5xx 不计费；服务端错误自动重试（X-Fal-No-Retry 可关）；并发制限流（新户 2 → 充值自动 40 → 找销售）；预充值 credits（365 天过期）/大客户月结
- 条款：按模型打 Commercial/Research badge；ToS 不保证输出不侵权、客户 indemnify；无 SLA（StatusGator 年 747 事件，平均 337 分钟解决）
- 公司面：2025-12 Sequoia 领投 $140M D 轮（$4.5B），2026-03 传 $8B 再融资，2026-05 AWS 深度合作；250 万开发者；客户 Canva/Adobe/Amazon MGM
- day-0 记录：Kling 3.0（2026-02-04）、Hailuo 2.3、Grok 1.5 均 day-0；Seedance 2.0 fal 为全球 API 首发（2026-04-09）
- SG/MY：无 APAC GPU 区域但厂商托管模型在厂商侧推理；跨洋 RTT 在分钟级生成里可忽略；支付经第三方处理商（卡/ACH），无国家限制条款（建议注册试刷验证）

# 附录 B：厂商直连门槛（调研员 2）

| | Seedance (BytePlus ModelArk) | Kling 全球 | Veo (Gemini API) | Hailuo (MiniMax) | Wan (阿里 Model Studio 国际) |
|---|---|---|---|---|---|
| 个人能开 | ✅（个人认证可，profile 偏企业向） | ✅ 邮箱即可 | ✅ 最顺滑 | ✅ | ✅ |
| 起充 | 资源包≈$30 起 | $9.80 体验包（不退款） | 后付费无起充 | $5 | 无（MYR1 预授权） |
| 旗舰价 | 2.0≈$0.76/5s 720p（推算；$7/M tokens） | 3.0 $0.42/5s 720p 无音频 | 3.1 $0.40/s；Lite $0.05/s | 2.3 $0.28/6s 768p | 2.6 $0.10/s 720p（2.7 已出 API 未列价） |
| SG 端点 | ✅ Johor（ap-southeast） | ✅ api-singapore.klingai.com | ✅ SG/MY 白名单 | ✅ 国际平台（SG 主体） | ✅ SG 数据驻留 |
| 水印 | 参数可控 | 参数可控（默认无） | 强制 SynthID 隐形 | 无参数（实测无可见） | 默认无 |
| 限流 | 个人 180RPM/3 并发 | 未公开 | Tier 制（绑卡 Tier1 月上限 $250） | 5 RPM（可邮件提额） | 未公开 |
| Webhook | 第三方称有（官方未核实） | ✅ callback_url | ❌ 轮询 | ✅（产物 URL 9h 过期！） | ❌ 轮询 |

- Sora：App 2026-04-26 已关，API 2026-09-24 停服，出局
- 友好度排序（马来西亚个人）：Veo ≈ Wan > MiniMax > Kling > BytePlus

# 附录 C：聚合器横评 + 创作者实况（调研员 3）

- 聚合器格局：fal 赢了视频聚合心智（HN 共识"Replicate lost out to fal"）；Replicate 被 Cloudflare 收购（2025-11，独立性存疑，新户强制预付费）；Together 视频是转包 Runware；WaveSpeed 主打亚太系首发（自家博客立场偏颇）；kie.ai 低价=疑似非官方渠道（Trustpilot 大量差评）；PiAPI/GoAPI 的 MJ API 已双双停服（逆向 API 结构性死亡样本）
- 头部聚合器不加价（赚厂商分成），便宜得反常的=风险转嫁
- HN 实操共识：fal + Replicate 互为 fallback 是独立开发者标配；fal 痛点=CDN 下载慢（2026-05 帖）、新模型报错照扣 credit（2026-02）
- 2026 上半年风险案例：Sora 2 退场（6 个月窗口）；Seedance 版权风暴（Disney 律师函→3 月暂停→4 月加过滤重开，名人/IP/版权音频全被过滤）；FLUX.2-dev 改 Non-Commercial；Veo 3.1 Lite $0.05/s 官方杀价改变相对性价比
- 创作者主力（2026-06）：Kling 3.0/O3（角色一致性之王+元素库）、Veo 3.1（物理+48kHz 原生对白）、Seedance 2.0（多 shot 叙事+性价比）；二梯队 Runway Gen-4.5（不上聚合器）、Hailuo 2.3（风格化）、Wan（开源/本地党）、Vidu Q3（动漫+参考一致性）
- multi-reference schema 全不互通（Kling 元素库 4 图/Seedance 9+3+3/Veo Ingredients/Vidu 4+2/Wan 150 帧）→ Fikirtive 跨模型实体库=真实断层上的接口价值
- ComfyUI 重度用户（400 万）：图像尽量本地、视频大量走 API；不反对付费，反对锁定和审查 → 可转化第二人群（reference 资产可导出到本地工作流是吃下他们的钩子）

# 附录 D：参考图生成选型（调研员 4）

- 榜单（2026-06）：gpt-image-2 文生图/单图/多图编辑三榜第一（Elo 1465）但慢（高质量档 2.5-4.5 分钟/张）+审核严（logo/IP 易拦）+贵（high $0.21）→ 只做高级档
- 工作马：Seedream 5.0 Lite（fal $0.035，10 参考图，4K，角度一致性口碑最好）+ Nano Banana Pro（$0.15，14 输入图 5 主体身份锁，文字渲染最强之一）+ NB2（$0.08 性价比档）
- 多角度 turnaround 2026 标准做法：master shot（单源真相）→ 编辑模型逐角度转 + **fal 官方 Qwen-Edit Multiple-Angles LoRA（96 确定性相机位姿：8 方位×4 仰角×3 距离）**；重度一致性走角色 LoRA 训练（fal qwen-image-trainer-v2）——LoRA 法视角一致性 85-92% vs 纯 prompt 65-75%
- Higgsfield Soul：自称自研底模（无法验证）；Soul ID=10-20 张照片 3-5 分钟训练→无限生成（工程特征=LoRA 个性化）；Soul 模型可经 WaveSpeed API 买到（$0.09-0.19/张）→ "Higgsfield 质感"不需要逆向
- **角色 LoRA 训练 = 实体概念的天然变现深化：一个 character 实体 = 一个训练好的身份**（v2 方向）
- 按任务路由：Prop/Style→Seedream 5L 默认+NB Pro 高级；Character→master shot+Multiple-Angles LoRA 两段式；Location→NB2 默认
- 成本：一次完整引导流程≈$0.25-0.35（Seedream 路线）
- 注意：Google 系输出 SynthID 水印（喂视频模型无碍）；gpt-image-2 别放默认路径（4 分钟+版权审核误杀"印自己 logo"场景）
