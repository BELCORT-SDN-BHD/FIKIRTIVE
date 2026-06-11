import { getEntities } from "@/lib/data";
import { toEntityDTO } from "@/lib/dto";
import { AppShell } from "@/components/AppShell";
import { Library } from "@/components/Library";

export const dynamic = "force-dynamic";

export const metadata = { title: "Library · Artlio" };

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;
  const entities = await getEntities();
  return (
    <div className="flex flex-col h-dvh">
      {/* <1024: phase 1 is desktop-first — read-only, same as the workbench (D9) */}
      <div
        className="lg:hidden bg-accent-soft text-ink text-sm px-4 py-2 text-center"
        role="status"
      >
        Artlio works best on a desktop browser — this view is read-only.
      </div>
      <AppShell view="library" title="Elements">
        <div className="flex flex-1 min-h-0 max-lg:pointer-events-none">
          <Library entities={entities.map(toEntityDTO)} initialSelectedId={e ?? null} />
        </div>
      </AppShell>
    </div>
  );
}
