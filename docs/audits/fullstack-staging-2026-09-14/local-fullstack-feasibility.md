# 本地真实应用链路＋模拟供应商：只读可行性

2026-09-14。只读调查，未启动/停止进程、构建、运行测试、改数据库或产品/harness文件。未占用 test_inventory 的唯一跑道。

## 判定

**现成代码足够跑一条“浏览器确认生成 → Web → pg-boss → 独立 worker → 本地文件＋真实DB事务 → UI结果”的图片成功链路，无需修改产品或新增常驻 harness。** 供应商这一段必须明确标为 MockProvider；不能称真实模型生成，更不能把它算作 BytePlus 端到端验证。此为静态可行性，尚未执行验证。

也不是“给当前常驻E2E随手加worker就全绿”：当前suite设计成没有worker，部分journey直接播种QUEUED/FAILED等状态；worker启动就会reap、backfill、扫描和消费，可能破坏现有断言。必须等当前跑道结束，进入独立的有界操作阶段，确认所用库及pgboss队列只含此阶段夹具，不能与当前suite并行。

## 已核事实与最小方案

1. **复用现有隔离环境与正常登录。** `e2e/support/env.ts` 的 appEnv()统一DB、端口、认证secret、AUTH_ENABLED=true、stub邮件及本地存储；`e2e/support/auth.ts`已有登录helper。直接复用此来源，不造第二套身份、不关闭auth、不向生产发OTP。DB除 `_test` 名称外还必须核host确为本机且由本任务独占；名称检查本身不证明本地。
2. **Web保持现成production build启动方式。** `e2e/playwright.config.ts:58` 仅起 `pnpm --filter @fikirtive/web start`，next start自身为production。这无须改变：generation factory事实上只在worker调用（`apps/worker/src/generation.ts:26`），Web生成动作未读取BYTEPLUS_API_KEY或GENERATION_PROVIDER。不要为了mock修改Web生产守卫。
3. **独立worker明确是本地test进程。** 使用同库与同本地文件目录，单进程 `WORKER_ROLE=all`、`NODE_ENV=test`、`GENERATION_PROVIDER=mock`。这是现有dev/CI支持路径，不是生产豁免。`packages/generation/src/index.ts:311–328`：byteplus选真实适配器；production的其他值一律UnconfiguredProvider；非production才MockProvider。`apps/worker/src/boot-env.ts`也以本进程NODE_ENV判断生产契约。**不能**给production worker设mock后用warn硬闯；运行时仍拒绝。
4. **不需要worker构建。** 调查时 `apps/worker/dist/index.js`不存在，但其现有dev依赖tsx可运行源码；最小进程命令为 `pnpm --filter @fikirtive/worker exec tsx src/index.ts`，不使用watch。已构建的workspace包dist需由当前唯一跑道完成并确认新鲜后复用，因为workspace包exports指向dist，tsx不会自动重编那些依赖。若dist未齐，等test_inventory统一安排构建，本文不另开构建。
5. **传干净环境而非继承登录shell。** 从 appEnv()取得公共配置，只叠加worker上述三值。父执行器应采用明确允许的最小进程环境（PATH＋该map），而不是 `{...process.env,...map}`；设置 `DATABASE_URL_POOLED=""`，不继承真实provider、mail、Stripe、Meta、R2或Sentry密钥。当前OFF_MACHINE名单未覆盖R2_MEDIA_BACKUP等所有新变量，故单纯清其旧名单不足以声称无外部作用。worker源码不需要读取`.env`，不得添加dotenv自动加载。`STORAGE_DRIVER`保留本地空值或local，不设r2。
6. **两边文件路径一致。** Web `apps/web/lib/storage.ts:10` 用repo `.data/storage`；worker `apps/worker/src/storage.ts:6` 默认在apps/worker工作目录下算出同路径。应从其包目录执行，或显式FIKIRTIVE_DATA_DIR指向该repo绝对`.data/storage`；Web不读这个override，所以不能只给worker换一个路径。不要指向主检出或其他session的`.data`。
7. **入口使用已有未批准方案夹具，而非直接播种终态。** `e2e/support/seed.ts:450` 的 seedPlanCard创建GEN_CARD，含structuredPrompt、count=1、aspectRatio=1:1；复用seedWorkspace/seedThread/seedPlanCard及正常signIn，然后真实浏览器点击该卡Generate。不要用 seedApprovedPlanCard（:509）代替点击，那会跳过本次要验证的Web确认/排队。使用无参考图的单张图片，避免远端素材URL；不同唯一prompt保证成品哈希可区分。
8. **验证真正的下游证据。** worker `index.ts:169` 启pg-boss并创建/对齐真实队列；`jobs/gen.ts:2401` 调provider；:2463起写本地storage并在事务中创建Asset/Generation、更新GenJob并结算；:2625打印DONE via mock。以该夹具ID核一次job、一次reservation/settlement、generation/asset存在、local文件可访问，最终浏览器不刷新看见结果。退出时查本阶段无待处理作业，再停止自己启动的worker，不动别的进程。

可用一次性执行器导入上述现有helper并spawn现有worker命令；不需提交任何产品或harness文件。执行器自身不得伪造job完成/结算，所有结果由真实worker生成。

## 诚实边界与未覆盖项

- **自然语言→Otto→方案卡这一段无法靠generation mock覆盖。** `e2e/journeys/27-engine-a3-canvas-conversation.spec.ts`明确不按Send，因为那是独立的付费对话供应商；它使用seedPlanCard展示确认卡。本方案从既有夹具方案卡开始，不能称“从空白提示词完整走完Otto”。不为凑覆盖新增对话mock或伪造真实模型响应。
- MockProvider图片是离线纯色PNG；视频是内嵌1秒MP4，submitVideo/pollVideo下一次即成功（`packages/generation/src/index.ts:95–150`）。因此不能验证模型质量、供应商15分钟延迟/限流/真实回执/真实价格；本方案优先图片成功链路。
- MockProvider正常接口不会注入供应商失败，现成启动变量也没有“mock失败”模式。无新增测试代码/故障注入时，不能承诺在同一方案中覆盖provider失败退款；已有真实DB退款测试应独立标注，不能借作浏览器全链路证据。
- worker在test下的素材理解同样是MockUnderstandingProvider（`packages/generation/src/understanding.ts:398`）；它可能通过默认扫描为本地夹具记测试credits。要只验证图片生成，应使用仅本次必要夹具的干净库，并可用现有ASSET_UNDERSTANDING=off关闭非本项扫描；须在报告明示该开关，不能宣称理解链路也验证过。
- `e2e/global-setup.ts`只truncate public，不清pgboss schema。不能在曾由其他worker使用的库上盲跑globalSetup并认定所有旧queue payload已清；应核队列为空/只含本任务对象，或由跑道owner按既有流程准备全新独占本机库。

建议执行最小单张成功链路；将结果标成“真实应用全链路，供应商模拟，本地$0”。这补足了当前常驻套件不启动worker的缺口，但不能解除共享staging的存储权限问题，也不能替代预算内真实BytePlus验收。

CodeGraph: not used — worker独立worktree直接读当前文件；未执行任何可行性试跑。
