# 设计系统国际化规则

> 本文只定义 UI 层必须长期遵守的国际化基础。正式 locale、翻译内容与市场上线顺序由对应产品阶段决定。

## Locale 与 fallback

- 产品不得从浏览器语言猜测 tenant 的业务市场；用户选择或 workspace 设置才是权威。
- 首个已批准 locale 是英文。中文与 Bahasa Melayu 进入产品范围时使用相同 token、组件和信息层级。
- 缺少翻译时回退到英文，并在开发环境暴露缺失 key；不得显示空白或未经确认的机器翻译。
- Geist 是 Latin UI 字体；中文回退顺序为 `PingFang SC`、`Noto Sans SC`、系统 sans-serif。

## 文案结构

- UI copy 使用完整 message key，不拼接句子片段。语序由 locale 决定。
- 数量使用 `Intl.PluralRules` 或翻译框架的 plural API；不要用 `count + " items"`。
- 组件至少允许英文文案增加 30% 长度；button、tab、badge 不以固定宽度包住可翻译文本。
- 文案保持 sentence case。产品名 `Fikirtive`、wordmark `fikirtive`、assistant `Otto` 不翻译。

## 数字、货币与日期

- 展示使用 `Intl.NumberFormat`、`Intl.DateTimeFormat` 和 tenant locale；业务存储仍使用稳定的 machine format。
- 货币必须同时携带 ISO currency code；不得把 `RM`、`$` 或小数位写死在通用组件。
- 排序与计算使用原始数值，不能对格式化后的字符串排序。
- 用户可见日期包含明确时区语义。排期与发布默认使用 workspace timezone，不依赖浏览器当前时区。
- 相对时间只用于近期辅助信息；钱、审批、排期和审计记录显示绝对日期时间。

## 方向与布局

- 新布局使用 logical properties 和 `start` / `end` 语义，不以 `left` / `right` 表达业务含义。
- 图标只有在表示方向时随 RTL 镜像；品牌 mark、媒体内容和非方向性图标不镜像。
- Base UI 的 keyboard、focus 与 reading order 必须在 LTR 和 RTL 保持一致。

## 无障碍与测试

- accessible name 使用翻译后的完整意图；图标不能成为唯一语言线索。
- `lang` 与 `dir` 必须设置在 document 或局部语言片段上。
- 每个正式 locale 验收：320px、200% zoom、长文案、复数、货币、日期、timezone、键盘与 screen reader 顺序。
- Calendar 必须传入对应 locale 与 timezone；服务器与客户端不得用不同 timezone 生成初始选中日期。
