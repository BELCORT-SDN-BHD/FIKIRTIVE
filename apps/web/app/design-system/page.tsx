/**
 * 内部样张页(design-system reference)—— 零数据、零 auth。与 `/home` 的 Stack A
 * 惯例相同:不进导航,输 URL 才到得了(`app/home/page.tsx` 的同一种落位法)。
 *
 * 权威关系:token 权威永远是 `app/globals.css` 的 `.gb` 块(本页只渲染那些 token,
 * 不重新定义任何颜色/圆角/阴影);色板权威是 `docs/brand/colors.json`。这页存在的
 * 意义只是把两份权威渲成一张可读的样张,给 Founder 走查,不是第三份真相来源。
 */

import { DesignSystemReference } from "./DesignSystemReference";

export const metadata = { title: "Design system · Fikirtive" };

export default function Page() {
  return <DesignSystemReference />;
}
