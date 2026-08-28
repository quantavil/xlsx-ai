# Table AI Focused Modernization Design

## Objective

Turn Table AI into a reliable, responsive spreadsheet workspace with a restrained Zen-brutalist visual language. Preserve the existing local-first SvelteKit product while fixing correctness, maintainability, accessibility, performance, and product-trust issues.

## Success Criteria

- `bun run check`, unit tests, production build, and Playwright tests pass without application warnings or known correctness failures.
- All existing table workflows remain available: edit, sort, search, import, export, samples, undo/redo, themes, settings, and AI assistance.
- The workspace is usable on desktop, tablet, and phone without clipped controls or inaccessible actions.
- Destructive actions are deliberate, AI mutations are validated and undoable as one operation, and errors explain how to recover.
- Large optional features are separated from the initial client path where practical.

## Product and Visual Direction

Use a quiet, functional interface rather than a decorative dashboard. The design combines Zen restraint with a slight brutalist edge:

- Neutral backgrounds, crisp one-pixel rules, minimal shadows, and a single green action accent.
- Strong typographic hierarchy, tabular numerals, and compact controls with adequate touch targets.
- Honest rectangular surfaces and visibly structured tool groups; gradients and glass effects are reserved for rare emphasis.
- Desktop retains a dense spreadsheet layout. Tablet and mobile use adaptive toolbars, horizontally scrollable data, and overlay panels that do not crush the grid.
- Motion is short and functional, with a complete reduced-motion path.

## Architecture and Component Boundaries

Keep SvelteKit 2 and Svelte 5 runes. Refactor only where it improves correctness or makes the changed behavior independently testable.

- `table.svelte.ts` remains the table state boundary. Add explicit batch mutation support so AI patches create one history entry and one persistence write.
- Extract shared cell parsing and normalization so import, inline editing, sorting, summaries, and AI patches use the same rules.
- Extract shared table serialization and browser-download behavior used by Excel and CSV exports.
- Break large UI files along behavior boundaries: settings sections/model picker, table cell/header controls, and AI chat/diff presentation.
- Keep sample data separate from parsing/export logic and remove duplicated/dead dataset declarations.
- Load heavy optional spreadsheet functionality on demand when import or export is invoked. Load settings and other nonessential panels lazily if SvelteKit/Vite behavior remains reliable.

## Data Flow and Correctness

1. Imported, hydrated, edited, or AI-provided values pass through one type-aware normalizer.
2. Store mutations validate row/column existence before recording history.
3. A user action records history only when it changes valid state.
4. AI patches are validated against the current schema, invalid or duplicate targets are rejected, and accepted patches apply atomically.
5. Persistence stores a versioned, validated table document. Invalid saved data falls back safely and produces a recoverable notice.
6. Export creates a sanitized filename and preserves column order and empty-table headers.

## Defects and Debt in Scope

- Remove the duplicate `inventory` key that currently fails `svelte-check` and leaves an entire dead dataset block.
- Correct contradictory Gemini names/defaults and do not relabel one model as another.
- Validate requested model IDs and AI response patches instead of trusting headers/model output.
- Prevent empty or invalid mutations from polluting undo history.
- Make multi-cell AI application a single undoable action.
- Eliminate repeated percentage/number parsing and repeated table-to-object export mapping.
- Fix stale README/test/model claims.
- Address client bundle growth caused by eager SheetJS inclusion.
- Improve menus, dialog focus, keyboard navigation, platform shortcut labels, destructive confirmations, responsive layout, and touch behavior.
- Remove redundant comments, unused props/types/constants, misleading naming, and cosmetic complexity that does not support hierarchy.

## Responsive Interaction Model

- **Desktop:** full header, grid, optional AI side panel, and a compact command rail or grouped toolbar.
- **Tablet:** condensed header and icon-first actions; AI becomes an overlay panel so the table retains usable width.
- **Phone:** essential commands remain visible, secondary commands move into an accessible menu, settings and AI become full-height sheets, and row actions work without hover.
- The native table remains horizontally scrollable. Sticky row identifiers and headers preserve orientation where space permits.

## Error Handling and Safety

- Confirm column deletion and sample replacement when current work would be overwritten.
- Use specific, non-secret-bearing error messages for import, export, persistence, model retrieval, and AI generation.
- Never log or echo API keys. Keep the existing local-storage choice visible to the user and avoid claiming stronger security.
- Cap AI request context by serialized size as well as row count, and report sampling honestly.
- Disable duplicate submissions and allow in-flight AI requests to be cancelled when the drawer closes or the user starts over.

## Accessibility

- Implement focus trapping and focus restoration for modal/sheet surfaces.
- Give menus and listboxes usable arrow-key, Home/End, Enter, and Escape behavior.
- Do not rely on hover for row actions.
- Maintain visible focus, WCAG AA contrast, semantic labels, and at least 44-pixel touch targets on coarse pointers.
- Respect `prefers-reduced-motion` and avoid hidden-but-focusable drawer content.

## Testing and Verification

- Add unit tests for shared parsing, no-op history behavior, batch AI patches, persistence validation, filename sanitation, and duplicate/invalid patch rejection.
- Add API tests for model validation, payload limits, malformed AI data, and safe error mapping.
- Expand Playwright coverage for confirmations, undoing an AI batch, keyboard menus/dialog focus, and mobile/tablet viewports.
- Run `bun run check`, `bun test tests`, `bun run build`, and `bun run test:e2e` after implementation.
- Inspect output chunks and ensure heavy spreadsheet code is no longer part of the initial page chunk when the lazy-loading change is retained.

## Scope Limits

This modernization does not add accounts, cloud storage, collaboration, formulas, multiple worksheets, or a new backend database. It does not replace SvelteKit or rebuild the product from scratch. These would be separate product initiatives.
