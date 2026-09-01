# Settings visual QA

**Target:** `selected-direction.png`  
**Implementation:** `/product-patterns/settings?section=connections&connection=shopify`  
**Viewport:** 1487 × 1058  
**Comparison:** `design-qa-comparison.png`

## Pass 1

- Preserved the selected three-column structure: Settings scope rail, connection list, detail inspector.
- Kept the frozen beta navigation: Home, Create, Library, Brand, Settings.
- Added the missing connection identity and workspace scope to the detail inspector, where they remain visible without making the list noisy.
- Used the canonical Fikirtive shell, spacing, typography, buttons, alerts, dialogs and integration assets.

## Pass 2

- Reduced the connection list back to the selected visual density: service name plus health only.
- Verified the selected Shopify state, reconnect warning, account action, access action and recovery actions remain visible without scrolling.
- Retained two intentional Design System differences from the generated target: the canonical 240px global rail and canonical bordered integration-logo containers.

## Interaction checks

- Settings sections update the URL and browser Back restores the previous section.
- Connection selection updates the detail inspector and URL.
- Add connection, change account and reconnect flows work with session-only fixture state.
- Billing separates monthly and purchased credits; Add credits works with session-only fixture state.
- Ask Otto opens the canonical Otto panel.
- Browser console: no warnings or errors during the checked flows.

## Severity review

- P0: none.
- P1: none.
- P2: none requiring a fix before Founder review.

**final result: passed**
