import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Alert, AlertDescription } from "@/components/ui/alert";

const WEB_ROOT = path.resolve(__dirname, "../..");

function source(file: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, file), "utf8");
}

const OTTO_FEEDBACK_FILES = [
  "components/otto/ResearchCard.tsx",
  "components/otto/OttoAdBuildCard.tsx",
  "components/otto/OttoApprovalCard.tsx",
  "components/otto/OttoActionPlanCard.tsx",
  "components/otto/OttoPlanCard.tsx",
  "components/otto/PackCard.tsx",
  "components/otto/StoryboardCard.tsx",
  "components/otto/OttoResult.tsx",
  "components/otto/OttoSchedule.tsx",
  "components/otto/stuff/ChangeEntityTypeDialog.tsx",
] as const;

describe("FIKIRTIVE feedback design system", () => {
  it("offers a compact semantic alert for feedback inside cards", () => {
    const markup = renderToStaticMarkup(
      <Alert role="alert" variant="destructive" density="compact">
        <AlertDescription>Nothing was charged.</AlertDescription>
      </Alert>,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("rounded-[var(--radius-card)]");
    expect(markup).toContain("bg-error-soft");
    expect(markup).toContain("px-3 py-2");
    expect(markup).not.toMatch(/bg-brand|text-brand|border-brand|shadow-brand/);
  });

  it("keeps card-level Otto failures on the shared compact Alert contract", () => {
    for (const file of OTTO_FEEDBACK_FILES) {
      const contents = source(file);
      expect(contents, file).toContain("<Alert role=\"alert\"");
      expect(contents, file).toContain('density="compact"');
      expect(contents, file).not.toContain('<div role="alert"');
    }

    for (const file of ["components/otto/OttoAdBuildCard.tsx", "components/otto/PackCard.tsx"]) {
      expect(source(file), file).toContain('variant="warning"');
    }
  });

  it("keeps toasts neutral, dismissible, and on the shared 12px surface", () => {
    const toaster = source("components/ui/toast.tsx");

    expect(toaster).toContain("fixed inset-x-4 bottom-4");
    expect(toaster).toContain("limit={3}");
    expect(toaster).toContain("ToastPrimitive.Close");
    expect(toaster).toContain("rounded-[var(--radius-card)]");
    expect(toaster).toContain("bg-popover");
    expect(toaster).not.toMatch(/bg-brand|text-brand|border-brand|shadow-brand/);
  });

  it("defers alert examples until the component-library phase", () => {
    const reference = source("app/design-system/DesignSystemReference.tsx");
    expect(reference).toContain('data-scope="foundations-only"');
    expect(reference).not.toContain("<Alert");
    expect(reference).not.toContain('density="compact"');
  });
});
