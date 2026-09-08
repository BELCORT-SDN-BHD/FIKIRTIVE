# 真实照片作参考图探针 · 2026-09-08（第二场）

`<probe>` = `/private/tmp/claude-501/-Users-winnin-Desktop-FIKIRTIVE--claude-worktrees-e2e-test-report-review-2bb00c/0319f1a3-d850-45f5-a21e-2ac03660fa39/scratchpad/probe`

## 1. 结论

**收。** Founder 提供的真实鞋照（Nike 跑鞋穿在真人脚上，画面有真人小腿与袜子、无脸）作 `role="reference_image"`，与演员原图（Seedream 纯文生）一起直喂 `dreamina-seedance-2-0-mini-260615`，**供应商接收并出片成功**，没有出现 `InputImageSensitiveContentDetected.PrivacyInformation`，也没有出现 `may contain real person`。

- 因为是「收」，问题的后半段（拒的是身体还是照片本身）**不适用**；T3 裁剪臂按预案不跑。
- 置信度：**中高**。一次真实付费调用建任务成功并跑到 `succeeded`（`cgt-20260908184304-7x42n`），产物已下载、抽帧肉眼核对；但只有一次样本、一张真实照片、一个模型档位，审核闸有随机性与版本漂移的可能。

**一个必须知道的附带发现（对施工影响比结论本身还大）**：供应商在**建任务之前**有一道**尺寸硬闸** —— 参考图宽度 **至少 300px**。Founder 那张原图是 275×183，第一次提交被逐字拒：

```
arkruntime: API error: expected the width to be at least 300px, but received a 275x183px image instead
Request id: 021788864152659fdccfc102ca12157f94275e78054dc3baee6f5
```

这次拒**不产生 task id、不产生 usage、零花费**，与人像审核拒是**两类不同的错误**。我们代码今天没有这条前置校验（未核实是否有 —— 我没有为此翻代码），商家上传小图会在付费前撞上它。放大到 550×366（ffmpeg lanczos 2×）后同样的组合就过了。

## 2. 调用表

| 序 | 组合 | 估价 USD | task id | 状态 | 错误码原文 |
|---|---|---|---|---|---|
| T2-a | `content=[reference_image 演员原图, reference_image shoe-real.jpg(275×183 原件), text]`，480p/5s/`generate_audio=false`/`watermark=false` | 0（未建任务） | 无 | **建任务前被拒** | `arkruntime: API error: expected the width to be at least 300px, but received a 275x183px image instead Request id: 021788864152659fdccfc102ca12157f94275e78054dc3baee6f5` |
| T2-b | 同上，鞋照换成 `shoe-real-2x.jpg`（550×366，lanczos 2× 放大） | 0.176（钉点 `video:seedance-2-mini:t2v-per-mtoken` $3.50/M × 480p 最差比例 10,044 tok/s × 5s = 50,220 tok） | `cgt-20260908184304-7x42n` | **succeeded**（约 75–90 秒，6 次轮询每次 15s） | 无 |
| T3 | 纯商品裁剪臂 | 0 | — | **未跑** | 触发条件（T2 被拒且错误码指向人像）未成立 |

请求形状脱敏原件：`<probe>/t2-request-redacted.json`

```json
{
  "model": "dreamina-seedance-2-0-mini-260615",
  "content": [
    {"type":"image_url","image_url":{"url":"<base64 A1-aisyah-closeup.jpg>"},"role":"reference_image"},
    {"type":"image_url","image_url":{"url":"<base64 shoe-real-2x.jpg (Founder 真实鞋照 275x183 经 ffmpeg lanczos 2x 放大至 550x366;无脸,含真人小腿与袜子)>"},"role":"reference_image"},
    {"type":"text","text":"The woman holds up the white running shoe with the orange sole to show it to the camera, smiling, soft studio light, static camera"}
  ],
  "resolution": "480p", "duration": 5, "generate_audio": false, "watermark": false
}
```

终态回执（`<probe>/t2-poll.json` 逐字节选，签名 URL 已替换）：`status=succeeded`、`model=dreamina-seedance-2-0-mini-260615`、`resolution=480p`、`ratio=9:16`、`duration=5`、`framespersecond=24`、`generate_audio=false`、`seed=77940`、`service_tier=default`、`usage.total_tokens=50638`、`content.video_url=<signed-download-url-redacted>`、`last_frame_url=""`、`file_url=""`。

