# TODOS

> 由 /office-hours 与 /plan-ceo-review（2026-06-10）产生的延期项。每项含足够上下文供 3 个月后冷启动。

## P2 — 阶段二开建前

- [ ] **Modal 端点 1 周试运行**（S，无依赖，随时可做）
  - What: 把最常用的 1 个 ComfyUI 工作流打包成 Modal API，试跑 1 周，记录冷启动时间/单次成本/失败率/大文件上传体验。
  - Why: 阶段二编排层的超时/重试/队列参数需要真数据；端点不可用会导致编排层返工（外部声音 #10）。
  - Context: 创始人计划将 ComfyUI 工作流打包部署在 Modal（见设计文档"创始人补充的技术决策"）。此预检不阻塞阶段一。

## P3 — 验证门之后

- [ ] **本地迷你同步器**（M→CC:S，依赖：阶段一上传通道已稳定；来源：eng-review D4）
  - What: 可选的小型本地程序，监视创始人指定的本地文件夹（如本地 ComfyUI 输出夹、下载夹）自动上传到 Artlio。
  - Why: SaaS 形态下云端看不见本地文件夹；拖拽上传覆盖零散场景后，若本地产出量大，自动化才值得做。
  - Context: 原 E2 watch-folder 方案在形态修正（D3-D5）后的本地残余需求；第一轮调研的 chokidar/写完成检测/哈希结论届时直接复用。

- [ ] **正式多用户 auth 升级**（M→CC:S，依赖：P4 验证门通过；来源：eng-review D5）
  - What: 把最薄登录（访问密码/魔法链接）升级为正式 auth（Auth.js/Clerk 等），启用已预留的 owner_id 列。
  - Why: 邀请外部用户的前置条件；owner_id 第一天已预留（D14），升级是加面板不是动地基。

## P3 — 商业化验证门之后（P4 约束）

- [ ] **用户自带 API key vs 平台代付/credits 体系**（L→CC:M，依赖：≥3 外部用户验证 + E5 成本预告牌）
  - What: 决定外部用户用模型 API 的计费模式：BYO-key 还是平台 credits。
  - Why: "all in one"方向（D5 确认）必然遇到；credits 并发/幂等是 PRD 130 问 E 组的已知难题。
  - Context: PRD §17 定价方向 + `docs/prd-review/Artlio-PRD-Open-Questions.md` E 组；E5 的 cost_rules 是地基。

- [ ] **浏览器插件级捕获**（M→CC:S，依赖：E2 万源收录总线已上线）
  - What: 浏览器插件捕获 Kling/Midjourney 等网页工具的产出，自动入 Artlio 候选区。
  - Why: E2 的高级形态——覆盖无法落到本地文件夹的网页生成。
  - Context: E2 已覆盖"任意文件夹监视"；插件是下一层。

- [ ] **实体包市场/交易生态**（XL→CC:L，依赖：实体包格式（E1）稳定 + 外部用户基数）
  - What: 创作者之间交换/出售角色包、场景包、配方包的市场。
  - Why: 10x 生态愿景的终局形态（CEO 计划 Vision 章节）；格式先行，市场后置。
  - Context: E1 的导出/导入格式 + D13 安全约束（zip 不可信输入处理）是前置条件。

## 已显式排除（NOT in scope，重提需新评审）

- 视觉连续性引擎（E3）——用户 2026-06-10 明确跳过
- LoRA 训练纳入 Artlio——D15 例外条款，留在 ComfyUI
- 多租户/auth/credits 并发——P4 验证门前显式延期

## P3 — 设计债（/plan-design-review 2026-06-10）

- [ ] **手机端编辑能力**（L→CC:M，依赖：阶段一桌面版验证通过；来源：design-review D9）
  - What: <1024px 视口的可编辑体验（镜头板/拖拽/多选的小屏重设计）。
  - Why: 阶段一诚实只读；若验证后外部用户有移动场景需求再投入。
  - Context: 桌面优先策略 + "works best on desktop" 提示已在 UX 规格。

- [ ] **示例项目（onboarding 素材）**（S→CC:S，依赖：邀请外部用户前；来源：design-review D11）
  - What: 一套预置示例项目（Aurora 香水案数据集），空态提供"Load sample project"。
  - Why: 外部新用户的零门槛初体验；阶段一唯一用户是创始人，不需要。
