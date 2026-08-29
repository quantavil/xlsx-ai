import { MAX_LOOKUP_CODES, type DutyLookupBatch, type DutyLookupEntry } from './duty-lookup';

/**
 * Ask our own server for the duty-structure answers.
 *
 * The lookup service sends no CORS headers, so the browser cannot call it directly;
 * `/api/icegrid/duty-lookup` exists only to make the call from the server side. A
 * failure here is never fatal - the caller falls back to the bundled schedules, which
 * is what every import did before this route existed.
 */
export async function requestDutyLookups(ritcs: readonly string[]): Promise<DutyLookupBatch> {
	// Trim here rather than letting the route reject the batch: one code over the cap
	// would otherwise cost every lookup in the run.
	const asked = ritcs.slice(0, MAX_LOOKUP_CODES);
	const trimmed =
		ritcs.length > asked.length
			? [
					`This import carries ${ritcs.length} tariff codes; only the first ${MAX_LOOKUP_CODES} were looked up live. The rest used the bundled customs schedules.`
				]
			: [];

	try {
		const response = await fetch('/api/icegrid/duty-lookup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ritcs: asked })
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const body = (await response.json()) as { entries?: DutyLookupEntry[]; warnings?: string[] };
		return { entries: body.entries ?? [], warnings: [...trimmed, ...(body.warnings ?? [])] };
	} catch (error) {
		return {
			entries: [],
			warnings: [
				...trimmed,
				`The live duty lookup was unreachable (${
					error instanceof Error ? error.message : 'unknown error'
				}); the bundled customs schedules were used instead.`
			]
		};
	}
}
