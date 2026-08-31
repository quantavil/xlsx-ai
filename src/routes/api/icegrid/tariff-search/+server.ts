import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { searchTariff } from '$lib/modules/icegrid/tariff.server';
import { checkIcegridAccess } from '$lib/server/guard';

/**
 * Proxy one ITC-HS search for the dialog's own search box.
 *
 * The classifier's suggestions come back with the import, but the user is the one
 * classifying and has to be able to look for their own words. DGFT sends no CORS
 * headers, so the browser cannot ask it directly. No key and no model are needed,
 * which is why this is not another action on `/api/ai`.
 */
const RequestSchema = z.object({ query: z.string().min(2).max(120) });

export const POST: RequestHandler = async (event) => {
	const guard = checkIcegridAccess(event);
	if (guard) return guard;

	const { request } = event;
	const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json({ error: 'Expected { query: string } of at least two characters.' }, { status: 400 });
	}

	try {
		return json({ matches: await searchTariff(parsed.data.query) });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Tariff search failed.' },
			{ status: 502 }
		);
	}
};
