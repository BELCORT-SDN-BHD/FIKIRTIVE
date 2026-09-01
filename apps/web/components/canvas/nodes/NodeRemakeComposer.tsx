import type { ReactNode } from "react";
import { ArrowUpIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

export function NodeRemakeComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  inputLabel,
  submitLabel,
  costHint,
  costLabel,
  confirmation,
  controls,
  disabled = false,
  pending = false,
  pendingLabel = "Starting generation",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  inputLabel: string;
  submitLabel: string;
  costHint?: string;
  costLabel: string;
  confirmation?: string;
  controls?: ReactNode;
  disabled?: boolean;
  pending?: boolean;
  pendingLabel?: string;
}) {
  return (
    <form
      className="al-promptbar cv-node-remake"
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.trim()) return;
        onSubmit();
      }}
    >
      <InputGroup>
        <InputGroupInput
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={inputLabel}
          disabled={disabled}
          className="nodrag nopan"
        />
        {controls}
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="submit"
            variant="default"
            size="icon-sm"
            aria-label={pending ? pendingLabel : submitLabel}
            disabled={disabled || !value.trim()}
          >
            {pending ? <Spinner aria-hidden="true" /> : <ArrowUpIcon aria-hidden />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {costHint && (
        <div className="cv-node-remake-meta">
          <Badge variant="outline">{costLabel} · {costHint}</Badge>
          {confirmation && <span>{confirmation}</span>}
        </div>
      )}
    </form>
  );
}
