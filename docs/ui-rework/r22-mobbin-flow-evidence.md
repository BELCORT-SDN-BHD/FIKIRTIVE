# R22 前端扩展：Mobbin 流程证据

> 更新时间：2026-08-25（MYT）  
> 用途：记录 R22 未完整覆盖的流程证据。R22 仍决定共同视觉基础；这些流程只补足状态、顺序与行为，不能覆盖 R22 的 shell、token、排版或 Canvas 结构。

## 使用边界

- 证据来自官方 Mobbin MCP 的完整 flow，不用单张截图推断完整流程。
- production 只接真实数据与真实 action。缺 backend 的 surface 必须显示 unavailable、permission、loading 或 error，不伪造 empty、success、sent、read 或 saved。
- `?fixture=r22` 只在非 production 环境提供确定性视觉数据。
- 每次进入详情、执行动作或跨 workspace 时，server 仍须重新验证 tenant 与 resource 权限。

## Projects、Canvas 与 Otto

| 产品 / Flow | Mobbin flow ID | 采用的行为证据 |
|---|---|---|
| Jasper Projects | [`f5df65ec-f233-458b-b469-7df93d6af91d`](https://mobbin.com/flows/f5df65ec-f233-458b-b469-7df93d6af91d) | Projects 顶层明确区分 empty 与 populated；My / Shared / All、search、owner、last modified、visibility 都属于列表合同，不应从空数组推断权限或加载成功 |
| Jasper Create project | [`5bf9cf01-e343-4f91-b9e0-f25d10545b7e`](https://mobbin.com/flows/5bf9cf01-e343-4f91-b9e0-f25d10545b7e) | 创建后进入工作 surface；project goal、voice、audience、language 与 context 是项目级设置，不等同于只保存一个 title |
| Stitch Start chat | [`a8f6d3c4-0622-4b62-ac13-e02adaa201b4`](https://mobbin.com/flows/a8f6d3c4-0622-4b62-ac13-e02adaa201b4) | prompt → generation/progress → canvas result → 继续迭代是同一任务；composer、agent progress/log 与产物 surface 同时可达 |
| Stitch Add screen | [`c406e2c4-d94d-4435-aa25-0deb3a210e7a`](https://mobbin.com/flows/c406e2c4-d94d-4435-aa25-0deb3a210e7a) | 新增产物须经过明确选择与完成状态；不能在真实 job 未完成时先显示成功节点 |
| Cloudflare Ask AI | [`5a90ebd3-8023-4be7-8931-fb296a3d58e0`](https://mobbin.com/flows/5a90ebd3-8023-4be7-8931-fb296a3d58e0) | 非 Canvas assistant 从当前 dashboard 打开侧 panel；new conversation、suggested prompts、thinking、answer 与 close 都保留底层 route context |

采用的 FIKIRTIVE 合同：

1. R22 仍决定 Projects 与 Canvas 的最终可见结构；Jasper、Stitch 与 Cloudflare 只补充状态和顺序。
2. Projects list 的 loading、permission、read error、empty、populated 与 shared visibility 必须分开；现有 production 只闭合 owner list/title create，不能把 fixture 的 Shared/All 当真实数据。
3. Project brief 中的 goal、voice、audience、language、format 与 context 在 backend 保存前只是前端 draft；进入 Canvas 不等于它们已经持久化。
4. Canvas job 必须以真实 durable progress 驱动产物出现；Otto status、Conversation 与 composer 保留 R22 紧凑布局，不复制 Stitch 的 shell。
5. 非 Canvas Otto 保持 route-preserving panel。thread/history/streaming 已接现有能力；permission、unknown outcome、retry 与 workspace isolation 仍须由 backend/E2E 证明。

## Otto IQ

| 产品 / Flow | Mobbin flow ID | 采用的行为证据 |
|---|---|---|
| Jasper IQ hub | [`0f6eea06-b833-4732-87fa-c20ea68a7a8b`](https://mobbin.com/flows/0f6eea06-b833-4732-87fa-c20ea68a7a8b) | Brand Voice、Audiences、Knowledge Base、Style Guide、Visual Guidelines 是分开的资料类型与入口 |
| Jasper Brand Voice states | [`65040017-bcb5-4f33-8b6f-8a75e11e85cd`](https://mobbin.com/flows/65040017-bcb5-4f33-8b6f-8a75e11e85cd) | empty、populated、quota/limit、visibility 与 metadata 是不同状态 |
| Jasper Add Brand Voice | [`7ca28ebb-6b19-41ee-9dc0-0c27938f922b`](https://mobbin.com/flows/7ca28ebb-6b19-41ee-9dc0-0c27938f922b) | name/access/best-use → text/URL/file source → minimum input validation → generating/reviewing → editable result 是完整 15-screen flow |

采用的 FIKIRTIVE 合同：

1. R22 Otto IQ hub 与 panes 保持视觉权威；Jasper 只决定新增资料的完整状态链。
2. URL、file 与 pasted text 是不同 source contract，必须各有 processing、validation、error 与 retry；当前 generic memory CRUD 不冒充这些 ingest flows。
3. processing 中不能提前显示可用的 brand memory；生成完成后仍要显示 source、scope/visibility、freshness 与可编辑结果。
4. quota、permission 与 empty 不合并。当前缺 backend 的入口继续明确 unavailable，而不是 fixture success。

## Settings 与 workspaces

| 产品 / Flow | Mobbin flow ID | 采用的行为证据 |
|---|---|---|
| Linear Settings | [`d25c7666-f06d-4b4f-9d9b-ec3f9663c87e`](https://mobbin.com/flows/d25c7666-f06d-4b4f-9d9b-ec3f9663c87e) | Personal、workspace、features、administration 与 integrations 分组；每个 pane 有自己的 list/empty/configuration 状态 |
| Linear Workspace settings | [`820abf56-0781-456e-b6ed-98609be8edc9`](https://mobbin.com/flows/820abf56-0781-456e-b6ed-98609be8edc9) | workspace general、security、members、labels、projects、templates、plans、billing 与 integrations 分层；保存和危险删除动作分开 |
| Linear Members | [`b63447a1-b9ed-4a93-91e8-c1101bf0b22a`](https://mobbin.com/flows/b63447a1-b9ed-4a93-91e8-c1101bf0b22a) | member list 包含 status、role/team 与 activity；invite、role change、remove 需要资源级权限，而不是仅凭客户端角色名 |

采用的 FIKIRTIVE 合同：

1. R22 Settings surface 维持共同排版与 token；Linear 只补充分组、状态与权限边界。
2. account、workspace、members、security、notifications、connections 与 billing 不共享一个泛化 save success；每个 section 独立 loading/error/permission/success。
3. workspace switch 必须重新读取 tenant-scoped data；旧 workspace 的 cached rows 不能在新 workspace 暂时可见。
4. invite、role/capability change、remove member、disconnect 与 delete workspace 都要明确确认、server authorization 和真实 receipt；当前未接 backend 的按钮保持 unavailable。

## Home、认证与 onboarding

| 产品 / Flow | Mobbin flow ID | 采用的行为证据 |
|---|---|---|
| Customer.io Login | `d293d79c-c6b5-4561-939c-51ef65e8728a` | 单一主任务、清晰错误、登录后继续原意图 |
| Customer.io Onboarding | `69c8b311-0703-4bcc-89ba-a425cc9029d8` | 分步设置、可回退、完成前持续显示进度 |
| Linear Onboarding | `64ae582c-747c-4c77-8629-812abcbef186` | workspace setup 与个人偏好分离，允许稍后补完 |
| Jasper Brand voice | `df9147c9-e6c7-46a5-bc02-8d7ed41cb052` | URL 导入与手动 brand input 是不同路径；导入须有真实处理状态 |
| Buffer Instagram connect | `c245490f-504a-44aa-baea-d6207d664dfe` | 专业账号可直接连接；个人账号不能被假装成可自动发布 |
| Hootsuite Connect | `844bc863` | OAuth 前解释所需权限，失败与 reconnect 分开 |
| Customer.io Routine trigger | `fd1ee763-e4c6-4024-9396-dc109b06beef` | trigger、timezone、review、activate 是独立步骤 |
| Customer.io Schedule | `47d306b5-4b96-4fa3-aacd-f1384554b543` | 时间与时区在确认前可见 |
| Buffer First post | `f1ef44bf-5a5b-41da-ab48-794eaa129e97` | 首帖从内容意图进入 composer，不把未生成内容伪装为完成 |
| Buffer Scheduling | `75259d32-c222-4997-970c-a71c9538bfa2` | 发布/排程结果必须有真实状态和失败出口 |

## Notifications

| 产品 / Flow | Mobbin flow ID | 采用的行为证据 |
|---|---|---|
| incident.io Notifications drawer | `fcb879a0-5b14-483b-a03c-0199de26cea8` | badge → empty/populated drawer；drawer 有 Preferences 与 close |
| Linear Inbox | `2ee08fdf-b415-43f3-8a8b-6d36107b5c6f` | empty、populated、master-detail；点开资源时标记已读 |
| Linear Mark all read | `d1d517cc-d7ac-4789-aba4-fff323093036` | mark-all-read 与 delete-all 分开；已读历史继续保留 |
| Klaviyo Notifications | `dad42481-5a5d-4ef5-b79e-99954eaef6c3` | empty、error notification、detail、back、dismiss 是不同状态 |
| Linear Notification settings | `ce3110ea-943a-42db-9452-5122a250848e` | 先选 channel master，再配 event matrix |
| Linear Disable email | `a8593df6-ec1d-442f-ba7f-59dec5123828` | 关闭 channel 后不把各事件显示成仍可送达 |

采用的 FIKIRTIVE 合同：

1. 顶栏 drawer 与完整 Notifications 页面共享同一份 server-backed unread store。
2. 点击通知前重新验证 workspace、resource 与 capability；不能信任客户端携带的 owner 或 href。
3. `Mark all as read` 只改变 read state，不删除历史。
4. load error 不能显示成 `You are all caught up`；permission、empty、error、retry、populated 必须可区分。
5. 当前仓库没有 notification store 与可靠 unread action。production 前端因此只显示明确的 backend-unavailable 合同，不显示假 badge、假事件或假 read success；fixture 才展示 populated parity。

Mobbin 暂未找到成熟的 notifications-center「整页读取失败 → retry」完整 flow。FIKIRTIVE 的 error/retry 仍按产品安全合同实现，并在 backend handoff 中单列。

## Help 与 support handoff

| 产品 / Flow | Mobbin flow ID | 采用的行为证据 |
|---|---|---|
| Front Help | `593dac8e-3418-4237-85cd-b13616cd5d76` | route-preserving panel；Help、Suggestions、What’s new 分区 |
| Gemini Help search | `ab6ad9f1-d6fe-49ab-aa48-911b5681a15e` | 搜索结果与无结果分开 |
| Gemini Article detail | `144ac551-e633-4db6-b3ba-ea5d8d02e75a` | 从结果进入文章详情，保留返回路径 |
| Synthesia Contact support | `c50649a4-63c0-4c9f-8eba-14a7e23279c0` | 提交前 review，明确说明会附带什么上下文 |
| Synthesia Chatbot / human wait | `b3ebf790-9fa9-4ef8-bbdb-39976769f82a` | bot 与 human handoff 分界；等待/queued 不冒充已回复 |
| Supabase Support ticket | `827eaf77-8ae0-4a76-a8f2-a65aa589e912` | ticket 的 submit、waiting、closed 是不同状态 |
| HubSpot Assistant boundary | `c872c12b-a49e-49d1-a134-fbdc24edf157` | assistant 能力边界清楚，无法执行时提供真实人工出口 |

采用的 FIKIRTIVE 合同：

1. Help panel 不替换当前 route，关闭后焦点回到触发器。
2. 官方文章搜索只能使用已验证、可版本化的 help corpus；政策页不能冒充产品指南。
3. support handoff 必须依次显示 review → submit → waiting/queued → closed；只有 backend 回执才能进入 sent/queued。
4. route、workspace、conversation、logs 等上下文逐项 opt-in；production 不默认附带。
5. 当前仓库没有已验证 help corpus 或 support-ticket backend。前端提供真实外部 support 出口与明确 unavailable 状态，不伪造已发送 ticket。

## Backend handoff 必须补齐

- Notification：owner/workspace-scoped list、cursor、unread count、mark one/all read、dismiss、resource authorization、channel/event preferences、retry semantics。
- Help：版本化 article corpus、search index、article permissions、support draft、explicit context consent、submit idempotency、ticket lifecycle。
- 两组接口都要有 loading、empty、error、retry、success、permission 测试，并做双租户隔离验证。

## Mobile navigation：已排除在本次范围外

- 2026-08-25 曾调用官方 Mobbin MCP `search_flows` 查询 iOS 导航 flow，并收到 `Auth required`。这是历史调查记录，不再是交付 blocker。
- Founder 已再次确认本次前端重建严格为 **desktop only**。因此不继续研究、裁决或验收 mobile navigation、bottom rail、safe area、窄屏入口与 overflow；现有窄屏源码行为也不构成本次产品承诺。
- 以后若另开移动端任务，仍须先取得 Mobbin 完整真实 flow，再独立定义移动端 IA 与验收矩阵；不得从本次 desktop 实现推断。
