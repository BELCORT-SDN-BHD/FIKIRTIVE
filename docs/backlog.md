# Artlio — 待办积压（reconciled backlog）

> ⚠️ **已废止(TOMBSTONE 2026-07-04)。** "Artlio"是 pivot 前的项目名;本表(2026-06-13)
> 早于 FIKIRTIVE 宪法栈,状态判断已过期。**不要据此排优先级。** 权威路线见
> `docs/BLUEPRINT.md` 第六章 + 判决记录。保留仅供历史考古。


来源：2026-06-13 对主力 session `dd98fa86`（claude.ai `cse_01UMYW…` 的本地镜像，55MB）的对账综合。
核心创作闭环已上线 prod 并真钱验收；下表是**仍未做**的项，按性质分组。强项/已完成不在此表。

## A. 验证门（你自己定的，解锁后续的前置）
- [ ] **升级门 D23**：连续 3 个真实项目全程在 Artlio 管理 → 解锁商业化/credit。**最关键，是总闸。**
- [ ] **Gate 0**：≥3 个 AI 视频创作者观察"你现在如何管理参考图"（只观察、不推销）→ 解冻商业叙事。
- [ ] 创始人作业：下个完整视频记录耗时 + 月工具花费（验证数据）。
- [ ] M0 验收：登录→上传→建镜头→导出 MP4 跑通一遍（可能已在 dogfood 中完成，未确认）。

## B. 护城河本体（未建，综合标为 #1 核心缺口）
- [ ] **自有模型管线**（Modal/ComfyUI 自训 workflow）—— provider 端口已留，换一行接入 `SelfHostedProvider`。
- [ ] 角色 LoRA 训练（一个实体=一个身份，跑在 Modal）。
- [ ] 自部署 Qwen copilot（cowork v1 现走 fal→Claude，可换）。

## C. 即时可做（无阻挡）
- [ ] **✨ cowork prompt enhancement（#30）**：Gen space/Storyboard 的「✨ Enhance」按钮（`CoworkProvider.enhancePrompt`）。钱安全波已部署，**当前无任何阻挡**。

## D. 商业化（被"credit 最后"规则挡）
- [ ] credit/定价系统（100CR=$1、markup 1.5-1.8×、失败=0+质量重试、$18 Creator/$48 Studio）—— UI 已搭、未接通（768 CR 是假的）。
- [ ] Stripe 计费。
- [ ] Resend 域名验证（开放注册前必做；现发件锁 `onboarding@resend.dev`，只能发到 tools@belcort.com）。
- [ ] Neon 付费档（PITR 6h→7-30 天，上线前）。

## E. 渲染/编辑器正确性（技术债）
- [ ] 导出忽略时间线空隙 → 黑帧填补（render 关键路径，需本地 ffmpeg 测，不盲发）。
- [ ] editor 保存 CAS（旧标签页保存覆盖新段；`addSegment` 已加乐观 CAS，保存路径未加）。
- [ ] R2 孤儿字节清扫（事务失败留下的对象）。
- [ ] 统一队列过期策略对 prod 现有队列行生效（需重建队列行）。
- [ ] Shotstack Studio Controls 无 teardown API（已向前兼容 dispose?.()）——SDK 升级时检查是否已加，或给上游提 issue。（2026-07-07 自 TODOS.md 移入,仍是活项）
- [ ] AppShell `LAST_PROJECT_KEY` 未校验（旧壳死码，低风险）。

## F. 功能补全/差异化（延后到 v2/验证后）
- [ ] 音频 sector：TTS+音乐生成、audio-to-video、编辑器音频编辑 UI（现仅 per-clip 音量/静音 + 1视觉+2音轨混音地基）。
- [ ] Premiere XML / OTIO 逃生口导出（pro 逃生口）。
- [ ] 其他实体类型生成（CHARACTER turnaround、LOCATION；现仅 PRODUCT 旗舰流）。
- [ ] 帧级 Retake（局部重生成 2-16s）。
- [ ] Caption/字幕、Extend、Upscale、Brand Kits、Education hub、run-motion 预览。
- [ ] Pitch deck 导出、真协作（假头像已删）。
- [ ] Canvas 无限画布（已砍，留占位，建不建待你定）。
- [ ] 阶段二：配方记忆、成本预告牌、直连厂商 API（E4/E5）。

## G. 运维/清理
- [ ] 删 Railway 死卷（R2 接管后的旧卷，pendingDeletion 卡住）。
- [ ] 本地浏览器实景视觉巡检（静态审计之外）。
- [ ] Remotion 企业 demo 成片（阻塞于：你提供登录 + 选展示内容）。

## 已显式排除（重提需新评审）
- E3 视觉连续性引擎 —— 2026-06-10 砍掉，写进设计文档 NOT-in-scope。

## 已解决（对账修正）
- ✅ 10 个 cloud ultrareview 修复（worker 钱安全波 #2/#3/#6/#8 + web 波 #1/#4/#5/#9）+ `generation_shot_version_unique` 迁移 + 双服务部署 —— 2026-06-13 本会话完成并 prod 验证。
