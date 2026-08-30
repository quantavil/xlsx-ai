import { parseTariffMatches, type TariffMatch } from './tariff';
import { normalizeRitcCode } from './duty-lookup';

/**
 * The ITC-HS master, as DGFT serves it.
 *
 * The endpoint behind their public ITC-HS lookup page takes one parameter and
 * matches it against both the code and the description text, so `9403` returns the
 * heading's children and `wall clock` returns the two tariff lines that name one.
 * No session, no key, no CORS headers - hence this server-side wrapper.
 *
 * The match is literal, not semantic. `bed linen` finds eight entries and
 * `cotton bed sheet` finds none, which is the whole reason the classifier asks a
 * model for tariff vocabulary instead of searching the invoice text directly.
 */
const DGFT_ENDPOINT =
	'https://www.dgft.gov.in/CP/webHP?requestType=ApplicationRH&actionVal=preview&screenId=90000802';

/** One slow search must not hold up an import; an empty result is survivable. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Searches in flight at once. Politeness, not throughput. */
const SEARCH_CONCURRENCY = 8;

/**
 * Results live for the process, keyed by query.
 *
 * The tariff changes by notification, so within any plausible process lifetime the
 * same query has the same answer. Several items in one shipment routinely search
 * the same words.
 *
 * ponytail: unbounded process-lifetime map, same as the duty lookup's. Give it a
 * TTL or an LRU bound if this ever runs somewhere long-lived.
 */
const cache = new Map<string, TariffMatch[]>();

/**
 * One search against the master. Throws only on a transport failure; a query the
 * schedule has no answer for is a successful search with nothing in it.
 */
export async function searchTariff(query: string): Promise<TariffMatch[]> {
	const trimmed = query.trim();
	if (trimmed.length < 2) return [];

	const cached = cache.get(trimmed);
	if (cached) return cached;

	const response = await fetch(`${DGFT_ENDPOINT}&itc-code=${encodeURIComponent(trimmed)}`, {
		method: 'POST',
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (!response.ok) throw new Error(`DGFT search returned HTTP ${response.status}`);

	// An unparseable query answers with an HTML error page rather than a status.
	const text = await response.text();
	let matches: TariffMatch[] = [];
	try {
		matches = parseTariffMatches(JSON.parse(text));
	} catch {
		matches = [];
	}

	cache.set(trimmed, matches);
	return matches;
}

/**
 * Search several queries at once, dropping the ones that fail.
 *
 * A query that cannot be reached costs its own results and nothing else: the item
 * still gets whatever the other queries found, and an item with no candidates at
 * all still gets its search box in the dialog.
 */
export async function searchTariffBatch(
	queries: readonly string[]
): Promise<Map<string, TariffMatch[]>> {
	const unique = [...new Set(queries.map((q) => q.trim()).filter((q) => q.length >= 2))];
	const results = new Map<string, TariffMatch[]>();

	// In chunks rather than all at once. A thirty-item shipment can ask a hundred
	// questions, and firing those simultaneously at a government service is both
	// rude and the fastest way to start getting refused.
	for (let i = 0; i < unique.length; i += SEARCH_CONCURRENCY) {
		const chunk = unique.slice(i, i + SEARCH_CONCURRENCY);
		const settled = await Promise.allSettled(chunk.map((q) => searchTariff(q)));
		settled.forEach((outcome, index) => {
			results.set(chunk[index], outcome.status === 'fulfilled' ? outcome.value : []);
		});
	}
	return results;
}

/**
 * Every filable code under a partial code the documents printed.
 *
 * DGFT matches a prefix against the code column, so `9403` answers with the whole
 * heading - headings, subheadings and tariff items together. Only the eight-digit
 * rows are kept, and the prefix is re-checked locally because the same parameter
 * also matches descriptions and could return an unrelated code whose text happens
 * to contain the digits.
 */
export async function searchTariffPrefix(printed: string): Promise<TariffMatch[]> {
	const digits = normalizeRitcCode(printed);
	if (digits.length < 4 || digits.length > 8) return [];

	const matches = await searchTariff(digits);
	return matches.filter((m) => m.code.length === 8 && m.code.startsWith(digits));
}
