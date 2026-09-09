# 整数倍放大下限探针 · 2026-09-09（第三场）

`<probe>` = `/private/tmp/claude-501/-Users-winnin-Desktop-FIKIRTIVE--claude-worktrees-e2e-test-report-review-2bb00c/0319f1a3-d850-45f5-a21e-2ac03660fa39/scratchpad/probe`

## 1. 结论

**两档都收，出片可辨度都是「高」。** 但本场翻出一条比结论本身更硬的施工事实：**供应商的 300px 下限是宽与高「同时」成立**，不是只管宽。

| 档位 | 源 → 放大 | 收不收 | 出片可辨度 |
|---|---|---|---|
| T3 · AI 商品照（保温杯） | 1920×1920 → 200×200 → **2×** → 400×400 | **收**，`succeeded` | **高**：珊瑚色、锥形杯身、杯盖上那枚小掀盖片都在 |
| T4 · 真实鞋照（Nike） | 275×183 → 150×100 → 2× → 300×200 | **拒（零成本）** | — 高度 200 < 300 被前置尺寸闸弹回 |
| T4′ · 同一 150×100 源 | 150×100 → **3×** → 450×300 | **收**，`succeeded` | **高**：白鞋面／黑 Swoosh／橙中底楔块／白鞋带全在，中底还出了一行接近可读的字样 |

### 1.1 建议：自动放大的源宽下限 = **100px（且短边同样 ≥100px）**，用「放大到短边 ≥300px 的最小整数倍」

- 依据是本场实测的两个点：**150px 短边 100px 的真实低清网图**，3× 放大后出片仍然完全可辨；**200px 的 AI 商品照**，2× 放大后出片完全可辨。两档都没有出现「模型认不出这是什么」的失败。
- 所以真正卡人的不是画质，是**供应商那道 300px 硬闸**。自动放大要做的事只有一件：把短边推过 300。倍数取 `ceil(300 / min(w,h))`，用 lanczos。150×100 → 3×；200×200 → 2×；275×183 → 2×（上一场实证）。
- **短边低于 100px 才建议拦**（需要 4× 以上放大），理由不是实测（这一格没测）而是保守：放大倍数越高，模型拿到的有效信息越少，而我们只在 2×／3× 两格有证据。

### 1.2 一个反直觉的观察：源分辨率在这个区间几乎不影响出片质量

拿本场 T4′（源短边 **100px**）和上一场 T2（源短边 **183px**，同一张鞋照未先缩小）的 4s 帧并排看：**T4′ 反而更干净** —— Swoosh 边缘更利落，中底字样更接近可读；T2 那版 Swoosh 带一层灰色渐层、中底字是糊的。两者用的是同一提示词、同一模型、同一档位，只有 seed 不同（77940 vs 64113）。

结论：在 100–275px 这个源尺寸区间，**输出差异被模型自身的重绘随机性淹没了**，看不出单调的「源越小越差」。原因推断（置信度中，未实证）：模型本来就不是像素级复制参考图，而是「读出商品是什么，再按自己的先验重画一遍」——上一场已经写过「同款重绘不是像素复制」。既然是重绘，源图只要够模型认出品类、配色、大轮廓就够了，多出来的像素不产生额外保真度。

**这条观察有一个必须挂上的限制**：本场两件商品都是**模型先验极强**的东西 —— Nike 跑鞋是全球最被训练过的鞋型之一，纯色圆柱保温杯是最通用的商品形态。换成没名气的自有品牌商品（特殊 logo、特殊结构、特殊印花），源图信息不足时模型只能瞎编，那时源分辨率大概率会重新变得重要。**本场没有测这一格。**

## 2. 调用表

