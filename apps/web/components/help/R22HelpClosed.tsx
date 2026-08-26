import { LifeBuoy } from "lucide-react";
import { supportMailto } from "@/lib/exits";
import "./r22-help.css";

/**
 * 商家直接输了 `/help`(或从一条旧链接落进来)时读到的那一面 —— beta 期这扇门收起来了。
 * 为什么收、怎么开回来,在 `r22-help-beta.ts` 那段裁决里。
 *
 * 口径照 Settings 回落那一句(`R22SettingsShell` 的 `data-r22-settings-fallback`):
 * 说清**你在哪、这里现在没有什么、下一步往哪走**,不加一句自证清白的话。所以这里既不写
 * 「我们没有拿别的东西顶上」,也不给一个「什么时候回来」的日期 —— 那是一件产品自己都还
 * 不知道的事。给得出的只有两条真出口:Otto,和一个人。
 */
export function R22HelpClosed() {
  return (
    <main className="r22-help" data-r22-help data-r22-help-closed>
      <header>
        <p>Support</p>
        <h1>How can we help?</h1>
        <span>Otto is in every project, and a person is one email away.</span>
      </header>
      <div className="r22-help-unavailable" role="status">
        <LifeBuoy aria-hidden="true" />
        <b>Help articles are not open in this beta</b>
        <p>This beta is only about making your images and videos, so there are no articles to read yet. Ask Otto while you work, or email us and a person answers.</p>
        <a className="r22-help-closed-exit" href={supportMailto("Fikirtive support request")}>Email support</a>
      </div>
    </main>
  );
}

export default R22HelpClosed;
