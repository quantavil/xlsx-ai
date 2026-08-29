import type { DutyLookupEntry } from './duty-lookup';
import type { DutyLookupBatch } from './duty-lookup.server';

/**
 * Ask our own server for the duty-structure answers.
 *
 * The lookup service sends no CORS headers, so the browser cannot call it directly;
 * `/api/icegrid/duty-lookup` exists only to make the call from the server side. A
 * failure here is never fatal - the caller falls back to the bundled schedules, which
 * is what every import did before this route existed.
 */
export async function requestDutyLookups(ritcs: readonly string[]): Promise<DutyLookupBatch> {
	try {
		const response = await fetch('/api/icegrid/duty-lookup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ritcs })
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const body = (await response.json()) as { entries?: DutyLookupEntry[]; warnings?: string[] };
		return { entries: body.entries ?? [], warnings: body.warnings ?? [] };
	} catch (error) {
		return {
			entries: [],
			warnings: [
				`The live duty lookup was unreachable (${
					error instanceof Error ? error.message : 'unknown error'
				}); the bundled customs schedules were used instead.`
			]
		};
	}
}
