"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import {
  ImageIcon,
  MapPinIcon,
  PackageIcon,
  ShirtIcon,
  SparklesIcon,
  StampIcon,
  UploadIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { ReferenceType } from "@fikirtive/core/reference-ref";

import type { ReferenceLink } from "@/lib/reference-search-model";

/**
 * The objects a sent message named — and the way back to each of them (FRONT-A10: "消息记录保存
 * 该对象的真实 ID,可回链"; spec `docs/specs/frontend-baseline.md` §7.3③ slice ③).
 *
 * Presentational only. Every field here — the name, the source line, the address — was resolved
 * server-side against the authenticated owner (`lib/reference-refs.ts`) and travels on the message
 * DTO. This component never derives a name or an href from an id: a link this component invented
 * could point at an object the merchant is not allowed to open, and a name it invented could
 * disagree with the one in Library.
 *
 * A reference whose object has since been deleted does not arrive here at all — the resolver drops
 * it — so there is no such thing as a chip that leads nowhere.
 */

const TYPE_ICONS: Record<ReferenceType, ComponentType<{ className?: string }>> = {
  product: PackageIcon,
  character: UsersRoundIcon,
  "official-avatar": UserRoundIcon,
  location: MapPinIcon,
  clothes: ShirtIcon,
  generation: SparklesIcon,
  upload: UploadIcon,
  brandmark: StampIcon,
};

export function MessageReferences({ references }: { references: readonly ReferenceLink[] }) {
  if (references.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="References in this message">
      {references.map((reference) => {
        const Icon = TYPE_ICONS[reference.type] ?? ImageIcon;
        return (
          <li key={`${reference.type}:${reference.id}`}>
            <Link
              href={reference.href}
              // The source line is the disambiguation the picker showed when it was chosen
              // (contract §3) — same sentence, so the merchant recognises what they picked.
              title={reference.source}
              className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{reference.name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