| 序 | 源尺寸 → 送模型尺寸 | 估价 USD | task id | 状态 | 错误码全文 |
|---|---|---|---|---|---|
| T3 | `product-mug.jpeg` 1920×1920 → lanczos 缩 200×200 → lanczos 2× → **400×400** | 0.176 | `cgt-20260909080706-xf2rn` | **succeeded**（≈15–30s，第 2 次轮询即终态） | 无 |
| T4 | `shoe-real.jpg` 275×183 → lanczos 缩 150×100 → lanczos 2× → **300×200** | 0（未建任务、零花费） | 无 | **建任务前被拒** | `arkruntime: API error: expected the height to be at least 300px, but received a 300x200px image instead Request id: 02178891244340039debe34dc0faea573b1e9db2da7e27b5f9ca9` |
| T4′ | 同一 150×100 源 → lanczos **3×** → **450×300** | 0.176 | `cgt-20260909080750-gz8cm` | **succeeded**（≈45–60s，第 4 次轮询） | 无 |

估价口径（每次调用前已写进 `<probe>/spend-log.txt`）：钉点 `video:seedance-2-mini:t2v-per-mtoken` $3.50/M（`packages/core/src/cost-pins.ts:81`，2026-09-09 逐字复查 `value: 3.5`）× 480p 最差比例 10,044 tok/s × 5s = 50,220 tok → $0.176。两次回执都是 `usage.total_tokens=50638`，与估算差 0.8%。

### 2.1 T4 被拒这一条要单独讲

任务书原设「150px 宽 2× 放大到 300px **刚好过门**」，建立在上一场只测出**宽度**闸的基础上。本次错误码逐字证伪了这个假设：**高度也有 300 的下限**。所以：

- 上一场报告第 6 节第 4 条「300px 是宽度下限，高度下限未知」**现已有答案：高度同样是 300**。
- 为仍能回答底层问题（150px 源经整数倍放大后可辨度如何），我改用同一 150×100 源作 **3× → 450×300**，这是两轴都过门的**最小整数倍**。这是我的判断，不是任务书原文，**标注为假设性调整**。
- 这次拒**不产生 task id、不产生 usage、零花费**，与人像审核拒是两类不同错误 —— 与上一场同一结论。

### 2.2 送模型的请求形状（脱敏原件 `<probe>/t3-request-redacted.json`、`t4-request-redacted.json`）

```json
{
  "model": "dreamina-seedance-2-0-mini-260615",
  "content": [
    {"type":"image_url","image_url":{"url":"<base64 A1-aisyah-closeup.jpg>"},"role":"reference_image"},
    {"type":"image_url","image_url":{"url":"<base64 t3-mug-400.jpg / t4-shoe-450.jpg>"},"role":"reference_image"},
    {"type":"text","text":"<上两场同一句提示词>"}
  ],
  "resolution": "480p", "duration": 5, "generate_audio": false, "watermark": false
}
```

提示词逐字：
- T3：`The woman holds the coral travel mug and smiles at the camera, soft studio light, static camera`
- T4／T4′：`The woman holds up the white running shoe with the orange sole to show it to the camera, smiling, soft studio light, static camera`

终态回执共同项（`t3-poll.json` / `t4-poll.json`，签名 URL 已替换）：`status=succeeded`、`model=dreamina-seedance-2-0-mini-260615`、`resolution=480p`、`ratio=9:16`、`duration=5`、`framespersecond=24`、`generate_audio=false`、`service_tier=default`、`usage.total_tokens=50638`、`content.video_url=<signed-download-url-redacted>`、`last_frame_url=""`、`file_url=""`。seed：T3=76590、T4′=64113。

认证状态（`arkcli auth status --format json`）：`auth_method=apikey`、`ark_api_key.key=ark-****9964`、`logged_in=true`（数据面可用）；`byteplus_sso.expired=true`、`control_plane_auth.status=needs_login`（`reason=refresh_failed`）。按指令**没有尝试登录**，故本场同样无法现查单价。

## 3. 产物与 sha256