认证状态（`arkcli auth status --format json`）：`auth_method=apikey`、`ark_api_key.key=ark-****9964`、`logged_in=true`（数据面可用）；`byteplus_sso.expired=true`、`control_plane_auth.status=needs_login`（控制面 SSO 仍过期，按指令**没有尝试登录**，故本场同样无法现查单价）。

## 3. 产物与 sha256

| 文件 | sha256 | 说明 |
|---|---|---|
| `/Users/winnin/Desktop/shoe.jpg`（未改动） | `aeec7af29430c715692a7fc40e11d12ecae4e978db0e607764ac09ef33ce48e2` | Founder 原件，桌面原位未动 |
| `<probe>/shoe-real.jpg` | `aeec7af29430c715692a7fc40e11d12ecae4e978db0e607764ac09ef33ce48e2` | 逐字节副本（同 hash）。`file`：JPEG baseline，**275×183**，8,727 bytes。Read 看图确认：白灰配色 Nike 跑鞋穿在真人脚上，橙色中底，白袜，可见两条小腿与皮肤，**画面无脸** |
| `<probe>/shoe-real-2x.jpg` | `169a9f0eaf2c460b57915bcddbe77b1038f7de8fe384d0b444a331e691cb6f36` | ffmpeg `scale=550:366:flags=lanczos -q:v 2`，550×366，35,364 bytes。实际送进模型的就是这一张 |
| `/Users/winnin/.claude/projects/-Users-winnin-Desktop-FIKIRTIVE/preserved/actor-library-v1-2026-08-30/A1-aisyah-closeup.jpg` | `f31d4a36a58266c0508e72ba42b2d5f34aa62f742001f617f073e1a7dd240c76` | 演员原图（1536×2688），与任务书给的 `f31d4a36…` 一致 |
| `<probe>/t2-real-shoe.mp4` | `37a4bd0ec0104ec44137271db314974d35f30a597f0c859bee50544122e3db05` | T2 产物，1,521,047 bytes；ffprobe：h264、496×864、121 帧、`duration=5.041667`s |
| `<probe>/t2-frame-1s.png` / `t2-frame-4s.png` | — | 抽帧 |
| `<probe>/t2-request-redacted.json` / `t2-create.json` / `t2-create.err` / `t2-poll.json` / `spend-log.txt` | — | 脱敏请求、建任务回执、尺寸拒原文、终态回执、花费日志 |

### 看图结论（`t2-frame-1s.png`、`t2-frame-4s.png`）

- **人物在**：A1 Aisyah 本人 —— 马来女性、沙米色 hijab、米白长袖上衣、灰底棚拍，与演员卡面一致；1s 帧对镜微笑，4s 帧低头看鞋。两帧脸都稳定，没有崩脸。
- **鞋在，且是那双鞋**：白色织面鞋身、**黑色 Swoosh**、**橙色中底楔块**、白鞋带、中底侧面有细字与右侧一枚小圆标 —— 与源照的白/灰鞋身＋黑勾＋橙底逐项对得上。
- **保真度：主特征保真，细节是「同款重绘」不是像素复制。** 源照是 275×183 的低清网图，模型输出的是一双**新画的**同型号鞋：颜色分区（白身／黑勾／橙底）和大轮廓忠实；但中底文字不可辨、鞋头织纹与源照的灰蓝渐层被洗成更纯的白，源照里的 `ZOOM X` 之类字样在视频里成了模糊笔画。做商品广告够用，做「款式细节必须一模一样」的电商详情图不够。
- **真人身体被正确丢弃**：源照里的小腿、袜子、水泥地全部没有带进视频；模型只取了商品，鞋被拿在手上展示，符合提示词。

## 4. 花费

| 项 | 牌价实收 USD |
|---|---|
| 上一场（P1 图 + T1 视频） | 0.2122 |
| 本场 T2-a（尺寸拒，未建任务） | 0.0000 |
| 本场 T2-b（`usage.total_tokens=50638` × $3.50/M） | 0.1772 |
| **两场合计** | **0.3894** |

- 本次分配上限 $0.60 → 用掉 **$0.1772**，付费视频调用 **1 / 2**，付费图片调用 **0 / 0**。
- Founder 已批总额 $3.00 → 剩余 **≈ $2.61**。
- 若按账号折后价 $1.40/M 记，本场 ≈ $0.0709，两场 ≈ $0.156。按仓库钉点规矩（`cost-pins.ts:81` 注释「抄牌价不抄折后价」）以牌价为准。

