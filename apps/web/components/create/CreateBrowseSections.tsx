import type { EntityDTO } from "@/lib/types";
import { PanelsTopLeft } from "lucide-react";
import OttoTemplates from "@/components/otto/OttoTemplates";
import OttoDiscover from "@/components/otto/OttoDiscover";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";

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
    <div className="mx-auto w-full max-w-[1120px] px-6 py-12">
      <h2 className="text-lg font-semibold tracking-[-0.012em] text-foreground">Templates</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Templates use a canvas to keep the source photo, result, and cost together.
      </p>
      <Empty className="mt-5 min-h-48 border border-dashed bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PanelsTopLeft aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle className="text-base">Start a canvas above first</EmptyTitle>
          <EmptyDescription>Your templates will be ready as soon as the canvas exists.</EmptyDescription>
        </EmptyHeader>
      </Empty>
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
    <div className="w-full pb-12">
      <section id="templates" className="scroll-mt-6">
        {projectId ? (
          <OttoTemplates projectId={projectId} entities={entities} />
        ) : (
          <TemplatesNeedACanvas />
        )}
      </section>
      <Separator className="mx-auto w-[calc(100%-3rem)] max-w-[1120px]" />
      {/* 全局 Otto 面板还没有暴露 prompt 预填接口,所以这里不传 `onUseInOtto`:
          那颗「Use in Otto」按钮随之不画,而不是按了没反应。见 OttoDiscover 的说明。 */}
      <section id="ideas" className="scroll-mt-6">
        <OttoDiscover />
      </section>
    </div>
  );
}
