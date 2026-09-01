import Image from "next/image";

import { cn } from "@/lib/utils";

/** Official coral F app icon. The SVG master lives in design-system/brand/logo. */
export function FikirtiveMark({
  className,
  size = 28,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <Image
      aria-hidden="true"
      alt=""
      className={cn("shrink-0", className)}
      src="/brand/f-app-icon-coral.svg"
      width={size}
      height={size}
    />
  );
}
