import { json, type RequestHandler } from '@sveltejs/kit';
import { parseExchangeRates } from '$lib/modules/icegrid/exchange-rate';
import { checkIcegridAccess } from '$lib/server/guard';

/**
 * Proxy the customs exchange rate board the browser cannot read itself.
 *
 * Same reason as `/api/icegrid/duty-lookup`: the service sends no CORS headers. It
 * needs no key, no session and no body - a plain GET returns the whole board - so
 * this route takes no input and is not another action on `/api/ai`.
 */
const SOURCE = 'https://impexcube.in/Home/LoadExRate';

/** The board is one small request; a slow one must not hold up an import. */
const REQUEST_TIMEOUT_MS = 8_000;

export const GET: RequestHandler = async (event) => {
	const guard = checkIcegridAccess(event);
	if (guard) return guard;

	try {
		const response = await fetch(SOURCE, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return json({ rates: parseExchangeRates(await response.json()) });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Exchange rate lookup failed.' },
			{ status: 502 }
		);
	}
};
