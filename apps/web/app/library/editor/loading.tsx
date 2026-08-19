import { Skeleton } from "@/components/ui/skeleton";

/**
 * 剪辑台的加载态(规格书 §5.6:走 `ui/skeleton`,不手搓)。
 *
 * 形状照着 `EditDesk`:标题 + 那句「全部免费」的说明,底下「现在这条视频」与「你的素材」
 * 两块。
 */
export default function LibraryEditorLoading() {
  return (
    <div className="flex min-h-dvh flex-col" style={{ padding: "64px 20px 20px" }}>
      <div className="mb-4 flex flex-col gap-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-5 w-[min(34rem,85vw)]" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 rounded-[14px]" />
        <Skeleton className="h-56 rounded-[14px]" />
      </div>
      <span className="sr-only">Loading the video editor</span>
    </div>
  );
}
