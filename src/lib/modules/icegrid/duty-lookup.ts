import type { DropdownOption } from '$lib/types';

/**
 * One drawback schedule line as the duty-lookup service reports it.
 *
 * The service keys drawback on the four-digit heading, so every tariff item under
 * `9403` is offered the same serials. Choosing between them is a classification the
 * exporter makes, which is why this module never decides silently.
 */
export interface DutyDrawbackCandidate {
	/** Schedule serial including the Cenvat column suffix, e.g. `940301B`. */
	serial: string;
	description: string;
	rate: number | null;
	/** Specific rate / value cap. The service reports "no cap" as `0`. */
	cap: number | null;
	/** The schedule's own unit for the cap, e.g. `PCS`. Often absent. */
	unit: string | null;
	roslRate: number | null;
	roslCap: number | null;
}

/** RoDTEP Appendix 4R as the service reports it. Absent means "not in the schedule". */
export interface DutyRodtepEntry {
	description: string;
	rate: number | null;
	cap: number | null;
	/** Statistical unit prescribed for the tariff item, e.g. `KGS`. */
	uqc: string;
}

export interface DutyLookupEntry {
	ritc: string;
	drawback: DutyDrawbackCandidate[];
	/** `null` when the tariff item is absent from RoDTEP - not the same as rate zero. */
	rodtep: DutyRodtepEntry | null;
}

/** Lookups for one import run, keyed by the eight-digit RITC that produced them. */
export type DutyLookupMap = ReadonlyMap<string, DutyLookupEntry>;

/** Digits only. A tariff code is printed as `9403.20.90` about as often as `94032090`. */
export function normalizeRitcCode(value: unknown): string {
	return String(value ?? '').replace(/\D/g, '');
}

/**
 * The RITCs worth one request each.
 *
 * Deduplicated because the drawback schedule is per tariff code, not per row: a
 * forty-line shipment usually carries a handful of codes. Short codes are dropped
 * because the service has nothing to answer with.
 */
export function distinctRitcCodes(rows: readonly { RITCCode?: unknown }[]): string[] {
	const seen = new Set<string>();
	for (const row of rows) {
		const ritc = normalizeRitcCode(row.RITCCode);
		if (ritc.length === 8) seen.add(ritc);
	}
	return [...seen];
}

/**
 * The serial a row should start on, and whether that was a real answer or a guess.
 *
 * Three rules in priority order. A serial the documents actually printed wins, because
 * evidence outranks a lookup. A single candidate is not a choice at all. Anything else
 * is a classification with more than one defensible answer, so the residual "Others"
 * line is offered as a starting point and reported as `suggested` - the caller warns,
 * and a human confirms.
 */
export function selectDrawbackSerial(
	candidates: readonly DutyDrawbackCandidate[],
	extracted: unknown
): { serial: string | null; basis: 'extracted' | 'only-candidate' | 'suggested' | 'none' } {
	const printed = String(extracted ?? '').trim().toUpperCase();
	if (printed && candidates.some((c) => c.serial.toUpperCase() === printed)) {
		return { serial: printed, basis: 'extracted' };
	}
	if (printed) return { serial: printed, basis: 'extracted' };
	if (candidates.length === 0) return { serial: null, basis: 'none' };
	if (candidates.length === 1) return { serial: candidates[0].serial, basis: 'only-candidate' };

	// The residual line is the schedule's own catch-all; a more specific sub-entry is a
	// claim about the goods that only the exporter can make.
	const residual =
		candidates.find((c) => /^others?$/i.test(c.description.trim())) ??
		candidates.reduce((a, b) => (a.serial.length >= b.serial.length ? a : b));
	return { serial: residual.serial, basis: 'suggested' };
}

/**
 * Dropdown options for the whole run, each tagged with the RITC it belongs to.
 *
 * Tagging by the full eight-digit code is what makes per-row filtering free: the
 * table already narrows a dependent dropdown to options whose `parentValue` matches
 * the row's dependency cell, which is how districts are scoped to their state. Rows
 * with no tariff code match nothing and fall back to their own value, so their
 * dropdown holds exactly the serial the documents supplied.
 */
export function buildDrawbackOptions(lookups: DutyLookupMap): DropdownOption[] {
	const options: DropdownOption[] = [];
	for (const entry of lookups.values()) {
		for (const candidate of entry.drawback) {
			options.push({
				value: candidate.serial,
				label: candidate.description
					? `${candidate.serial} — ${candidate.description}`
					: candidate.serial,
				parentValue: entry.ritc
			});
		}
	}
	return options;
}
