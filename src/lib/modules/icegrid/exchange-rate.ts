/**
 * Customs exchange rates, as `impexcube.in/Home/LoadExRate` publishes them.
 *
 * The endpoint answers a plain GET with the whole board - every currency, both
 * sides - so one request covers a run no matter which currency the invoice is in.
 * Exports are converted at the *export* column; the import column is the other
 * direction of the same notification and would overstate every taxable value.
 */
export interface ExchangeRate {
	/** ISO-ish three-letter code as the service spells it, e.g. `USD`. */
	code: string;
	/** The service's own name for the currency, e.g. `US DOLLARS`. */
	name: string;
	/** INR per one unit of the currency, export side. */
	exportRate: number;
}

export interface ExchangeRateBatch {
	rates: ExchangeRate[];
	/** One line for the run's warnings when the board could not be reached. */
	warnings: string[];
}

/** Rates arrive as strings and the board carries entries with no usable rate. */
export function parseExchangeRates(body: unknown): ExchangeRate[] {
	if (!Array.isArray(body)) return [];

	const rates: ExchangeRate[] = [];
	for (const raw of body) {
		const row = (raw ?? {}) as Record<string, unknown>;
		const code = String(row.CurrencyCode ?? '').trim().toUpperCase();
		const value = Number(String(row.Export ?? '').trim());
		if (!/^[A-Z]{3}$/.test(code) || !Number.isFinite(value) || value <= 0) continue;
		rates.push({ code, name: String(row.CurrencyName ?? '').trim(), exportRate: value });
	}
	return rates;
}

/** `$` and friends, for an invoice that prints a symbol and never the code. */
const CURRENCY_SYMBOLS: ReadonlyArray<readonly [string, string]> = [
	['$', 'USD'],
	['€', 'EUR'],
	['£', 'GBP'],
	['¥', 'JPY'],
	['₹', 'INR']
];

/**
 * The currency the documents are written in.
 *
 * A printed three-letter code wins over a symbol, because `$` is ambiguous across
 * four of the board's currencies and `USD` is not. Only codes the board actually
 * carries count, so ordinary words and unit codes cannot be mistaken for one.
 * INR is excluded from the code scan: an Indian exporter's own address, GSTIN
 * block and rupee totals mention it on every document without the goods being
 * invoiced in it.
 */
export function detectInvoiceCurrency(
	text: string,
	rates: readonly ExchangeRate[]
): string | null {
	const known = new Set(rates.map((r) => r.code));
	known.delete('INR');

	const counts = new Map<string, number>();
	for (const match of text.toUpperCase().matchAll(/\b[A-Z]{3}\b/g)) {
		if (known.has(match[0])) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
	}

	let best: string | null = null;
	for (const [code, count] of counts) {
		if (best === null || count > counts.get(best)!) best = code;
	}
	if (best) return best;

	for (const [symbol, code] of CURRENCY_SYMBOLS) {
		if (text.includes(symbol)) return code;
	}
	return null;
}

/** The board's rate for one currency, or null when it does not list it. */
export function rateFor(
	rates: readonly ExchangeRate[],
	code: string | null
): number | null {
	if (!code) return null;
	return rates.find((r) => r.code === code)?.exportRate ?? null;
}

/**
 * Ask our own server for the board.
 *
 * The service sends no CORS headers, same as the duty lookup, so the browser
 * cannot read it directly. A failure is never fatal: the run falls back to any
 * rate the invoice itself printed, and says so.
 */
export async function requestExchangeRates(): Promise<ExchangeRateBatch> {
	try {
		const response = await fetch('/api/icegrid/exchange-rate');
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const body = (await response.json()) as { rates?: ExchangeRate[] };
		return { rates: body.rates ?? [], warnings: [] };
	} catch (error) {
		return {
			rates: [],
			warnings: [
				`The customs exchange rate board was unreachable (${
					error instanceof Error ? error.message : 'unknown error'
				}); only a rate printed on the documents or typed by hand was available.`
			]
		};
	}
}