| 文件 | 尺寸 / 字节 | sha256 |
|---|---|---|
| `<probe>/product-mug.jpeg`（未改动，上一场产物） | 1920×1920 / 124,216 | `9c9871dd39df368af641aa4cba9a30c0f98dc8699f641aa8b7f6fb290aa59d11` |
| `<probe>/t3-mug-200.jpg` | 200×200 / 2,825 | `2e8b7820693bb71ad29543f513aa96e7816362bc0cffd5053ac717c1246205f8` |
| `<probe>/t3-mug-400.jpg`（**T3 实际送模型**） | 400×400 / 5,684 | `45b667656c13b1ce552d228f9d423a9c339cf134d39a1e597b966e3b5164ad24` |
| `<probe>/shoe-real.jpg`（未改动，Founder 原件副本） | 275×183 / 8,727 | `aeec7af29430c715692a7fc40e11d12ecae4e978db0e607764ac09ef33ce48e2` |
| `<probe>/t4-shoe-150.jpg` | 150×100 / 6,963 | `edba0ae6ae9da252c3ae097dd935d9b4289cef8d9e6b2d1b6bdc4b04fb77d865` |
| `<probe>/t4-shoe-300.jpg`（被高度闸拒的那张） | 300×200 / 13,010 | `737cd5380dfbb50f3901c2748a5ebe38396b4982fcb1264b45f01fd3cb19ffd1` |
| `<probe>/t4-shoe-450.jpg`（**T4′ 实际送模型**） | 450×300 / 20,671 | `288608140982b42a7efbf01ef6991aa88288f016152a2c5318a8c0eacfb201c4` |
| 演员原图 `…/preserved/actor-library-v1-2026-08-30/A1-aisyah-closeup.jpg`（**未改动**） | 1536×2688 | `f31d4a36a58266c0508e72ba42b2d5f34aa62f742001f617f073e1a7dd240c76` |
| `<probe>/t3-mug-upscaled.mp4` | h264 496×864 / 121 帧 / `duration=5.041667`s / 1,380,241 | `2cd5a26e470e2e5d633a3d376b342b5b62d65621519ed1770cea6b3bd813325f` |
| `<probe>/t4-shoe-upscaled.mp4` | h264 496×864 / 121 帧 / `duration=5.041667`s / 1,481,417 | `42d3dbaa970c4f9d02e998ea737740030c5d71e4864ab5faf3dc313efd3baa20` |
| `<probe>/t3-frame-1s.png` `t3-frame-4s.png` `t4-frame-1s.png` `t4-frame-4s.png` | 抽帧 | — |
| `<probe>/t3-params.json` `t4-params.json` `*-create.json` `*-create.err` `*-poll.json` `*-request-redacted.json` `build_params.py` `poll.sh` `spend-log.txt` | 请求、回执、脚本、花费日志 | — |

### 3.1 看图结论

**先看送进去的图**（Read 逐张核对）：
- `t3-mug-400.jpg`：珊瑚色锥形保温杯，白底，杯盖上有一枚小掀盖片。因为是纯色简单形体，两次重采样几乎没有可见损伤 —— 边缘略软，其余完好。
- `t4-shoe-450.jpg`：能认出白灰鞋身、黑 Swoosh、橙中底、白袜与两条小腿、水泥地。但明显糊 —— 鞋面织纹全没了，中底字样成了一团灰笔画。

**T3 出片**（`t3-frame-1s.png`、`t3-frame-4s.png`）：
- 人物在，是 A1 Aisyah 本人（马来女性、沙米色 hijab、米白长袖、灰底棚拍），1s 帧含笑对镜、4s 帧大笑，两帧脸稳定不崩。
- **商品在，颜色与形状都认得出**：珊瑚色（与源图同色）、锥形杯身、**杯盖那枚小掀盖片被正确复现**——这是源图里唯一的结构细节，模型没漏。
- 与源图的差：视频里的杯子**比例更矮胖**（源图是细高杯），且下半截被手挡住，所以「矮胖」有一部分是遮挡造成的错觉。做广告足够，做「杯身高矮必须精确」的详情图不够。

