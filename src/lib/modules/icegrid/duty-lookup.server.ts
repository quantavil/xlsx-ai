import type {
	DutyDrawbackCandidate,
	DutyLookupEntry,
	DutyRodtepEntry
} from './duty-lookup';

/**
 * Live duty-structure lookups, layered over the bundled schedules rather than
 * replacing them.
 *
 * The service renders an empty page shell to a plain GET and fills its tables from
 * two JSON POSTs, which is what this calls. It is a third party whose own disclaimer
 * says its contents carry no legal force, so every failure here is a warning and a
 * fall back to `catalogs/generated/schedules.ts`, never an import that fails.
 */
const BASE = 'https://impexcube.in/DutyStructureExport';

/** One slow tariff code must not hold up an import; the bundled schedule still answers. */
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Results live for the process, keyed by tariff code.
 *
 * The drawback schedule changes by annual notification, so within any plausible
 * process lifetime a second answer for the same code is the same answer. This also
 * means re-importing a shipment costs no requests at all.
 *
 * ponytail: unbounded process-lifetime map. Give it a TTL or an LRU bound if this
 * ever runs somewhere long-lived enough for the tariff schedule to matter.
 */
const cache = new Map<string, DutyLookupEntry>();

/** The service reports "no value" as an empty string and "no cap" as zero. */
function num(value: unknown): number | null {
	const text = String(value ?? '').trim();
	if (!text) return null;
	const n = Number(text);
	return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string {
	return String(value ?? '').trim();
}

async function post(path: string, mode: string, ritc: string): Promise<unknown[]> {
	const response = await fetch(`${BASE}/${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
		body: JSON.stringify({ RITC: ritc, Country: 'null', Mode: mode }),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
	const body: unknown = await response.json();
	return Array.isArray(body) ? body : [];
}

/**
 * A drawback row carries every column of the service's own tables, most of them null
 * for an export lookup. Only the eight the DBK table renders are read.
 */
function toCandidate(raw: Record<string, unknown>): DutyDrawbackCandidate | null {
	const serial = text(raw.ActualDBK_SERNo);
	if (!serial) return null;
	const cap = num(raw.ActualDBKSPRate);
	return {
		serial,
		description: text(raw.ActualDBK_Desc),
		rate: num(raw.ActualDBKRate),
		// A cap of zero is the service's way of saying there is no cap.
		cap: cap === 0 ? null : cap,
		unit: text(raw.ActualUnit) || null,
		roslRate: num(raw.ActualROSLRate),
		roslCap: num(raw.ActualROSLCap)
	};
}

function toRodtep(rows: unknown[]): DutyRodtepEntry | null {
	const raw = rows[0] as Record<string, unknown> | undefined;
	if (!raw) return null;
	const cap = num(raw.RoDTEPCapRate);
	return {
		description: text(raw.RoDTEPDesc),
		rate: num(raw.RoDTEPRatePer),
		cap: cap === 0 ? null : cap,
		uqc: text(raw.RoDTEPUQC)
	};
}

/**
 * Look up one tariff code. Throws only on a transport failure, which the caller
 * turns into a warning; an unknown code is a successful lookup with nothing in it.
 */
export async function fetchDutyLookup(ritc: string): Promise<DutyLookupEntry> {
	const cached = cache.get(ritc);
	if (cached) return cached;

	const [dbkRows, rodtepRows] = await Promise.all([
		post('FillDBK', 'DBK', ritc),
		post('GetDetails', 'RODEP', ritc)
	]);

	const entry: DutyLookupEntry = {
		ritc,
		drawback: dbkRows
			.map((row) => toCandidate(row as Record<string, unknown>))
			.filter((c): c is DutyDrawbackCandidate => c !== null),
		rodtep: toRodtep(rodtepRows)
	};
	cache.set(ritc, entry);
	return entry;
}

export interface DutyLookupBatch {
	entries: DutyLookupEntry[];
	/** One line per tariff code that could not be reached, for the run's warnings. */
	warnings: string[];
}

/**
 * Look up every tariff code in a run.
 *
 * Failures are per code and never collective: a code the service cannot answer for
 * simply has no entry, the row falls back to the bundled schedule, and the run says
 * so. Requests go out together because there are only ever a handful.
 */
export async function fetchDutyLookups(ritcs: readonly string[]): Promise<DutyLookupBatch> {
	const settled = await Promise.allSettled(ritcs.map((ritc) => fetchDutyLookup(ritc)));

	const entries: DutyLookupEntry[] = [];
	const warnings: string[] = [];
	settled.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			entries.push(result.value);
		} else {
			warnings.push(
				`RITC ${ritcs[index]}: live duty lookup failed (${
					result.reason instanceof Error ? result.reason.message : 'unknown error'
				}); the bundled schedule was used instead.`
			);
		}
	});
	return { entries, warnings };
}
