import Image from "next/image";

import { cn } from "@/lib/utils";

const OTTO_MARKS = {
  idle: "/brand/otto.svg",
  helpful: "/brand/otto-helpful.svg",
} as const;

/** Founder-approved Otto v4 cloud mark. Fikirtive product identity uses FikirtiveMark instead. */
export function OttoMark({
  className,
  expression = "idle",
  size = 32,
}: {
  className?: string;
  expression?: keyof typeof OTTO_MARKS;
  size?: number;
}) {
  return (
    <Image
      aria-hidden="true"
      alt=""
      className={cn("shrink-0", className)}
      src={OTTO_MARKS[expression]}
      width={size}
      height={Math.round((size * 110) / 120)}
    />
  );
}