**T4′ 出片**（`t4-frame-1s.png`、`t4-frame-4s.png`）：
- 人物同样稳定，动作按提示词把鞋举到胸前展示。
- **商品在，且逐项对得上**：白色织面鞋身、**黑色 Swoosh**、**橙色中底楔块**、白鞋带、鞋跟一小块黑；中底侧面还出了一行接近可读的字样与一枚小圆标。
- **真人身体被正确丢弃**：源照里的小腿、白袜、水泥地一样都没带进视频，只取了商品。与上一场同一表现。

**与上一场 550px 那格比**（`t2-frame-4s.png` 对 `t4-frame-4s.png`，同提示词同档位）：
- 细节**没有变差，甚至更好**。T2（源短边 183px）那版 Swoosh 带灰色渐层、中底字糊成一片；T4′（源短边 100px）那版 Swoosh 边缘干净、中底字更接近可读。
- 因此「源 550px vs 450px、源短边 183px vs 100px」这一档差异，**观察不到系统性的保真度下降**，差异落在 seed 造成的重绘随机性里。

## 4. 累计花费（牌价实收）

| 场次 | 内容 | USD |
|---|---|---|
| 第一场 | P1 图 + T1 视频 | 0.2122 |
| 第二场 | T2 真实鞋照（含一次零成本尺寸拒） | 0.1772 |
| **本场** | T3 `usage=50638` × $3.50/M | **0.1772** |
| **本场** | T4 高度闸拒（无 task id、无 usage） | **0.0000** |
| **本场** | T4′ `usage=50638` × $3.50/M | **0.1772** |
| **本场小计** | 付费视频调用 **2 / 2**（上限用满）；付费图片调用 **0 / 0** | **0.3544 / 上限 0.60** |
| **三场合计** | | **0.7438 / 总上限 3.00**，剩余 ≈ **2.26** |

按账号折后价 $1.40/M 记，本场 ≈ $0.1418，三场 ≈ $0.2975。按仓库钉点规矩（`cost-pins.ts` 注释「抄牌价不抄折后价」）以牌价为准。

## 5. 跑过的命令（脱敏；`arkcli` 每条都带 `env -u ANTHROPIC_BASE_URL` 与 `ARKCLI_NO_UPDATE_NOTIFIER=1 ARKCLI_CALLER_TYPE=ai_agent ARKCLI_CALLER_NAME=claude-code ARKCLI_SKILL_NAME=arkcli-gen`）

```
arkcli auth status --format json

ffmpeg -y -i product-mug.jpeg -vf "scale=200:-2:flags=lanczos" -q:v 2 t3-mug-200.jpg
ffmpeg -y -i t3-mug-200.jpg   -vf "scale=400:-2:flags=lanczos" -q:v 2 t3-mug-400.jpg
ffmpeg -y -i shoe-real.jpg    -vf "scale=150:-2:flags=lanczos" -q:v 2 t4-shoe-150.jpg
ffmpeg -y -i t4-shoe-150.jpg  -vf "scale=300:-2:flags=lanczos" -q:v 2 t4-shoe-300.jpg   # 被高度闸拒
ffmpeg -y -i t4-shoe-150.jpg  -vf "scale=450:-2:flags=lanczos" -q:v 2 t4-shoe-450.jpg   # 改投用这张
sips -g pixelWidth -g pixelHeight / file / shasum -a 256 / stat -f%z

python3 build_params.py t3 t3-mug-400.jpg "<mug prompt>" "<note>"    # 本地 base64 打包 + 同时落脱敏副本
python3 build_params.py t4 t4-shoe-300.jpg "<shoe prompt>" "<note>"
python3 build_params.py t4 t4-shoe-450.jpg "<shoe prompt>" "<note>"

arkcli api arkruntime.create_content_generation_task --params "$(cat t3-params.json)" --format json   # → cgt-20260909080706-xf2rn
arkcli api arkruntime.create_content_generation_task --params "$(cat t4-params.json)" --format json   # ×2:300x200 高度拒;450x300 → cgt-20260909080750-gz8cm
arkcli api arkruntime.get_content_generation_task --params '{"id":"<task id>"}' --format json          # 轮询,间隔 15s(T3 ×2,T4' ×4)

python3（读回执→抽出签名 URL 到临时文件→把 video_url/last_frame_url/file_url 就地替换为占位串→回写 *-poll.json）
curl -sS -o t3-mug-upscaled.mp4 "<presigned TOS url>" ; rm -f *-url.tmp   # T4' 同
ffprobe -show_entries format=size -show_entries stream=width,height,nb_frames,codec_name,duration
ffmpeg -ss 1 / -ss 4 -frames:v 1 → t3/t4-frame-1s.png / -4s.png

grep -rn 'X-Tos' <probe>                                            # 只命中上一场报告里描述脱敏动作的散文,无真 URL
grep -rlnE 'https?://[^"]*(Signature|X-Tos|Credential|Expires)' --include='*.json' <probe>   # exit=1(空)
```

