# Mobbin evidence — Create → Library → Schedule

> 研究日期：2026-08-30。  
> 任务：验证没有 Campaigns 时，成熟产品如何处理创作成果、媒体资产与排期之间的 handoff。  
> 方法：使用 Mobbin MCP `search_flows`，并按返回的 flow screenshots 检查实际画面；不是只读 metadata。

## 1. Adobe Express — editor 直接进入 social scheduling

Flow：[Scheduling a post](https://mobbin.com/flows/5fdad49c-7b31-4139-9344-b98a225c45f2)

从 editor 的 Share 进入 `Share to social media` overlay。创作仍留在背景；overlay 内完成 channel、caption、
Schedule / Publish now / Save as draft、日期和 preview。完成后回到 editor，并出现带 `View in calendar` 的成功反馈。

**可借鉴：**

- Schedule 是当前创作的直接 next action，不要求先离开去 asset library；
- 排期是一次明确 handoff，不把完整 calendar 塞进 editor；
- 成功反馈提供进入 Calendar 的出口，也允许留在当前创作继续工作。

## 2. Later — Library 是资产层，Calendar 是行动层

Flows：

- [Creating a post](https://mobbin.com/flows/05f0e819-43cc-493e-a41c-322d5bcee58d)
- [Media](https://mobbin.com/flows/127f1d57-674f-4cb6-9cf4-b95d0b9101ba)
- [Calendar](https://mobbin.com/flows/9d6b48ee-f7ad-47a2-b4fe-491dcf9c7a18)

Calendar 左侧持续显示 media rail；用户可以从资产进入 post composer，也可以打开独立 Media 管理页。Media 页使用 grid、
search/filter 与 labels 管理长期资产；Calendar 则负责日期、post state 与发布动作。

**可借鉴：**

- Library 与 Schedule 是同一份资产的两个 projection，不复制文件；
- Library 负责 find/manage，Schedule 负责 when/where/status；
- 用户不需要为了安排一条刚做完的内容而先经过完整 Library 页面。

## 3. Hootsuite — Schedule composer 内嵌 Library picker

Flow：[Adding an image from media library](https://mobbin.com/flows/938af674-9c48-4b8a-b1ec-481fa21de09d)

在 `Create a post` composer 内，media action 提供 `Upload from your computer` 与 `Media library`。选择 Library 后，
picker 在当前 composer 旁展开；选中的图片直接进入 post preview，用户没有离开当前任务。

**可借鉴：**

- Schedule 必须能在自己的上下文内引用 Library；
- picker 是 Library 的 contextual projection，不是第二套 asset store；
- asset picker 关闭后，用户仍留在排期任务和 channel preview 上。

## 4. Semrush — post preview 与 Calendar preview 同一排期步骤

Flow：[Creating a post](https://mobbin.com/flows/c829e358-5bbb-454a-a968-8ec67033b2c6)

排期 composer 同时提供 Post preview 与 Calendar preview。完成后回到 calendar，并在目标日期看到已排内容。

**可借鉴：**

- 排期前必须同时回答“会长什么样”和“会在什么时候出现”；
- Calendar 是结果状态的确认面，而不是 Creation 的子工具。

## 5. Fikirtive 采用与不采用

### 采用

```text
Create / Canvas
  ├─ every output → Library index（自动、同一 asset id）
  └─ Schedule action → handoff selected asset → Schedule composer

Schedule
  ├─ receive selected asset from Canvas / Library
  ├─ choose another asset through Library picker
  └─ confirm channel + time + preview → Calendar state
```

- Library 是唯一 asset truth；Canvas、Library 与 Schedule 引用同一个 asset id。
- Canvas 的 `Schedule` 是 direct handoff，不强迫用户先导航到 Library。
- Schedule 内的 Library picker 是同一 Library 的投影视图，不建立第二套媒体库。
- 排期完成后提供 `View in calendar` 与 `Keep creating` 两个清楚出口。

### 不采用

- 不采用 HubSpot / Mailchimp 的 Campaign grouping；Founder 已决定 Campaigns 不进入 v1。
- 不把 Later 的 Calendar 侧栏照搬进 Canvas；Fikirtive Canvas 继续保持 full-screen creation focus。
- 不把 Library 变成流程必经关卡；自动索引不等于强制导航。

## 6. Founder decision

2026-08-30，Founder 批准 Q2-A：direct handoff + automatic Library。
