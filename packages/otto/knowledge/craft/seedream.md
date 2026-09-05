# 手艺 · Seedream（图片提示词）：t2i 还是 i2i、一句一要素、画面上的字

> **来源（本文不是新知识，是把现有的两处抄成一份可读的手艺文件）**
> - `packages/otto/src/instructions.ts` 的 "Craft the prompt with the model skill"、"When to call `propose`"、
>   "Attached reference image"、"Video keyframes" 四段；
> - `packages/otto/src/skills/seedream-prompt.ts`（skill description）与
>   `packages/otto/src/skills/seedream-prompt.helpers.ts`（装配器 `assembleSeedream`）；
> - 身份锁措辞与竖版防字幕句逐字来自 `packages/otto/src/skills/prompt-vocab.ts`。
> - **镜头运动／景别／布光的术语表不在本文** —— 唯一真相源是 `packages/otto/knowledge/craft/seedance.md` 的
>   「镜头术语表」一节，图片侧的 `cameraLens` 与 `lighting` 用同一份词。抄第二份就是给自己造一次失同步。
>
> **路径**：`docs/specs/otto-engine.md` §7.0 拍板一定案（取代 `docs/specs/creation-engine.md` §8.0 拍板三的占位路径 `packages/otto/craft/*.md`）。
>
> **两份并存是有期限的**：⑥段（技能文件柜替换单体，`docs/specs/otto-engine.md` §7.2⑥）退役 `instructions.ts` 单体时把本文收编进文件柜，
> 由生成器变成 build 期 TS 常量（§7.0 拍板三）。在那之前，**代码里的那几份仍是运行期权威**；两边冲突时以代码为准，并回来改本文。

## 一、先挑档（`mode`）

| 档 | 什么时候用 |
|---|---|
| `t2i`（默认） | 从零造一张图 |
| `i2i` | 商家挂了一张图，要在**那张图上**改（换背景、改颜色、去掉某个东西） |

判据是**商家要什么**，不是有没有挂图：
- 「把它动起来」→ 那是视频（挂的图成为首帧），不是 `i2i`。
- 「改这张图的某处」／「以它为底图」→ `i2i`。
- 「照它的风格另出一张」→ 仍是 `t2i` 那条路，在提示词里说明要离它多远。
- 只有**第一张**挂图会成为底图；挂了好几张就说清在改哪一张。
- 图片编辑目前一律返回方图 —— 商家挂的是竖图或横图就照实说。

## 二、一句一要素（不要逗号关键词串）

最前面的 token 权重最高，所以**主体永远是第一句**，然后逐条成句：

1. 主体（＋姿态／动作）
2. 环境
3. 观感一句：风格 + 光 + 色板（并成一句，别拆成三句标签）
4. 镜头（`shot with …`）
5. 情绪
6. 细节
7. 身份锁（每个 reference 一句，见下）
8. 画面上的字（如果商家点名要）

`i2i` 那条路的骨架是另一套：动词（Add／Remove／Replace／Change）+ 改什么 → 可选的重打光／重风格 → 身份锁 → **一句「其余全部不动」**。

## 三、画幅、清晰度、张数：一个都不写进提示词

商家点名的形状原样传给 `propose` 的 `desiredAspect`（**含菜单外的形状**），
菜单外由服务端在铸卡前拒绝、$0，不许替商家挑最接近的一格，也不许从「他说要发 story」反推一个竖版。
形状是唯一同时也要传给提示词的一项（`aspect`）：竖版会额外加一句 caption-free —— 竖版长「鬼字幕」的概率明显更高。

## 四、身份锁：靠名字，不靠编号

每个 `references` 条目按 role 生成一句：

- character → `keep <名字> identical to the reference, same face, hairstyle, and build`
- product → `feature <名字> exactly as in the reference, same shape, color, and label`
- location → `match the setting of <名字> to the reference environment`
- brandmark → `reproduce the <名字> logo exactly as in the reference, unaltered`
- 只借风格（`lock: false`）→ `draw stylistic inspiration from <名字>`

**永远不要自己写 `<Image_N>` 编号。** 编号由真正装那个数组的那段代码在发送时产出；
写提示词这一端根本没有编号所需的事实（哪个元素这一趟真有活参考照、商家有没有挂底图、这段提示词以后会被挂到哪个镜头上），
编错位比不编号更糟 —— 模型会照着编号去认人。
措辞只锁名字这一层，像素靠 `propose` 的 `entityIds` 走另一条路，两层缺一不可。

## 五、画面上的字

商家点名要印在画面上的字（≤60 字符）**逐字保留**（内部空白都不许归一），
写成 `Render the text "…" in bold sans-serif, placed prominently.`。
商家自己要了字，就不再加竖版防字幕那一句 —— 两句会打架。

## 六、给视频用的首帧（`forVideo: true`）

要出一条视频而首帧还不存在时，先用 `forVideo: true` 造首帧，提示词里额外要求：
主体周围留干净的空间、上方留出运动余量、保持单一主光方向。
首帧与视频是**一件事**：同一趟 `propose` 同时带上视频那一步的话与规格，
图出来之后视频的确认卡会自己出现 —— **永远不要**叫商家把图带回来、重新附加、或从头再来一次。

## 七、禁忌

- 不写逗号关键词串（官方指南点名的反例）。
- 不自己编图片编号。
- 不替商家换形状、换清晰度、换档位。
- 不在商家要了画面文字时再禁字幕。
- 不在 `i2i` 里重新描述整张照片 —— 写**要改什么**，其余一句「保持不变」。
