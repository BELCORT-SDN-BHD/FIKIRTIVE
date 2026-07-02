/**
 * Fixed reference-generation formats (founder decision R4, 2026-07-02).
 * Each format bakes the OBJECTIVE best-practice shape for that reference type —
 * the user only supplies the subject. Founder-editable: change the template
 * strings below; the skeleton is the product knowledge.
 * Prompts are English (structuredPrompt convention). Display/compose-only —
 * generation itself goes through the existing frozen startRefGen path.
 */

export type ReferenceFormat = {
  key: "avatar" | "product-shot" | "location" | "brandmark";
  label: string;
  entityType: "CHARACTER" | "PRODUCT" | "LOCATION" | "BRANDMARK";
  subjectLabel: string;
  subjectPlaceholder: string;
  buildPrompt(fields: { subject: string; notes?: string }): string;
};

const notesSuffix = (notes?: string) => (notes?.trim() ? ` Additional details: ${notes.trim()}.` : "");
const cap = (s: string) => (s.length <= 2000 ? s : s.slice(0, 2000));

export const REFERENCE_FORMATS: ReferenceFormat[] = [
  {
    key: "avatar",
    label: "Avatar / Cast",
    entityType: "CHARACTER",
    subjectLabel: "Who is this?",
    subjectPlaceholder: "e.g. Rosa, 30s Malaysian founder, warm smile",
    buildPrompt: ({ subject, notes }) =>
      cap(
        `Professional reference portrait of ${subject.trim()}. Head-and-shoulders framing, facing camera, ` +
          `neutral expression, soft even studio lighting, plain light-gray seamless background, sharp focus, ` +
          `no props, no text, photorealistic.${notesSuffix(notes)}`,
      ),
  },
  {
    key: "product-shot",
    label: "Product shot",
    entityType: "PRODUCT",
    subjectLabel: "What product?",
    subjectPlaceholder: "e.g. a 250g bag of Latte Blend coffee",
    buildPrompt: ({ subject, notes }) =>
      cap(
        `Clean studio product photograph of ${subject.trim()}. Centered on a seamless off-white background, ` +
          `soft diffused lighting, gentle natural shadow, true-to-life colors, sharp focus, ` +
          `no props, no hands, no text.${notesSuffix(notes)}`,
      ),
  },
  {
    key: "location",
    label: "Location",
    entityType: "LOCATION",
    subjectLabel: "What place?",
    subjectPlaceholder: "e.g. our cozy Bangsar cafe interior",
    buildPrompt: ({ subject, notes }) =>
      cap(
        `Wide establishing shot of ${subject.trim()}. Empty scene with no people, natural daylight, ` +
          `eye-level perspective, clean composition, photorealistic, no text.${notesSuffix(notes)}`,
      ),
  },
  {
    key: "brandmark",
    label: "Brand mark",
    entityType: "BRANDMARK",
    subjectLabel: "Describe the mark",
    subjectPlaceholder: "e.g. our coral cloud logo",
    buildPrompt: ({ subject, notes }) =>
      cap(
        `Flat brand mark of ${subject.trim()}, centered on a plain white background, no distortion, ` +
          `no perspective, no shadows, no extra elements, crisp edges.${notesSuffix(notes)}`,
      ),
  },
];

export function formatFor(key: string): ReferenceFormat | undefined {
  return REFERENCE_FORMATS.find((f) => f.key === key);
}
