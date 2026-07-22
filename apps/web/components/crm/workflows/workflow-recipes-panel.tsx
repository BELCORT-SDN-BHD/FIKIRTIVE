import { Clock3, CookingPot, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default function WorkflowRecipesPanel() {
  return (
    <section id="recipes" className="scroll-mt-8" aria-labelledby="workflow-recipes-heading">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">Configure</p>
        <h2 id="workflow-recipes-heading" className="mt-2 text-2xl font-semibold tracking-tight">Recipes and business hours</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Recipes create ordinary workflow definitions and disabled Routine drafts. Installing a recipe never authorizes customer contact.</p>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4">
        <Card className="border-dashed shadow-none">
          <CardContent><span className="grid size-10 place-items-center rounded-xl bg-secondary text-muted-foreground"><CookingPot className="size-4" /></span><div className="mt-4 flex items-center gap-2"><h3 className="font-semibold">Inbox recipes</h3><Badge variant="outline">Unavailable</Badge></div><p className="mt-2 text-sm leading-6 text-muted-foreground">The server-owned recipe catalog is not exposed by the current gateway. No recipe names, versions, or install state are guessed.</p></CardContent>
        </Card>
        <Card className="border-dashed shadow-none">
          <CardContent><span className="grid size-10 place-items-center rounded-xl bg-secondary text-muted-foreground"><Clock3 className="size-4" /></span><div className="mt-4 flex items-center gap-2"><h3 className="font-semibold">Business hours</h3><Badge variant="outline">Unavailable</Badge></div><p className="mt-2 text-sm leading-6 text-muted-foreground">Business-hours policies are not exposed by the current gateway. Missing time zone or schedule facts remain unavailable and never trigger an automatic reply.</p></CardContent>
        </Card>
      </div>
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground"><Unplug className="mt-0.5 size-4 shrink-0" /><span>Outside-hours replies remain unavailable until the strict workflow messaging classification is connected. No automatic reply is sent in this simulated workspace.</span></div>
    </section>
  );
}
