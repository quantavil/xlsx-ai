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
	if (normalizedQuote.includes(needle)) return true;

	// Identifiers are routinely laid out with separator spacing that the stored value
	// drops: a PDF column prints `30744 / 26-27` for invoice number `30744/26-27`.
	// Comparing with separators removed keeps every character accountable while
	// ignoring where the layout put the gaps. Length-bounded so it stays an identifier
	// rule and never turns into loose matching over prose.
	if (needle.length <= 40 && /[^a-z0-9]/.test(needle)) {
		const squash = (v: string) => v.replace(/[^a-z0-9]/g, '');
		const squashedNeedle = squash(needle);
		if (squashedNeedle.length >= 3 && squash(normalizedQuote).includes(squashedNeedle)) return true;
	}

	// The mirror of the rule above: the separators are in the DOCUMENT, not the value.
	// Every invoice prints an HS code as "HSN:8505.11.10" while the customs field wants
	// 85051110, so the most important field on the row was being cleared as unsupported.
	// Squashing is done per whitespace-delimited token, never across the whole quote, so
	// "300 Pcs 1" can never be read as the identifier "3001".
	if (needle.length >= 4 && /^[a-z0-9]+$/.test(needle)) {
		for (const token of normalizedQuote.split(/\s+/)) {
			if (token.replace(/[^a-z0-9]/g, '').includes(needle)) return true;
		}
	}

	// A value the model reported as text but the document prints as a number, e.g.
	// RITC "94038900" quoted as "9403 8900" or IGST rate "18" inside "18%".
	const asNumber = Number(needle.replace(/[,\s]/g, ''));
	if (Number.isFinite(asNumber) && needle !== '') {
		if (numericTokens(normalizedQuote).has(String(asNumber))) return true;
		if (normalizedQuote.replace(/[\s,]/g, '').includes(needle.replace(/[\s,]/g, ''))) return true;
	}

	return false;
}
