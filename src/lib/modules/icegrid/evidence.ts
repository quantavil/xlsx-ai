import type { CombinedExtractionResult } from './readers';
import type { IcegridEvidenceSpan } from './schema';

/**
 * Fold text for comparison without changing what it says.
 *
 * Allowed: Unicode normalization, case folding, whitespace collapsing, and unifying
 * the dash/quote characters PDF extraction mangles. Explicitly NOT allowed:
 * stemming, synonyms, translation, or any similarity scoring. If two strings differ
 * after this, they are different strings.
 */
export function normalizeEvidenceText(value: string): string {
	return value
		.normalize('NFKC')
		.replace(/[‐-―−]/g, '-')
		.replace(/[‘’‛]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

export interface EvidenceCheck {
	ok: boolean;
	reason?: 'unknown_file' | 'quote_not_found' | 'empty_quote';
}

/** Alphanumeric-only form of a token, so `1,440.00` and `1440.00` compare equal. */
const squash = (token: string) => token.replace(/[^a-z0-9]/g, '');

/**
 * Every token of the quote appears in the document, ignoring order.
 *
 * PDF extraction is the unreliable half of this pipeline: it reorders table columns,
 * splits a visual row across the text stream, and interleaves neighbouring cells. A
 * model that copied the printed row correctly then fails the contiguous check through
 * no fault of its own. Tokens are matched by exact squashed equality, never substring,
 * so `48` can never be found inside `1,448.00`; a fabricated quote still fails, because
 * its invented words and numbers are tokens the document does not contain.
 */
function tokensPresent(quote: string, documentText: string): boolean {
	const wanted = quote.split(' ').map(squash).filter(Boolean);
	if (wanted.length < 3) return false;
	const have = new Set(documentText.split(' ').map(squash).filter(Boolean));
	return wanted.every((token) => have.has(token));
}

/**
 * Confirm a span points at a selected file and quotes text that file actually
 * contains, either contiguously or as the same set of tokens. A fabricated quote fails
 * here, which is what stops a fabricated value from being legitimized by fabricated
 * evidence.
 */
export function verifyEvidenceSpan(
	span: IcegridEvidenceSpan,
	extraction: CombinedExtractionResult
): EvidenceCheck {
	const quote = normalizeEvidenceText(span.quote ?? '');
	if (!quote) return { ok: false, reason: 'empty_quote' };

	const wanted = normalizeEvidenceText(span.sourceFile ?? '');
	// Duplicate filenames are handled by searching every document that carries the
	// name: a quote found in any of them is genuinely present in a selected file.
	const matches = extraction.documents.filter((d) => normalizeEvidenceText(d.filename) === wanted);
	if (matches.length === 0) return { ok: false, reason: 'unknown_file' };

	const texts = matches.map((doc) => normalizeEvidenceText(doc.content));
	if (texts.some((text) => text.includes(quote))) return { ok: true };
	// Fall back to order-free tokens before blaming the model for our extractor's layout.
	if (texts.some((text) => tokensPresent(quote, text))) return { ok: true };

	return { ok: false, reason: 'quote_not_found' };
}

/**
 * The distinct numbers a passage contains, as canonical numeric strings.
 *
 * Commas group digits within one number; whitespace separates two numbers. Treating
 * whitespace as a grouping character would splice `94038900 48` into `9403890048`
 * and let a value be "supported" by a number the document never printed.
 */
function numericTokens(text: string): Set<string> {
	const out = new Set<string>();
	for (const raw of text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []) {
		const n = Number(raw.replace(/,/g, '').replace(/\.$/, ''));
		if (Number.isFinite(n)) out.add(String(n));
	}
	return out;
}

/**
 * Every span of runs the quote can be said to spell out.
 *
 * A run is a stretch of digits or of letters. Runs the layout glued together with
 * punctuation and nothing else - `8505.11.10`, `26-27`, `1,440.00` - are one printed
 * thing, and a span may not stop in the middle of one unless the character class
 * changes there. Across a space, a span may stop wherever it likes, because a space
 * is where the document itself stopped.
 *
 * That is the whole distinction between the layout and the value. `hsn:8505.11.10`
 * spells out `85051110`, `ritc 9403 8900` spells out `94038900`, and `100pcs` spells
 * out `pcs`. But `1994038900` does not spell out `94038900`, a printed `100000` does
 * not spell out `1000`, and `30744 / 26-27` does not spell out `3074426` - that last
 * one stops halfway through `26-27`, keeping a fragment of a printed number.
 *
 * Spans are capped because an identifier is a handful of runs, never a paragraph -
 * without it a long prose quote would cost O(runs^2).
 */
const MAX_SPAN_RUNS = 8;

function runSpans(text: string): Set<string> {
	const runs = [...text.matchAll(/\d+|[a-z]+/g)];
	const digits = runs.map((m) => m[0].charCodeAt(0) <= 57);
	const end = (i: number) => (runs[i].index ?? 0) + runs[i][0].length;
	/** Nothing but punctuation sits between this run and the next. */
	const glued = runs.map(
		(_, i) => i + 1 < runs.length && !/\s/.test(text.slice(end(i), runs[i + 1].index))
	);
	const breakable = (j: number) =>
		j + 1 === runs.length || !glued[j] || digits[j + 1] !== digits[j];

	const spans = new Set<string>();
	for (let i = 0; i < runs.length; i++) {
		// Starting here would take the back half of something printed as one thing.
		if (i > 0 && glued[i - 1] && digits[i - 1] === digits[i]) continue;
		// A span carved out of a glued group has to reach one of its ends. Stripping the
		// `hsn` off `hsn:8505.11.10` leaves a value that still ends where the printed one
		// does; `aabcu9603` out of a GSTIN reaches neither end and is a fragment.
		const atGroupStart = i === 0 || !glued[i - 1];
		let joined = '';
		for (let j = i; j < Math.min(runs.length, i + MAX_SPAN_RUNS); j++) {
			joined += runs[j][0];
			if (breakable(j) && (atGroupStart || j + 1 === runs.length || !glued[j])) {
				spans.add(joined);
			}
		}
	}
	return spans;
}

/**
 * Does this quote actually contain the value the model proposed?
 *
 * Numbers are compared as numbers, so `1,250.00` in the document supports `1250`.
 * What this never does is arithmetic: a quote containing `120` and `2.68` does not
 * support `321.60`, because that value was computed rather than read.
 */
export function quoteSupportsValue(quote: string, rawValue: string | number): boolean {
	const normalizedQuote = normalizeEvidenceText(quote);
	if (!normalizedQuote) return false;

	if (typeof rawValue === 'number') {
		if (!Number.isFinite(rawValue)) return false;
		return numericTokens(normalizedQuote).has(String(rawValue));
	}

	const needle = normalizeEvidenceText(rawValue);
	if (!needle) return false;

	// Where the layout put its separators cannot matter - the same tariff item is
	// printed `HSN:8505.11.10`, `9403 8900` and `94038900` - but which runs the value
	// covers must. Anything the quote spells out over whole runs is supported.
	const squashedNeedle = needle.replace(/[^a-z0-9]/g, '');
	if (squashedNeedle && runSpans(normalizedQuote).has(squashedNeedle)) return true;

	// A value the model reported as text but the document prints as a number, e.g. an
	// IGST rate of "18" inside "18%", or "1440" against a printed "1,440.00".
	const asNumber = Number(needle.replace(/[,\s]/g, ''));
	if (Number.isFinite(asNumber) && needle !== '') {
		if (numericTokens(normalizedQuote).has(String(asNumber))) return true;
	}

	return false;
}
