# Founder 录屏分析:IDEA FOR CANVA SECTION.mov(2026-08-19,3:12,96 帧全览)

## 视频内容纪实

Founder 在 stitch.withgoogle.com 上从零走了一遍完整流程:

1. **Stitch 首页**(f001):左侧项目列表(My projects / Shared with me + 搜索 + Recent),主区大标题 + 大输入框(App/Web 切换、模型选择、示例 chips、灵感画廊)。Founder 的 Stitch 账号里已有项目「Fikirtive Dashboard Interface」(Aug 19, 2026)。
2. **进入新项目**(f004-f016):整页即画布(深底点阵),四个常驻件:
   - **左上:浮动聊天气泡**——可展开成对话卡(显示 AI 回复全文),可收成小胶囊(``…``);流式输出时显示 Thinking…;工作时逐条列 agent 步骤(Extracting text from page / Extracting brand assets / Building the design system)带勾。
   - **左下:Agent log**——所有 prompt 的队列,每条带状态(spinner=进行中可点 X 取消,勾=完成),可折叠。
   - **底部居中:输入框(omnibox)**——placeholder "What would you like to change or create?",带 +(附件)、/(命令)、主题、模型选择(3 Flash / Thinking with 3.1 Pro / Redesign with Nano Banana Pro+截图)、语音、发送。
   - **右侧:垂直工具条**——光标选择 / 框选 / 附件 / 手掌平移 / 插图片 / 主题 / 收藏星。
   - 右下:undo/redo + 缩放百分比;顶栏:汉堡 + 项目名 + Export + Share。
3. **附件与上下文**(f022-f088):粘贴 GitHub URL → 变成 chip;macOS 文件选择器可直接附本地文件。发送后 Stitch 研究 URL,把「提取的网页文本」作为一个 artifact 卡放上画布(带 star/👍/👎 hover 操作),边研究边在聊天气泡里讲人话("I'm researching FIKIRTIVE on GitHub… I'll then create a design system and a dashboard…")。
4. **Founder 的原话 prompt**(f073 定格):
   > "sooo i am interested in generate a dashboard for my APP FIKIRTIVE, can you create a stitch like canva stuff for, my canva section, but tweaked for my app FIKIRTIVE. for the other section than Canva creation section, do for general design like sidekick from shopify"
5. **Stitch 自己规划的结构**(f091):"…design the Dashboard, the 'Fikirtive Canvas' (your Canva-like section for ad creation), and the 'Otto Sidekick' panel for AI-driven insights." 录屏在生成完成前结束——**重点是交互模型,不是生成结果**。
6. 轮播 tips 值得抄:⌘K command panel;Select multiple screens to edit together;Select [3x] to generate multiple design options;Format menu 自动排列 screens;Upload reference images to guide your design;多屏 stitch 成 Prototype。
7. 片尾(f094)Founder 短暂切到 LottieFiles/motion-design-skill 的 GitHub 页——动效意识在场。

## 提炼:FIKIRTIVE Canvas section 的交互语法(Stitch 模式移植)

- 进入 canvas section = **整页工作区**(脱离 dashboard 壳),商家的一个 project = 一张无限画布。
- 画布上的一等公民:生成的 image/video/文档/研究结果都是 **artifact 卡**,可选中、被引用、被迭代;hover 有轻量反馈(收藏/赞踩)。
- **对话不是侧栏,是浮在画布上的气泡**:平时收成胶囊,工作时展开讲人话 + 列步骤。
- **Agent log = 任务队列**:多条指令可排队、单条可取消,历史全留痕(呼应产品原则「有迹可循」)。
- **底部 omnibox 是唯一起手点**:自由输入 + 附件(本地文件/URL/Library 引用)+ 模式切换。
- 工具条只管画布操作(选/框/移/缩放),创作智能全走对话。
- Canvas 内的 Otto 会话按 project 分席,与外部 Otto 不连贯,共享 knowledge base(Founder 2026-08-20 亲述,后端讨论待连接期)。

## 外壳(非 canvas section)方向

- 传统 SaaS dashboard,以 Founder 两张参考截图为准:
  - 「Firma」财务 dashboard:近白底、白卡、细边框、圆角、KPI 行、图表卡、右栏列表、左侧分组导航。
  - 「Generate Articles」(Founder 特别喜欢,贴了两次):浅灰侧栏 + 白内容区、面包屑、大标题、pill 页签、**柔和多彩渐变卡**(紫/蓝/橙)、黑色主按钮、圆角友好但专业。
- 外壳加一颗 **Otto pop-up button**(Shopify Sidekick 式)——与 W2-7 面板/launcher 概念兼容,视觉按新方向重造。
