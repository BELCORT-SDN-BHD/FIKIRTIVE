# Founder 自己画布：后端只读取证（2026-09-14）

## 范围与方式

目标 Project `canvas_dad82159-06c9-46e1-b3fa-709bb39624a9`，DB name=`Hi!`，DB核实 ownerId=`founder`。Thread=`thread_dad82159-06c9-46e1-b3fa-709bb39624a9`，DB title=`Cat drinking coffee video`。不是先前R3虚构租户。

Railway CLI每次显式 project=`b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d` / environment=`staging` / service=`Postgres`；仅内存取连接信息。每条SQL包在 BEGIN READ ONLY / ROLLBACK 中。先仅按精确Project ID取owner，再用owner+project/thread约束后续查询。没有邮箱、登录资料、cookie、签名URL，没有写库或调用生成。相关schema直接读主检出当前文件；CodeGraph: not used — worker直接文件读取。读取BLUEPRINT和CONTEXT；本次不修改产品、审批或规则。

脱敏完整项目证据：`evidence.json`。最小最新卡片/trace/工具暂停状态：`latest-repro-evidence.json`。未保留完整Otto状态上下文。

## 最新“说生成但卡不出来”：可证明事实

- 05:49:44.147 UTC，seq39产生 STORYBOARD_CARD `01M2F7DPAH7VZQYX722SCWK9JX`，两镜10s+5s；trace有seedancePrompt两次成功、proposeStoryboard一次成功。画布Project的Shot表当前0行；payload shotId不等于Shot已经写入。
- seq40：“There's your storyboard! 🎬😂 Two shots, 15 seconds total. Review each shot on the card above — you can tweak anything before approving them to generate. 🐾”
- 05:53:25.629 seq41用户“?”；seq42说应该可见并复述两镜；这轮trace零工具。
- 05:53:50.716 seq43用户“can, just do it stragiht away, no need starting image”。05:53:54.968 seq44：“Got it! Let me generate both shots straight away! 🎬”
- 05:54:26.400 seq45用户“where is the card?”。05:54:32.759 seq46：“Sorry! Let me call up the generate cards for both shots now.”
- 最后两轮trace都是steps=1、truncated=false、generate calls=1/ok=0/failed=0。这不是已执行成功，也不是已执行失败；runtime.ts:350–365将tool_call_item记calls，将tool_call_output_item结果才记ok/failed。
- 当前ottoState.generatedItems含 `tool_call_item` 及 `tool_approval_item`；latest generate.arguments=`{"cardId":"01M2F7DPAH7VZQYX722SCWK9JX"}`。也就是把**分镜卡ID**交给说明要求**GEN_CARD ID**的generate，并停在approval项；未见tool输出。latest说明文字及原始必要item保存在最小证据中。前一轮的完整参数未在当前state.originalInput中保留，不能强称两轮参数一致。
- DB当前46条ChatMessage（seq1–46）。最后GEN_CARD为seq35；最后GenJob于05:44创建；之后只有分镜卡与文字，没有两张新增GEN_CARD或两镜生成作业。UI“52”不能直接当丢了6条：可能计数口径不同，须前端核对。

## 原图、演员、首帧实际走向

UTC时间；马来西亚时间加8小时。

