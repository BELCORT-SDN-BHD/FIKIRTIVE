import { Skeleton } from "@/components/ui/skeleton";

/**
 * 剪辑台的加载态(规格书 §5.6:走 `ui/skeleton`,不手搓)。
 *
 * 形状照着 `EditDesk`:标题 + 那句「全部免费」的说明,底下「现在这条视频」与「你的素材」
 * 两块。
 */
export default function LibraryEditorLoading() {
  return (
    <div className="flex min-h-dvh flex-col px-5 pb-5 pt-16 lg:px-6 lg:pb-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-5 w-[min(34rem,85vw)]" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="flex flex-col gap-4">
            <Skeleton className="aspect-video max-h-[38rem] rounded-[var(--radius-card)]" />
            <Skeleton className="h-72 rounded-[var(--radius-card)]" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-72 rounded-[var(--radius-card)]" />
            <Skeleton className="h-56 rounded-[var(--radius-card)]" />
          </div>
        </div>
      </div>
      <span className="sr-only">Loading the video editor</span>
    </div>
  );
}
