# FIKIRTIVE 本地生产规模 QA 库存

日期：2026-07-04  
环境：本地 Next.js `http://localhost:3101`，Postgres `localhost:55432`，`AUTH_ENABLED=true`，`GENERATION_PROVIDER=mock`，无真实 Anthropic/Meta/Stripe 密钥。  
数据：脱敏确定性种子，2 个组织，10 个项目，24 个实体，282 个资产，632 条生成记录，50 个线程，60 条消息，40 个画布节点，10 条账本。

## 安全边界

- 不连接生产数据库、生产存储、生产 OAuth、真实 Stripe、真实 Meta 写入或真实 LLM 付费供应商。
- 真实花费路径验收为：本地 mock 成功、缺密钥/未连接时给出可理解状态、不发生后台扣费或外部写入。
- `docs/BLUEPRINT.md` 是约束源，不编辑。当前测试以 `/otto` 为唯一前门；`/library`、`/m`、`/` 应重定向到 `/otto`。

## 角色库存

| 角色 | 账号/入口 | 应可见 | 应禁止/降级 | 边界用例 |
| --- | --- | --- | --- | --- |
| 未登录访客 | 无 session | `/login`、重定向目标保留 | `/otto`、`/billing`、`/admin/*` | 非法 `from` 参数不能开放跳转 |
| 商户 owner | `merchant.qa@example.test` | `/otto` 全部商户面：Canvas、My Stuff、Brand memory、Schedule、Analytics、Account | `/admin/*`、跨 owner 数据、真实 Meta 写入 | 深链隐藏视图可加载但不应出现在主导航 |
| Founder / super-admin | `founder.qa@example.test` | 商户面 + `/admin/*` | 真实生产写入；自降级锁死 | admin 读写必须由 allowlist + RBAC 双重保护 |
| Impersonated admin | admin 触发 | 可查看商户上下文与 banner | 花费/生成/Meta 写入 | banner 明确，写操作被阻断 |

## 路由库存

| 路由 | 用户面 | 验收标准 | 风险边界 |
| --- | --- | --- | --- |
| `/` | 根入口 | 302 到 `/otto`，未登录再到 `/login` | 不出现旧 landing |
| `/m` | 旧入口 | 302 到 `/otto` | 不分叉第二入口 |
| `/library` | 旧入口 | 302 到 `/otto` | 不暴露旧库入口 |
| `/login` | 登录 | email/password、magic link、Google 按钮、错误/成功状态 | allowlist、错误密码、空 email、恶意 from |
| `/otto` | 主 app | 默认 Canvas；项目、线程、余额、历史、画布、chat 正常加载 | 空数据、规模数据、移动端、无 LLM 密钥 |
| `/otto?view=stuff` | My Stuff | 搜索、过滤、上传/生成弹窗、实体 rename/delete、产品图选择 | 大量素材、坏媒体 URL、空筛选 |
| `/otto?view=memory` | Brand memory | 分区 tabs、事实/产品/客群/offer CRUD、undo、产品图选择 | 空文本、超长文本、并发保存 |
| `/otto?view=schedule` | Schedule stub | 按蓝图显示 coming soon，不死链 | 不能承诺已上线自动发布 |
| `/otto?view=analytics` | Analytics | 未连接 Meta 时显示连接 CTA；已连接占位数据不崩溃 | token 缺失/坏 token、range/platform 切换 |
| `/otto?view=account` | Account | 余额、账本、套餐/签出/登录状态 | 无账本、Stripe 缺配置 |
| `/otto?view=connections` | 深链连接 | Meta 状态、connect/reconnect、ASK/AUTO、pause/resume、disconnect | 缺 OAuth env、不真实写入 |
| `/otto?view=library` | 深链旧库 | 加载不崩溃，可把素材送到 Otto | 不在主 nav 出现 |
| `/otto?view=templates` | 深链模板 | 模板列表、预览/使用弹窗 | 空模板、非法项目 |
| `/otto?view=discover` | 深链发现 | 灵感卡片、Use in Otto | prompt 注入、回到 Canvas |
| `/billing` | 购买 credits | 展示套餐；Stripe 缺配置时可理解失败 | 不能创建真实 checkout |
| `/files/[...key]` | 媒体代理 | 合法本地 key 返回；非法 traversal 拒绝 | 路径穿越、缺文件 |
| `/admin` | Admin root | 302 到 `/admin/settings` | 商户禁止 |
| `/admin/settings` | Admin settings | provider/vision/modal 设置读取保存 | 非 super-admin 禁 modal |
| `/admin/directives` | Admin directives | seed、textarea、confidence、enabled、save | 大矩阵保存、空 prompt |
| `/admin/models` | Admin models | model enable/notes 保存 | 未知 model、重复保存 |
| `/admin/team` | Admin team | role select、save，不能改自己 | 自锁、无权限 |
| `/admin/credits` | Admin credits | 余额、ledger、grant form | 负数/小数/重复提交 |
| `/admin/tenants` | Tenants | invite、revoke、租户列表 | 非法 email、重复邀请 |
| `/admin/tenants/[orgId]` | Tenant detail | grant、status、cut sessions、impersonate | 跨租户、被停用租户 |
| `/admin/conversations` | Conversations | 列表、详情链接 | 大量线程 |
| `/admin/conversations/[threadId]` | Conversation detail | 消息、payload、状态可读 | 不泄露跨 owner |
| `/admin/content` | Content moderation | generation/content 列表 | 坏资产 |
| `/admin/audit` | Audit | type 过滤、payload 展示 | 大 payload |
| `/admin/cost` | Cost | generation/ad job spend 列表 | 空 spend、异常状态 |
| `/admin/system` | System | queue/system errors | pending/failed 聚合 |
| `/admin/knowledge` | Knowledge | planner/brief/template textarea save | 空值、长文本 |
| `/kitchensink`, `/skin-preview/*` | 内部预览 | 本地可深链检查视觉组件 | 不作为生产入口 |