## 5. 跑过的命令（脱敏；`arkcli` 每条都带 `env -u ANTHROPIC_BASE_URL` 与 `ARKCLI_NO_UPDATE_NOTIFIER=1 ARKCLI_CALLER_TYPE=ai_agent ARKCLI_CALLER_NAME=claude-code ARKCLI_SKILL_NAME=<skill>`）

```
arkcli auth status --format json                                   # skill=arkcli-gen
arkcli api arkruntime.create_content_generation_task --params "$(cat <probe>/t2-params.json)" --format json   # ×2:第一次 275x183 被尺寸拒;第二次 550x366 建任务成功
arkcli api arkruntime.get_content_generation_task --params '{"id":"cgt-20260908184304-7x42n"}' --format json  # ×6,间隔 15s
cp /Users/winnin/Desktop/shoe.jpg <probe>/shoe-real.jpg
shasum -a 256 / file / sips -g pixelWidth -g pixelHeight
ffmpeg -i <probe>/shoe-real.jpg -vf "scale=550:366:flags=lanczos" -q:v 2 <probe>/shoe-real-2x.jpg
curl -sS -o <probe>/t2-real-shoe.mp4 "<presigned TOS url>"
ffprobe -show_entries format=duration,size -show_entries stream=width,height,nb_frames,codec_name
ffmpeg -ss 1 / -ss 4 -frames:v 1 → t2-frame-1s.png / t2-frame-4s.png
python3（本地 base64 打包请求、脱敏落盘）
grep -rn 'X-Tos' <probe>   # 最终 exit=1(空)
```

脱敏动作说明：`t2-poll.json`／`t2-create.json` 落盘后即把 `X-Tos-*` 签名 URL 替换成 `<signed-download-url-redacted>`。首轮 `grep -rn 'X-Tos'` 还命中了**上一场遗留**的 `t1-poll.json` 与 `p1-image.json`，一并作了同样替换（那两个产物早已下载完毕，替换不损失任何东西），复查 `grep -rn 'X-Tos' <probe>` 已为空。

未做：没有登录控制面、没有打印或搬动任何 key、没有碰 staging／production、没有改仓库文件、没有跑 codegraph、没有改动桌面原件。

## 6. 我不确定的地方

1. **原件没能按原样验。** Founder 那张 275×183 的原件**从未真正进过视频引擎的审核闸** —— 它在更前面的尺寸校验就被弹回来了。真正被审核的是 lanczos 2× 放大件。放大是**保内容的重采样**（没有裁剪、没有换构图、没有改语义），按 2026-08-30 pixel-integrity 的机制（信任标记在 AI 生成图的像素里）推断，真实照片本来就没有 AI 溯源标记可破坏，放大不该改变判定；**但这是推断，不是实测**。
2. **只有一个样本、一张照片。** 这张照片虽有真人小腿与皮肤，但**面积小、无脸、无正脸特征**。「真人身体面积更大」（半身出镜、手部大特写握产品、镜面反射带脸）会不会翻转判定，**未实测**。今天只能说：这一格收。
3. **单价仍是钉点，不是现查。** 控制面 SSO 过期（`control_plane_auth.status=needs_login`），按指令没登录，`arkcli pricing models` 用不了。估价源＝仓库钉点 `packages/core/src/cost-pins.ts:81`（2026-08-29 实查牌价 $3.50/M），今天逐字复查了这个常量值，但**没有向供应商复查牌价本身**。回执 `usage.total_tokens=50638` 与估算的 50,220 差 0.8%，口径互证。
4. **300px 是宽度下限，高度下限未知。** 错误文案只提了宽度。我直接放大到 550×366（两边都过 300），所以**高度是否也有 300 的闸、以及有没有上限**，未核实。
5. **一次成功不等于稳定通过。** 与上一场同一句提醒：审核闸有随机性与版本漂移。本结论是 2026-09-08、`dreamina-seedance-2-0-mini-260615`、480p、`reference_image` 双图这一格的单次实测。
6. **我方代码是否已有前置尺寸校验，本场没查。** 我按「不改仓库文件、只做探针」的边界跑，没有翻 `packages/generation` 或上传路径去确认商家上传小图会不会撞上这道供应商闸。这是施工侧值得单独确认的一条。
