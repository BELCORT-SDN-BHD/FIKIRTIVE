import { ImageIcon, TypeIcon, VideoIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

const ICONS = {
  image: ImageIcon,
  video: VideoIcon,
  text: TypeIcon,
} as const;

export function CanvasNodeLabel({
  kind,
  letter,
}: {
  kind: keyof typeof ICONS;
  letter?: string | null;
}) {
  const Icon = ICONS[kind];
  const label = kind[0]!.toUpperCase() + kind.slice(1);

  return (
    <Badge className="cv-nodelabel">
      <Icon aria-hidden />
      {label}
      {letter && <span className="cv-nodeletter">{letter}</span>}
    </Badge>
  );
}
