// The built-in template catalog. The data and every rule about it now live in
// `@fikirtive/core/templates` (#783), because two surfaces must read the SAME library:
// this app's Templates panel, and Otto's recommendTemplates skill. This file stays as the
// app-side import path so every existing `@/lib/templates` import keeps working.
export {
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_CAPTION_LANGUAGES,
  TEMPLATE_INDUSTRIES,
  TEMPLATE_CAPTION_PLACEHOLDERS,
  TEMPLATE_RUN_IMAGE_COUNT,
  buildTemplatePrompt,
  templateRunCredits,
  templateCategories,
  templateById,
  templateCaptions,
  filterTemplates,
  recommendTemplates,
  resolveTemplateIndustry,
} from "@fikirtive/core/templates";
export type {
  Template,
  TemplateQuestion,
  TemplateCaption,
  TemplateCaptionLanguage,
  TemplateCategory,
  TemplateIndustry,
} from "@fikirtive/core/templates";