脱敏动作：回执落盘后立刻把签名 URL 抽到临时文件供 `curl` 用，随即在 JSON 里替换为 `<signed-download-url-redacted>` 并 `rm` 临时文件。最终两道扫描都干净。

未做：没有登录控制面、没有打印或搬动任何 key、没有碰 staging／production、没有改仓库文件、没有跑 codegraph、没有改动演员原图与 Founder 原件。

## 6. 我不确定的地方

1. **T4 没能按任务书原设跑。** 任务书要的是「150px → 2× → 300px 刚好过门」，实际这一投被高度闸拒（零成本）。真正跑成的是 3× → 450×300。所以「2× 放大是否够」这个问法在 T4 这一格**没有直接答案** —— 有答案的是「同一 150×100 源，整数倍放大到过门后可辨度高」。T3 那格是货真价实的 2×。
2. **300px 闸的完整形状仍未穷尽。** 已实证：宽 <300 拒（上一场 275×183）、高 <300 拒（本场 300×200）。**未实证**：有没有上限、有没有面积或长宽比的额外约束、`first_frame`／`last_frame` 角色是否同一套阈值（本场只测 `reference_image`）。
3. **只有两件商品、两个样本、一个模型档位。** 且两件都是模型先验极强的形态（Nike 跑鞋、纯色圆柱杯）。**无名自有品牌商品（特殊 logo／印花／结构）在低源分辨率下会不会被模型瞎编**，本场完全没测 —— 这是 1.2 那条观察最大的适用边界，也是我认为下一场最值得花钱的一格。
4. **「可辨度高」是我肉眼判定，不是量化指标。** 没有做与源图的结构相似度测量，也没有让第二个人复核。上一场已写过的「同款重绘不是像素复制」在本场同样成立：中底文字、织纹这类细节都是模型编的。
5. **单价仍是钉点，不是现查。** 控制面 SSO `needs_login`（`reason=refresh_failed`），按指令未登录，`arkcli pricing` 用不了。估价源＝`packages/core/src/cost-pins.ts:81`，今天逐字复查了常量值 `3.5`，但**没有向供应商复查牌价本身**。
6. **我方代码是否已有前置尺寸校验／放大逻辑，只做了浅查。** 在 `packages/generation/src` 与 `apps/web/src` 里按 `lanczos|upscale|minWidth|min_width|at least 300|pixelWidth` 逐词 grep，**零命中**（2026-09-09 跑，命令见第 5 节）。这只能说明**没有以这些关键词命名的实现**，不能证明完全没有校验（可能叫别的名字、或在别的包里）。施工前值得由懂这块的人正式确认一遍。
7. **一次成功不等于稳定通过。** 与前两场同一句提醒：审核闸有随机性与版本漂移。本结论限定在 2026-09-09、`dreamina-seedance-2-0-mini-260615`、480p、`reference_image` 双图这一格。
