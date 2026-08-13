-- 图片回执补根(#914 r2,判官 r1 P1)。两列,都可空,无默认值,无约束,无索引,无回填。零破坏。
--
-- r1 在「Sent to the engine」这一块恒定声明 "Sent exactly as you wrote it." —— 判官指出这不实:
-- 官方契约只证明「引擎不回报改写」,不证明「引擎不改写」,而且我们自己的 composePrompt 拼装
-- 步骤（apps/web/lib/cowork-actions.ts 的 coworkGenerate，只在未配专属提示词技能的模型家族上
-- 跑）确实会在商家批准的那句后面追加一段家族×模式指令词再送去引擎 —— 这一步我们自己完全控制,
-- 此前却没有落库,商家因此看不出这一单是不是真的「原样送出」。
--
-- 这次迁移把「商家批准的那一句」补成事实:
--   · "GenJob"."requestedPrompt"     —— coworkGenerate 拼装前的那句，只在真的拼装出了不同
--     结果时才写；商家批准的那句仍在 "GenJob"."prompt"（拼装之后，worker 真正送给引擎的
--     那一句），两句分开存，永不互相冒充。
--   · "Generation"."requestedPromptText" —— worker 把上面那一列原样抄到产出行上，与既有的
--     "Generation"."promptText" / "finalPromptText" 同一张表、同一套白名单纪律。
-- reserve / settle / refund 的权威、幂等键、以及 CreditLedger 一个字节都没动；这两列也绝不
-- 参与任何 spend 判定或 factoryMaterialMatches 重放比对。
--
-- 为什么零破坏：
--   ① ADD COLUMN ... NULL(无默认值)不重写既有行、不长时间持锁；
--   ② 现有行保持 NULL，而 NULL 的语义**就是**「这一单没有可分家的两句话」——对绝大多数
--      既有行（直接走 composer、走 Otto 对话 generate 技能、或拼装本来就没变化）这就是真相,
--      读取端把 null 当 promptText 本身用即可，不需要回填，也**不许**回填：回填只会把一个
--      推断值写成看起来像事实的东西；
--   ③ 不删列、不改列型、不加约束、不加索引 —— 没有任何数据丢失级 DDL。

ALTER TABLE "GenJob" ADD COLUMN "requestedPrompt" TEXT;
ALTER TABLE "Generation" ADD COLUMN "requestedPromptText" TEXT;
