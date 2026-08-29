import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { fetchDutyLookups } from '$lib/modules/icegrid/duty-lookup.server';

/**
 * Proxy the duty-structure lookups the browser cannot make itself.
 *
 * The service sends no CORS headers, so this exists purely to move the call
 * server-side. It needs no API key and no model, which is why it is not another
 * action on `/api/ai`: that route requires both before it will do anything.
 */

// A shipment carries a handful of distinct tariff codes. The cap is here so a
// malformed caller cannot turn one request into hundreds of outbound ones.
const MAX_CODES = 50;

const RequestSchema = z.object({
	ritcs: z.array(z.string().regex(/^\d{8}$/)).max(MAX_CODES)
});

export const POST: RequestHandler = async ({ request }) => {
	const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json({ error: 'Expected { ritcs: string[] } of eight-digit tariff codes.' }, { status: 400 });
	}

	const { entries, warnings } = await fetchDutyLookups([...new Set(parsed.data.ritcs)]);
	return json({ entries, warnings });
};
