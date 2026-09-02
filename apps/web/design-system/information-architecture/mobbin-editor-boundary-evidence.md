# Mobbin evidence — Canvas 与 Video editor 边界

> 研究日期：2026-08-30。  
> 任务：决定旧 `/library/editor` 应继续存在，还是由 Canvas 成为 v1 唯一 creation workspace。  
> 状态：Evidence + approved direction；Founder 于 2026-08-30 选择 A。  
> 方法：使用 Mobbin MCP `search_flows` 检查 Runway 与 Canva 的 AI video generation / editing flows，并对照 Fikirtive 已冻结 Canvas spec 与当前 Video editor route。

## 1. Mobbin patterns

### Runway：生成与时间线合成是两个工作区

- [Editing a video with AI](https://mobbin.com/flows/49f22834-ba74-4397-a2ae-f0cdebe55da7)
- [Generating a green screen](https://mobbin.com/flows/fb81e2de-ce10-4b1d-a22b-9c859d5ff292)

Runway 的 generative session 以 prompt、reference、generation result 与 AI follow-up 为主；当任务进入多轨时间线、素材层、遮罩、effects 与 export 时，界面切换成另一套 editor workspace。两者通过生成结果衔接，但不是同一个 surface 强行承载全部工具。

### Canva：生成能力嵌在既有通用编辑器里

- [Creating a video](https://mobbin.com/flows/c9c2071b-13cd-4b00-8161-a8ddd39b1b32)
- [Generating a video](https://mobbin.com/flows/3fd996d1-165e-4db4-bc30-13d0c16287be)

Canva 从 template / design editor 起步；AI 生成只是 editor 内的 Magic Media 工具，生成结果直接成为页面或时间线上的元素。这个模型成立，是因为 Canva 的核心产品本来就是通用编辑器，而不是先有 agentic Canvas 再附加第二套编辑器。

## 2. Fikirtive current-state boundary

Fikirtive 已冻结的 Canvas spec 把 Canvas 定义为 image / video generation、selection、variation、object-level AI edit、export 与 share 的主要 creation workspace；同一 spec 明确把 `timeline editor` 与 `full pixel editor` 列为 non-goals。

当前 `/library/editor` 则使用 `EditDesk` 承担 splice、subtitles 与 music 等手动时间线任务。因此它不是 Canvas 的重复 route，而是一项尚未被 v1 产品方向确认的额外能力。

## 3. 可成立的两个 v1 方案

### A — Park standalone Video editor（已批准）

- Canvas 是 v1 唯一 creation / AI editing workspace。
- Library 只管理与复用 asset；不显示 `Editor` child。
- 旧 `/library/editor` implementation 保留但 parked，后续 implementation spec 再决定 redirect / hidden behavior，不在 IA 阶段删除 code。
- v1 不承诺手动 trim / splice / captions / music。

这个方案最符合当前已冻结 Canvas scope，也避免 Founder 同时学习 agentic Canvas 与传统 timeline editor 两套创作模型。

### B — Video editor 作为 selected video 的 specialized action

- Library 仍没有 `Editor` navigation child。
- 用户从一个 video asset 选择 `Edit video` 后进入独立 full-screen editor。
- Canvas 负责生成与 AI refinement；Video editor 只负责 trim / splice / captions / music；保存后回写同一个 Library asset lineage。

这个方案接近 Runway 的专业工作区分离，但只有在 v1 明确需要手动时间线编辑时才值得承担。

## 4. 不建议的方案

不要把完整 timeline 塞进 Canvas。它会直接改写已冻结 spec 的 non-goal，并把 Stitch-style agentic creation 与传统多轨编辑器混成一个复杂 surface。
