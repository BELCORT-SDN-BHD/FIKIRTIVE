// apps/web/components/canvas/nodes/node-tool-button.ts
//
// #840 第 3 步第四车 —— 卡片工具条上那一枚键的几何,一处写死。
//
// 迁移前这枚键是 `al-btn al-btn-glass al-btn-sm`(globals.css),三个节点文件各写一遍。
// 迁到 `@/components/ui/button` 之后 `size="sm"` 只对上圆角(`--radius-sm` = 10px,
// 与 Button 的 `rounded-[10px]` 同值),高度/内距/字号要显式压回 al-btn-sm 的原值,
// 否则浮在板子上的工具条会从 ~28px 长到 36px —— 那是重排,不是打磨。
//
// 颜色取自 `.gb .cv-node-toolbar .al-btn-glass`(卡片工具条实际生效的那一条,专有度
// 0,2,0):半透明的卡片底 + 边框 + shadow-sm,hover 变实底。gb 是唯一在跑的皮肤
// (`app/otto/page.tsx`:「Grok-bright ("gb") is the only skin」,北极星画布写死
// `skin="gb"`),所以对位的是它,不是 al-btn-glass 的 Vapor 深色原值。
//
// 放在 .ts 里而不是各文件复制一份:三个节点文件 14 个调用点共用同一枚键,复制会漂。
// (ImageNode 7 + VideoNode 6 + TextNode 1;判官 r1 P3-1 更正了原来写的 15。)
export const NODE_TOOL_BUTTON_CLASS =
  "nodrag nopan h-auto px-[13px] py-1.5 text-[12.5px] " +
  "border-border bg-[color-mix(in_oklab,var(--card)_92%,transparent)] shadow-sm hover:bg-card";
