# ICEGrid Description Trust Design

## Goal

Keep Gemini-extracted line-item descriptions, including wrapped ones, without weakening evidence checks for customs codes, quantities, prices, or other fields.

## Trust tiers

Trust is graded by what a wrong value costs, not by field type.

| Tier | Fields | Gate |
| --- | --- | --- |
| Never trusted | `InvoiceSNo`, `ItemSNo`, `Per`, `Accessories` | module fills them; AI values discarded |
| Verify and constrain | the ten catalog-backed dropdowns | verified span **and** must resolve to a catalog entry |
| Verify verbatim | `RITCCode`, every amount, quantity and rate, `InvoiceNo` | verified span whose quote contains the value, via `quoteSupportsValue` |
| Trusted prose | `Description`, `dbk_desc` | verified span naming the field whose quote overlaps the value |

A wrong description costs an edit; a wrong RITC code costs a customs penalty. Only the bottom tier is relaxed, and nothing that reaches a filing as a code or an amount may join it.

## Trusted prose

PDF table layout puts quantities and prices between the wrapped lines of one description cell, so no single printed run ever contains the whole reconstructed value. These fields are accepted when a verified span names the field and its quote overlaps the value in either direction: the quote is a fragment of the description, or the description sits inside a wider quoted line.

Overlap, not mere existence, is what makes this a boundary. A verified quote about an unrelated part of the page cannot license an invented description.

## Extraction noise is ours, not the model's

PDF text extraction reorders table columns, splits a visual row across the text stream, and interleaves neighbouring cells. A model that copied the printed row correctly then fails a contiguous-substring check through no fault of its own.

`verifyEvidenceSpan` therefore falls back to order-free tokens: every whitespace token of the quote, compared by exact alphanumeric-squashed equality, must appear in the document. Quotes shorter than three tokens are never vouched for this way. Because the fabricated part of a fabricated quote is itself a token, an invented word or amount still fails — `SIDE TABLE LARGE 9,999.00` is rejected against a document that prints `1,440.00`.

The relaxation forgives our layout, never the model's arithmetic: the value must still be contained in the model's own quote for every non-prose field.

## Prompt

The Description instruction is written structurally, never with sample values. Earlier drafts pasted literal item names and a goods-class phrase from one customer's invoices as `e.g.` examples, which teaches the model that shipment's house style instead of the rule. It now states the rule only: use the line's own Description cell and its continuation lines, joined in printed order; exclude any heading that spans more than one line item, and exclude data belonging to another column - purchase-order numbers, tariff lines, weights, carton dimensions, packaging notes - even when the layout prints it in the same block. Sizes that are part of the article's own printed name are kept.

For a wrapped Description, cite at least one exact fragment of the cell rather than trying to quote the whole reconstructed value.

## Tests

- A wrapped Description survives with one verified, overlapping Description evidence span.
- A fabricated or unknown-file Description span is rejected.
- A verified but unrelated quote does not license an invented Description.
- A reordered, line-split quote verifies; a quote carrying an unprinted number does not.
- Strict value support remains mandatory for all non-prose fields.

## Non-goals

- Building a PDF table parser.
- Reconstructing descriptions from multiple evidence spans.
- Confidence scores or similarity thresholds; every rule here is exact and explainable to an auditor.
- Relaxing verification for customs codes, amounts, quantities, units, or catalog-backed fields.

## Known ceiling

Nothing checks row coherence: an `InvoiceNo` quote from page 1 and a `Quantity` quote from page 7 both verify and can be stitched into one row, because each field is judged alone by design. Revisit only if the corpus tests show cross-row stitching in practice.
