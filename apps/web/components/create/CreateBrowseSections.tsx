import type { EntityDTO } from "@/lib/types";
import OttoTemplates from "@/components/otto/OttoTemplates";
import OttoDiscover from "@/components/otto/OttoDiscover";

/**
 * Templates 与 Discover —— `/create` 页面下方的两个区段(W2-5,规格书 Q6-A,Founder
 * 2026-08-18 拍板)。
 *
 * 它们原来各占一个导航格(`/otto?view=templates` 与 `?view=discover`)。裁决是:七格是
 * Founder 定的骨架,加回三格等于没换壳;但这两样都是**真能用**的东西,下线可惜。所以它们
 * 搬到「商家本来就会去的那一页」上 —— 不占格,也不消失。锚点 `#templates` / `#ideas` 就是
 * 旧地址的去处(`OTTO_VIEW_REDIRECTS`)。
 *
 * 内容是**搬家,不是重做**:这里挂的就是 `OttoTemplates` / `OttoDiscover` 本体,一份实现两处
 * 挂。导航格本身的删除属于切换总票(W2-11),这一票只建区段 —— 所以合并之后旧壳照常。
 */

/** 一个模板要在一张画布上跑(上传底图、出图都落在那张画布里),所以没有画布就没得跑。 */
function TemplatesNeedACanvas() {
  return (
    <div className="px-5 pt-16 pb-5">
      <h2 className="m-0 text-lg text-foreground">Templates</h2>
      <p className="mt-1 mb-0 text-sm text-muted-foreground">
        Start a project above first — a template runs in a project.
      </p>
    </div>
  );
}

export function CreateBrowseSections({
  projectId,
  entities,
}: {
  /** 商家自己最早的那张画布。一张都还没有时是 null —— 这一页**不**替他悄悄建一张。 */
  projectId: string | null;
  entities: EntityDTO[];
}) {
  return (
    <div className="mx-auto w-full max-w-[768px]">
      <section id="templates">
        {projectId ? (
          <OttoTemplates projectId={projectId} entities={entities} />
        ) : (
          <TemplatesNeedACanvas />
        )}
      </section>
      {/* Otto 面板还没挂到每一页上(W2-7 建好,W2-11 挂),所以这里不传 `onUseInOtto`:
          那颗「Use in Otto」按钮随之不画,而不是按了没反应。见 OttoDiscover 的说明。 */}
      <section id="ideas">
        <OttoDiscover />
      </section>
    </div>
  );
}
