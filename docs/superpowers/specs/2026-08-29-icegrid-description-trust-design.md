# ICEGrid Description Trust Design

## Goal

Keep Gemini-extracted line-item descriptions, including wrapped descriptions, without weakening evidence checks for customs codes, quantities, prices, or other fields.

## Design

Description uses a deliberately simpler evidence rule than other fields. A non-empty Description is accepted when at least one evidence span names `Description` and that span's filename and quote are verified against a selected source document. The quote does not need to contain the complete reconstructed Description because PDF table layout can place quantities and prices between wrapped description fragments.

All other fields retain the existing `quoteSupportsValue` check. Unsupported or fabricated evidence quotes continue to clear Description, so the change trusts Gemini's field reconstruction without accepting descriptions that have no connection to the uploaded documents.

Remove the recursive wrapped-row matcher and multi-span reconstruction. They are unnecessary under this trust boundary and can combine unrelated rows or files.

## Prompt

Keep the focused Description instruction: use only the line-item Description cell and its continuation lines; exclude category banners, purchase-order numbers, tariff lines, weights, dimensions, and packaging notes.

## Tests

- A wrapped Description survives with one verified Description evidence span.
- A fabricated or unknown-file Description span is rejected.
- Cross-row, category-banner, and cross-file composition helpers no longer exist.
- Strict value support remains mandatory for all non-Description fields.
- The targeted ICEGrid tests and full Bun test suite pass.

## Non-goals

- Building a PDF table parser.
- Reconstructing descriptions from multiple evidence spans.
- Relaxing verification for customs codes, amounts, quantities, units, or catalog-backed fields.
