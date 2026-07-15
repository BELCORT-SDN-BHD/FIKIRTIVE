# Founder 供给清单(一次收齐版,2026-07-12)

> Q3 指令:「开始 goal loop 之前,先确定好全部需要我的东西,我直接给予全部。」
> 你的预计时间投入：**开跑前一坐 ~2 小时 + 递审一坐 ~1 小时 + Founder-only / disputed PR 需要时的短合并窗口 + 终验一坐 2-3 小时。**普通可逆事件按现行委托规则自动推进，不要求 Founder 为事实步骤排 session。
> 密钥值永不写进文档/聊天——都是"你在自己后台操作,给 agent 的只是名字和权限"。
> **2026-07-16 对齐（D-038）**：本清单只列可预见供给，不构成真实花费、外部递交或 provider 写入授权；每一笔真实 spend 仍逐笔先问 Founder。Gupshup/EasyStore 是可替换 adapter，不是核心产品依赖；未选 EasyStore 不阻塞第一期。

## A. 开跑前一坐(~2 小时,一次做完;逐项打勾)

**账号与钥匙(约 40 分钟)**
- [ ] **Sentry**:注册免费账号 → 建 web/worker 两个项目 → 把两把 DSN 配进 Railway(或授权控制面配)。
- [ ] **WABA 专用电话号**:第一期 WhatsApp 真链需要一个合规可迁移/可替换的发送身份；当前 Gupshup adapter 若要求未绑定号码，再单独呈具体账号、迁移边界与真实费用请 Founder 批准。
- [ ] **可选 EasyStore adapter 真验载体**:只有决定本期同时验证该 adapter 时，才在 Saranghaeyo 自助授权或 dev store 之间拍板；不选择不阻塞 Contact/Campaign/WhatsApp/CRM 完成。
- [ ] **L0 短链域**:候选品牌短域(如 fkt.ly 类,粗估 ~$20-40/年)+ DNS 权限；选定价格后另列一笔真实 spend 请批，未批不购买。
- [ ] **Meta 商业验证启动**(材料类,已获你批准施工期办):BM 管理员权限确认 + 商业验证文件(SSM/地址证明)提交——这是身份验证,数周级,越早越好。
- [ ] **测试资产确认**:测试用 FB Page + IG 专业号(已有则确认可用);同意接收测试 WhatsApp 的手机号 1-2 个。
- [ ] **Reminder Email 受控测试身份**：一组 BELCORT/FIKIRTIVE 自有测试收件箱 + 可验证发送 identity，用于 B4 真实层测试；这里只收供给，不授权现在发送，也不与 Customer Email marketing 名单/consent 混用。
- [ ] **「账号开通半日」预约**:约定一个半天,loop 若遇到需要你收验证码/2FA/KYC 的批量动作,集中在这个窗口处理。

**钱(约 15 分钟)**
- [ ] **真实花费估算表（不是预授权信封）**:在执行前分别列 BytePlus、Stripe live 冒烟、WABA/Gupshup、短链域等预计费用；每一笔真实 spend 单独请 Founder 批准，未获批不执行。
- [ ] **Stripe live 测试规则**:确认允许"你的卡刷小额真单并退款"作为收款验证方式。
- [ ] **上市收费确认**(已答:只收 credits):确认现挂的 credits 包价格照旧,或要调数字(数字在 Stripe 后台,repo 只有读取机制)。

**法务与文本(约 20 分钟,Meta 递审硬前置)**
- [ ] 隐私政策 / ToS / 数据删除说明三页:agent 起草 → 你读一遍批准(公开页面,Meta 审核必查)。
- [ ] 退款政策一段话:你定基调(如"credits 未使用可退,已消耗不退")。

**治理与节奏(约 15 分钟)**
- [ ] **Founder-only / disputed 合并窗口**：如你喜欢可预留一个短窗口；普通 delegated merge 按 `AGENTS.md` 当前条件执行，不等待此日历。
- [ ] **待裁批次 SLA**:攒批报告后你多久内回(建议 48h,不急的标明即可)。
- [ ] **对标锚确认方式**:默认用对标地图的品类最强者,agent 每块 spec 里冻结;你只在有异议时改。
- [ ] **codex 配额策略**(FIK-1 提示今日已触顶两次):升配额 / 接受排队 / 减少异族评审频次——三选一。
- [ ] (可选)staging `NORTHSTAR_PREVIEW=1`:要不要随时能亲自看原型城。

**遗留清尾(约 10 分钟)**
- [ ] 合并 **#238**(FIK-1 终局状态账)与我的**交接包 PR**(见 HANDOFF-README)。
- [ ] **Cloudflare Global Key 轮换**(D5 最优先项):在 Cloudflare 后台重新生成、换成最小权限 token(agent 给步骤,你操作)。
- [ ] Railway 移除 `FAL_KEY`(fal 已弃用)+ fal.ai 后台吊销旧 key。
- [ ] 电脑清理第二组:三件事各一句话——d629 目录核对一致后删?两份 serene-swartz 重复副本留哪份?停止的 salvador/artlio 旧容器删不删?

## B. 递审窗口(受审面就绪里程碑,一坐 ~1 小时)

- [ ] 签发外部申请:Meta App Review(材料 agent 备齐,你过目签发)/ WABA 正式接入 / GBP API；EasyStore 只在选择验证该可选 adapter 时由商家自助授权。每份申请单独确认真实外写与费用。
- [ ] 之后 1-3 周内可能有补件:按「账号开通半日」机制或快速通道处理(小时级响应最省总时长)。

## C. Founder-only / disputed 合并窗口（按需，通常 ~10 分钟）

- [ ] 对 Founder-only / disputed PR 看放行清单（每个 PR：一句人话 + exact-head 机器闸 + 独立评审结论）→ 点头。普通 delegated PR 不进入本清单。

## D. 终验(建成+通电后,一坐 2-3 小时)

- [ ] 读一页 release cockpit → 看跨城演示 → **亲手走 15 步剧本** → 裁待裁清单 → 说"上市"。
