# Primitives

这里是 Fikirtive 唯一的基础组件实现，技术基座是 shadcn `base-nova` + Base UI。组件负责通用 API、
keyboard、focus、disabled、loading、error 与 accessibility states；业务含义留在产品组件。

现有 import `@/components/ui/*` 通过 symlink 指向这里。不要在 `apps/web/components/` 另建同名
primitive，也不要复制一个 Button 只为改变颜色；应在正式 Button 中建立有明确语义的 variant。

