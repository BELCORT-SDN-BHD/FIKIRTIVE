# 手艺 · Seedance（视频提示词）：挑哪一档、怎么写一条片子、镜头术语表

> **来源（本文不是新知识，是把现有的两处抄成一份可读的手艺文件）**
> - `packages/otto/src/instructions.ts` 的 "Craft the prompt with the model skill"、"When to call `proposeStoryboard`"、"Attached clip — three different things they might want" 三段；
> - `packages/otto/src/skills/seedance-prompt.ts`（skill description，模型今天真正读到的那份）与
>   `packages/otto/src/skills/seedance-prompt.helpers.ts`（装配器）；
> - 术语表逐字来自 `packages/otto/src/skills/prompt-vocab.ts` 的 `CAMERA_MOVES` / `SHOT_SCALES` / `LIGHTING`
>   （取 `enOnly()` 之后的英文形态 —— 那正是喂给模型的那一份）。
>
> **路径**：`docs/specs/otto-engine.md` §7.0 拍板一定案（取代 `docs/specs/creation-engine.md` §8.0 拍板三的占位路径 `packages/otto/craft/*.md`）。
>
> **两份并存是有期限的**：⑥段（技能文件柜替换单体，`docs/specs/otto-engine.md` §7.2⑥）退役 `instructions.ts` 单体时把本文收编进文件柜，
> 由生成器变成 build 期 TS 常量（§7.0 拍板三）。在那之前，**代码里的那几份仍是运行期权威**，本文是给人读的同一份手艺；
> 两边冲突时以代码为准，并回来改本文。

## 一、先挑档（`mode`），挑错档等于烧一次付费请求

四档的分界不在措辞喜好上，在**引擎这一趟收到什么**：

| 档 | 什么时候用 | 引擎收到 |
|---|---|---|
| `i2v`（默认） | 有一张首帧要动起来 | 一张首帧图 |
| `t2v` | 从零起一条片子，手上没有首帧 | 什么都没有 |
| `edit` | 商家挂了**一整条自己的片子**，只想改里面某一处 | 那条片子 |
| `extend` | 商家挂了一整条片子，想把它接下去（或往前接） | 那条片子 |

- `edit` / `extend` 只接受**一个** shot —— 改一处、接一段，都是一件事，不是一个序列。
- 这两档里**永远不要写 "reference" 这个词**：它会让引擎去起一条新片子，而不是动商家那条。
- 商家挂了片子却想要**一条新的、只是感觉像**（"make one like this"）→ 那不是这两档，用 `t2v` 描述要借的动感与节奏。
- `extend` 可能被下架：可用与否的唯一权威是 `@fikirtive/core` 的下架名单（skill description 从能力表插值读它）。名单说关着，就照实说、不要写、不要承诺。

## 二、一条片子的骨架（从零那两档）

1. **画质基调一行**（`cinematic quality, natural motion, film-grade color, sharp focus`）先行，再进分镜。
2. **每个 shot 一个节拍**：主体 + 动作 + 情绪信号 + **恰好一个**镜头运动 + 一个景别 + 一句布光。一条片子最多 4 个节拍。
3. **技术参数一个都不写进提示词**：时长、清晰度、画幅、声音开关由系统作为顶层字段发送。画幅是唯一同时也要传给提示词的一项（`aspect`），因为竖版要额外一句防字幕。
4. **约束写成命令**，不是形容词堆；一句一条，用 `;` 分隔。例：`Keep the camera steady. Hold one continuous take. Avoid distorted hands and faces.`
5. **情绪外化**：不要写感受词，写镜头拍得到的身体信号（happy → 嘴角上扬、眼神放松、脚步变轻）。
6. **锁身份靠名字**（`references` 的 role + name），**编号永远不要自己写** —— 编号由真正装图片数组的那段代码在发送时产出。
7. **清底片**（从零那两档默认）：不要屏幕文字、水印、logo；商家自己锁了品牌标识时，禁的是字幕、不是那枚 logo。
8. **竖版**（9:16 / 3:4 / 4:5 / 2:3）额外再说一次不许烧录字幕，并点名 `【】` 这个字幕位符号。

## 三、声音符号

音乐 `（）`、音效 `<>`、台词 `{}`。字幕 `【】` **只作为禁令存在** —— 我们从不替商家要求烧录字幕。
台词保持商家要的那种语言。

## 四、一条 vs 一版分镜

同一条连续短片里的几个节拍 → 仍然是**一次** `propose`（最多 4 个 shot-as-beats）。
输出是商家要逐条审阅、逐条改的**分开的片子** → 才用 `proposeStoryboard`。

## 五、镜头术语表

> **机器可读，且是唯一真相源。** 本节由 `packages/otto/evals/checks/glossary.ts` 解析：
> 每个 `###` 小标题以 `<机器键> · <中文名>` 起头，每个条目是 `` - `术语` — 说明 ``（术语必须在反引号里、位于条目开头）。
> `docs/specs/otto-engine.md` §7.3 明写：Creation 的第四项机械检查（镜头词全部命中术语表）**从这里解析取词**，
> 不在 `checks/` 里抄第二份。要加一个术语，就在这里加一行。

### camera-move · 镜头运动（每个 shot 只用一个）

- `dolly in` — 推镜头，机身整体向主体推进。
- `pull out` — 拉镜头，机身整体后撤，交代环境。
- `pan` — 摇镜头，机位不动、水平转向。
- `tracking` — 跟拍，机身与主体同向同速移动。
- `orbit` — 环绕，绕着主体走一段弧。
- `aerial` — 航拍，高位俯瞰。
- `handheld follow` — 手持跟拍，带自然抖动的临场感。
- `crane up/down` — 升降，机身沿垂直方向移动。
- `fixed` — 固定机位，让动作自己发生。
- `one continuous take` — 一镜到底，中途不切。

### shot-framing · 景别

- `extreme wide` — 大远景，人在环境里很小。
- `wide` — 远景，人物全身加大量环境。
- `full` — 全景，人物顶天立地占满画面高度。
- `medium` — 中景，腰部以上。
- `medium close-up` — 中近景，胸部以上。
- `close-up` — 特写，脸或产品占满画面。
- `extreme close-up` — 大特写，眼睛、手、材质细节。

### lighting · 布光（永远给方向 + 色温，别写「漂亮的光」）

- `golden hour` — 日出后／日落前的低角度暖光。
- `dramatic side light` — 强侧光，明暗对比重。
- `soft diffused` — 柔和散射光，阴影很淡。
- `moody low-key` — 低调布光，大面积暗部。
- `bright high-key` — 高调布光，几乎无暗部。
- `studio soft box` — 影棚柔光箱，标准位在 45°。
- `backlight / rim` — 逆光／轮廓光，勾主体边缘。
- `neon` — 霓虹光，彩色实用光源。
- `volumetric` — 体积光，光束在空气里看得见。
- `natural window light` — 自然窗光，单一方向的日光。

## 六、禁忌（这几条是结构约束，不是风格建议）

- 不把时长／清晰度／画幅／声音写进提示词文本。
- 不自己编 `<Image_N>` / `<Video_N>` 编号。
- `edit` / `extend` 不写 "reference"、不写风格开场白、不写清底片指令、不写身份锁。
- 不主动要求字幕。
- 商家自己打的那句话（严格编辑的那一段）**一个字节都不许改写** —— 只在两端拼装官方句式。