## 控件、状态、工作流验收

| 区域 | 按钮/输入/弹窗/状态 | 验收标准 | 有限边界用例 |
| --- | --- | --- | --- |
| 登录 | Email、Password、Show/Hide、Forgot、Sign in、Email magic link、Google、Use different email、alert | 空输入不提交；错误展示；magic link 生成并可登录；恶意回调被清洗 | 空 email、错密码、未 allowlist、Google 缺配置 |
| App shell | sidebar collapse/show、mobile menu/backdrop、New campaign、nav items、项目 expand/collapse、rename prompt、delete confirm、线程选择/delete、余额、头像 | 状态切换无刷新丢失；删除需确认；余额以 credits 显示；移动端可关闭抽屉 | 无项目、长项目名、12+ 线程、正在 working/failed/done dot |
| Canvas/Chat | Front door textarea、entity mention、send、attach image/video、goal chips、chat collapse/show、FlowCanvas pan/select、text/image/video nodes、detail panel | seeded 线程和节点可见；输入遵守 Shift+Enter 提交约定；无真实 LLM key 时失败可理解且不扣费 | 空 prompt、超长 prompt、坏附件、视频超长、无余额 |
| 生成确认 | image/video generate、make video、T2V dialog、delete node dialog、generation progress/error | mock provider 下可创建/展示 job；取消不会写入；错误节点可恢复 | 无 refs、多 refs、失败 job、重复点击 |
| My Stuff | search、type/status filters、Add asset/entity dialog、upload tab、generate tab、name/subject/prompt/format、rename/delete、set product image modal | 大量素材可筛选；新增本地记录成功；删除/rename 反馈明确；媒体缩略图不崩 | 空搜索、无结果、非法文件、长名字 |
| Brand memory | chat chips、composer、about/look/rules/customers/products/offers tabs、add/edit/archive/delete、undo、product image picker | CRUD 后列表更新；undo 可恢复；产品图可从 My Stuff 选 | 空字段、长文本、快速切 tab、归档后撤销 |
| Schedule | stub view | 明确 coming soon；无可误点发布控件 | 移动端显示 |
| Analytics | platform/range selects、connect CTA、connections navigation | 未连接/坏 token 不崩溃；CTA 可到 connections；切换 range 不误写 | 无数据、坏 token、移动端 |
| Connections | connect/reconnect、refresh、ASK/AUTO、pause/resume、disconnect | 缺 OAuth env 时显示失败/未连接；ASK/AUTO 和 pause 状态保存只影响本地 DB | 重复点击、断连、无 page |
| Account/Billing | balance、ledger、BuyPackButton、sign out | balance/ledger 正确；Stripe 缺配置不创建真实 checkout；sign out 后回 login | 空 ledger、重复购买点击、无 Stripe key |
| Admin shell | section nav、impersonation banner | founder 可进；merchant 拒绝；banner 存在时写入受限 | 深链、移动端 |
| Admin forms | settings/directives/models/team/credits/tenants/tenant detail/knowledge 所有 save/invite/grant/toggle/impersonate 控件 | 成功有持久化；失败不吞；自降级/跨租户/重复提交被拒 | 非法 email、负 grant、自锁、并发保存 |

## QA 运行记录

已按本库存执行浏览器 QA，详见 `2026-07-04-local-production-scale-qa-report.md`。

覆盖摘要：

- 未登录：`/otto` 重定向 `/login`，email/password/magic link/Google 入口可见，magic link 本地写出并可登录。
- Founder：主 `/otto`、My Stuff、Brand memory、Schedule、Analytics、Account、隐藏深链 Library/Templates/Discover/Connections、Billing、Admin 全部库存路由加载。
- Merchant：`/otto` 仅显示商户项目/余额；`/admin/settings` 被重定向回 `/otto`。
- 本地外部供应商边界：Stripe/Meta/Anthropic 未配置时不发生外部写入或真实花费；UI 显示无套餐、重连/未连接、Otto snag 状态。
- 修复后重跑：`/otto` 首屏 200，无 browser console error；关键视图无 console error。仅保留本地配置 warning 与 admin 聚合 tenant-guard warning 作为非阻塞观察项。
