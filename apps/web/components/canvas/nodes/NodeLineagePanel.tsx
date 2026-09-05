// apps/web/components/canvas/nodes/NodeLineagePanel.tsx
//
// "Where did this card come from?" — the panel behind a card's Info button.
//
// A canvas card used to keep only its prompt, so a merchant could not tell when it was made,
// with what settings, what it cost, or which card it came from (#547 B4 · founder rule
// 每个东西都要有迹可循). Display only: it renders the lineage the server already read and
// never asks for anything. It never names the generation engine.
import { useState } from "react";
import { CheckIcon, CopyIcon, XIcon } from "lucide-react";

import { canvasLineageRows, type CanvasNodeLineage } from "@/lib/canvas-lineage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { TooltipButton } from "@/components/ui/tooltip-button";

export function NodeLineagePanel({
  lineage,
  prompt,
  hasSource = false,
  onClose,
}: {
  lineage: CanvasNodeLineage | null | undefined;
  prompt?: string | null;
  hasSource?: boolean;
  onClose?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  /**
   * The press that did NOT copy (接线盘点 L1 · FRONT-A12).
   *
   * A clipboard write is refused far more often than it looks: an insecure origin, a browser that
   * only allows it inside a user gesture it has already stopped counting, or a permission the
   * merchant declined. Every one of those rejects the promise, and this panel used to answer them
   * by putting `copied` back to `false` — which is the same thing it does while nothing has been
   * pressed at all. The merchant pressed a button and the screen said nothing, so the only reading
   * available was "it copied"; they then pasted the previous clipboard into an ad.
   *
   * The recovery is already on screen: this panel prints the prompt itself, right below, so being
   * told the copy did not happen is enough — select it and copy by hand. No new control is added,
   * and the sentence is the one this product already uses for a refused clipboard write
   * (`components/otto/OttoResult.tsx`), so a merchant reads the same words in both places.
   */
  const [copyFailed, setCopyFailed] = useState(false);
  const rows = lineage ? canvasLineageRows(lineage, { hasSource }) : [];
  const text = (prompt ?? "").trim();

  const copyPrompt = () => {
    if (!text) return;
    // No clipboard API at all is the same outcome as a refusal, and it must read as one: an
    // optional-chained `undefined` would otherwise sail past `.then` and leave the press silent.
    const write = navigator.clipboard?.writeText(text);
    if (!write) {
      setCopied(false);
      setCopyFailed(true);
      return;
    }
    void write.then(
      () => {
        setCopyFailed(false);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => {
        setCopied(false);
        setCopyFailed(true);
      },
    );
  };

  return (
    <Card size="sm" className="cv-node-info nodrag nopan">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <CardTitle>Generation details</CardTitle>
          <CardDescription>Recorded facts for this card.</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {text && (
            <TooltipButton
              type="button"
              label={copied ? "Prompt copied" : "Copy prompt"}
              tooltip={copied ? "Copied" : "Copy prompt"}
              variant="ghost"
              size="icon-xs"
              className="nodrag nopan"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); copyPrompt(); }}
            >
              {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            </TooltipButton>
          )}
          {onClose && (
            <TooltipButton
              type="button"
              label="Close generation details"
              tooltip="Close"
              variant="ghost"
              size="icon-xs"
              className="nodrag nopan"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); onClose(); }}
            >
              <XIcon aria-hidden />
            </TooltipButton>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
      {copyFailed && (
        <p role="alert" className="text-xs text-destructive">
          Couldn&apos;t copy automatically.
        </p>
      )}
      {text && (
        <section className="flex flex-col gap-1.5">
          <span className="cv-node-info-label">Prompt</span>
          <p className="cv-node-info-prompt">{text}</p>
        </section>
      )}
      {text && <Separator />}
      {rows.length > 0 ? (
        <dl className="cv-node-info-facts">
          {rows.map((row) => (
            <div key={row.label} className="cv-node-info-fact">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <span className="text-xs text-muted-foreground">
          No generation record for this card.
        </span>
      )}
      </CardContent>
    </Card>
  );
}
