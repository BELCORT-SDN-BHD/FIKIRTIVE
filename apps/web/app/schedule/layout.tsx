import type { ReactNode } from "react";

/** R22 把 Schedule 与 Analytics 都放在全局 rail；这里不能再叠一层旧页签壳。 */
export default function ScheduleLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
