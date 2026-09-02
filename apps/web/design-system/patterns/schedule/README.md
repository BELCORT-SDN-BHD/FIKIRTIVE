# Schedule screen pattern

> **状态：Deferred from beta — 2026-08-31。未开始 frontend implementation。**  
> **上游权威：** `../../information-architecture/` 已冻结的 Schedule ownership、Create / Library handoff 与 analytics boundary。  
> **Mobbin evidence：** [`../../information-architecture/mobbin-create-to-schedule-evidence.md`](../../information-architecture/mobbin-create-to-schedule-evidence.md) 与 [`../../information-architecture/mobbin-analytics-ownership-evidence.md`](../../information-architecture/mobbin-analytics-ownership-evidence.md)。

## 1. 谁与成功标准

**主要用户：** 没有专职 social-media manager、需要亲自确认内容何时发布的小生意 Founder。

**一句成功：** Founder 能在同一张 Calendar 上看懂接下来会发布什么、在哪个 channel、处于什么状态，并能用 Library 的同一份 asset 完成排期或修正时间。

## 2. Product definition

Schedule 是 Fikirtive 唯一的 publishing calendar，不是第二个 Home、Campaign planner、Library 或 Analytics dashboard。

```text
Schedule / Calendar
├─ Empty slot or New post → composer overlay
│  ├─ selected Library asset
│  ├─ channel
│  ├─ caption
│  ├─ publish date and time
│  └─ channel preview
└─ Published item → lightweight detail panel
   ├─ delivery status
   ├─ content preview
   ├─ channel and published time
   ├─ lightweight result metrics
   └─ View performance → Home analysis
```

- Canvas 的 `Schedule` 直接带 selected Generation 进入 composer；不强迫 Founder 先经过 Library。
- Library 的 `Schedule` 使用同一个 asset ID；Schedule 内的 Library picker 只是 contextual projection，不建立第二套 media truth。
- Calendar owns `when / where / publishing status`；Home owns aggregate marketing health 与 deep analysis。

## 3. Core flows

### 3.1 Start from Calendar

```text
Open Schedule
→ choose empty slot or New post
→ composer overlay opens with that date
→ choose Library media, channel, caption and time
→ confirm
→ return to Calendar with the scheduled item visible
```

### 3.2 Handoff from Canvas or Library

```text
Canvas / Library selected asset
→ Schedule
→ composer overlay with the same asset attached
→ choose channel and time
→ confirm
→ View in calendar or Keep creating
```

### 3.3 Inspect or recover an item

```text
Calendar item
→ contextual detail
→ edit time / content while still editable
or retry a failed publication
or inspect lightweight published metrics
→ View performance for deeper Home analysis
```

## 4. Essential states

- `Draft` — prepared but missing a publish commitment.
- `Scheduled` — channel and future publish time confirmed.
- `Publishing` — provider operation in progress; cannot be presented as completed.
- `Published` — delivery receipt exists.
- `Failed` — keeps the item, reason and retry path visible.
- `Needs approval` — only when workspace policy requires it; Schedule must not silently bypass approval.

Unknown delivery or metric data displays `Unknown`, never a fabricated zero or success.

## 5. Checkable acceptance criteria

1. Schedule contains one Calendar surface; it has no overview dashboard or Campaign grouping.
2. `New post`, an empty calendar slot, Canvas handoff and Library handoff all reach the same composer pattern.
3. Composer shows selected media, channel, caption, date, time and a realistic channel preview before confirmation.
4. Composer can choose or replace media through the canonical Library picker without copying the asset.
5. Confirmation returns to Calendar and visibly places the item at the chosen time.
6. Editing an item preserves its identity and status history; it does not create a duplicate scheduled object.
7. Draft, Scheduled, Publishing, Published, Failed and policy-driven approval states are visually distinguishable without relying on color alone.
8. Failed items remain recoverable; retry cannot claim success before a delivery receipt exists.
9. Published detail shows only lightweight item metrics; `View performance` hands selected item / channel / date context to Home analysis.
10. Calendar, composer, detail panel, Library picker, status, forms and feedback consume canonical Design System owners.
11. All visible review-fixture controls have a real state change; fixture behavior must not claim production publishing, persistence or provider completion.
12. Dashboard mobile scope remains unchanged; this Schedule design is desktop-first unless Founder later changes the product boundary.

## 6. Founder decisions still required

> 以下问题全部延后；当前 beta 不需要回答，也不进入视觉方向或 implementation。

### Q1 — Default calendar density

- **A — Month first (recommended):** best for a Founder checking overall publishing cadence; precise time remains inside the item/composer.
- **B — Week first:** better for a dedicated social operator managing many daily posts.

### Q2 — Multi-channel creation

- **A — One post can target several channels, with one shared draft and per-channel preview (recommended).** Keeps v1 efficient without building a full per-channel editor.
- **B — One channel per scheduled item.** Simpler data model, but repetitive for the Founder.

### Q3 — Rescheduling interaction

- **A — Drag to another date/time, then show Undo (recommended).** Matches calendar expectations and keeps accidental moves recoverable.
- **B — Open composer and edit the time only.** Easier implementation but slower for routine planning.

### Q4 — Approval boundary

- **A — Schedule displays `Needs approval` and routes to the shared approval action; it does not build a second approval workflow (recommended).**
- **B — Approve directly inside item detail.** Faster for an approver, but widens Schedule into approval management.

## 7. Non-goals

- Campaign planning, budget, ads or campaign grouping;
- cross-channel analytics dashboard;
- a second media library or duplicated uploads;
- manual video editing;
- provider-specific settings or model names;
- mobile Schedule redesign;
- production publishing, persistence, channel authentication or backend retries in the review fixture.

## 8. Change register

| 日期 | 状态 | 记录 |
|---|---|---|
| 2026-08-30 | Drafted | 按冻结 sitemap、Create / Library handoff 与已保存的 Mobbin evidence 建立一页 Schedule screen candidate；等待 Founder 回答 Q1–Q4。 |
| 2026-08-31 | Deferred from beta | Founder：“这个 beta 不会有 schedule 的功能先。”保留长期 publishing ownership 与 research，不继续 spec、visual direction 或 frontend implementation。 |