1. 09-12 seq5用户引用橙色杯图片Generation `01M288SEY839N8CW8XTXBJG077`。seq10 cat-only图片卡、实际job `01M2A3BYKQ797E3NQXFDJHVBGA` sourceGenerationId=null、entityIds=[]；产出cat+mug `01M2A3CX6K9AWV6ZV1PBED34JX`。说明原杯被描述后没有作为此生成的实际输入绑定。未跨出项目取原杯源记录。
2. 09-12 06:03:18.893 video job `01M2A3D3Z2NZEE3M22B9J524CG` sourceGenerationId=cat+mug；5s，DONE，产出 `01M2A3FZJNH16QJAVFZWR0A3FE`。这里有真实首帧绑定。
3. 09-14 05:36:58用户“now i wan @Xinyi hold the cat and pet it while the cat is drinking with the product”。05:37:36图片job `01M2F6QF8CEP5QVSFRFD6AATZB` sourceGenerationId=null、entityIds只有Xinyi `01M265PRD50HWEKX2VFGBCF31Y`，没有cat+mug输入；05:38:28产出 `01M2F6S20KRZX47BM7CC48HA5Z`。用户05:39:11反馈“the cat and the product is wrong from the original”。数据证明参考绑定丢失；视觉相似程度由前端图像检查判。
4. 用户重附原cat+mug后，05:40:08图片job `01M2F6W4ECZQG835TJNXS7TN3E` 同时sourceGenerationId=原cat+mug + entityIds=Xinyi，05:40:53产出修订图 `01M2F6XFRQ0YVS45ZJ8C8YFATH`。sentPromptText真实回执开头明确：`<Image_1> is the image being edited. Define the person in <Image_2> as <Subject_2>: Xinyi. <Image_3> is another photo of <Subject_2> (Xinyi).` 生成entitySnapshot也有Xinyi两张refHashes。
5. 用户只要15s（seq27），seq28又提出image+videoStep（未批准，无job），且卡sourceGenerationId缺失。用户随后明确“just use @Add Xinyi… as the first frame”。seq31却把该图标为mediaReferences.role=`reference`，放在referenceGenerationIds；同时文字seq32称“using your image as the first frame”。实际05:42:34 job `01M2F70JKNT4TN51J668A7DANF` sourceGenerationId=null、videoOptions.referenceGenerationIds=[修订图]、entityIds=Xinyi。05:42:39 FAILED、spent=false，错误：“This picture can't be used as the person in a clip. Send the cast member and your product as references instead, and the clip is made from your description. You weren't charged.” 因此明确的**用户首帧意图／卡角色／叙述三者冲突**；不是provider实际收到了首帧的证据。
6. 05:43:26用户明确“no need start frame, straight away use @Xinyi and @An adorable fluffy cat…”。seq35 video card正确role=reference；05:44:00 job `01M2F736BR2VBJEJ8H1SV73F5X` sourceGenerationId=null、tailGenerationId=null、entityIds=Xinyi、videoOptions.referenceGenerationIds=[原cat+mug]，15s/720p/9:16/audio=true。05:47:59 DONE，生成 `01M2F7AFBM5ZF2GYDQ0QA4FKX6`，billedUnits324900，spent=true。**这一实际样本证明“演员+商品参考直接生成视频，无首帧”路径当时可用。**不能据此声称全部入口的修复已部署完毕或最新分镜路径可用。

## 金钱与数量

限定这个Project的6个GenJob + 这个Thread15个OttoTurnTrace.refId：42条CreditLedger。5个生成成功、1个失败；3图+2视频；6个CanvasNode（5done、1deleted，对应失败视频）。无在途GenJob。

- 生成净扣470 internal credits = 47显示credits。3图片各10internal、5s视频110、15s视频330。failed视频reserve330后refund330，净0，reservedDelta归零。
- 15轮Otto净扣252internal =25.2显示credits。
- 总净扣722internal =72.2显示credits；总reservedDelta=0。换算来自packages/core/src/spend.ts:90（INTERNAL_PER_DISPLAY=10）。不是把provider成本当客户扣费。
- 最新问号／要求执行／追问卡片三轮分别扣10、9、6internal，合计25internal（2.5显示credits），没有新媒体生成。
- 此6个job的spentUsd是供应商成本快照，成功合计1.62652875 USD，与商家账本不同口径。
- 未发现此范围重复RESERVE或重复SETTLE；这不外推全账号，也不声称其他项目零花费。

## 未知／交给代码与UI检查

当前证据最强指向：分镜卡被送进只接受生成卡的批准通道，停在批准item且对话只落了允诺文字。前端怎样展示pendingCardIds、是否过滤STORYBOARD_CARD、为什么模型选择generate，需跟对应部署版本代码连接验证。不能把calls1/ok0直接叫服务失败，也不能说后台还在生成。

演员复合图被拒的具体provider错误码、真实HTTP输入role与校验位置未查worker日志；这里只有持久化规范化错误。首次Xinyi缺cat+mug参考已由job可证，但是否上下文折叠导致模型漏参仍未知。所有日期为DB原始UTC。
