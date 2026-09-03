import type { IcegridRow } from '../schema';

/**
 * Scheme codes eligible for Duty Drawback under Indian Customs:
 * 19, 41, 42, 43, 44, 46, 47, 48, 49, 60, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 79.
 */
export const DRAWBACK_SCHEME_CODES = new Set([
	'19',
	'41',
	'42',
	'43',
	'44',
	'46',
	'47',
	'48',
	'49',
	'60',
	'61',
	'62',
	'63',
	'64',
	'65',
	'71',
	'72',
	'73',
	'74',
	'75',
	'79'
]);

/** Extracts two-digit numeric scheme code from strings like "19-Drawback (DBK)" or "00". */
export function parseSchemeCode(scheme: unknown): string | null {
	if (typeof scheme === 'string') {
		const match = scheme.trim().match(/^(\d{2})/);
		return match ? match[1] : null;
	}
	if (typeof scheme === 'number') {
		return String(scheme).padStart(2, '0');
	}
	return null;
}

export function isDrawbackScheme(scheme: unknown): boolean {
	const code = parseSchemeCode(scheme);
	return code !== null && DRAWBACK_SCHEME_CODES.has(code);
}

export function isFreeShippingBill(scheme: unknown): boolean {
	const code = parseSchemeCode(scheme);
	return code === '00';
}

import { isBlank } from '$lib/table/cells';

/**
 * Applies customs scheme eligibility and incentive gating.
 *
 * 1. Non-drawback schemes (including Scheme 00 - Free Shipping Bill):
 *    - Col U (drawback_schno), Col V (dbk_qty), Col W (dbk_rate), Col X (dbk_unit) are left empty.
 *    - Col I (RewardItem) and Col AJ (RODTEP) can be selected by user or detected from documents.
 *    - If Col AJ (RODTEP) is unassigned/blank, fills 'Yes' if found in schedule, else 'N/A'.
 * 2. Drawback schemes:
 *    - Retains drawback details.
 *    - If Col AJ (RODTEP) is unassigned/blank, fills 'Yes' if found in schedule, else 'N/A'.
 */
export function applySchemeRules(
	row: IcegridRow,
	hasRodtepSchedule: boolean,
	isDrawbackEligible: boolean
): void {
	if (!isDrawbackEligible) {
		clearDrawbackFields(row);
	}

	if (isBlank(row.RODTEP)) {
		row.RODTEP = hasRodtepSchedule ? 'Yes' : 'N/A';
	}
}

export function clearDrawbackFields(row: IcegridRow): void {
	row.drawback_schno = null;
	row.dbk_qty = null;
	row.dbk_rate = null;
	row.dbk_unit = null;
	row.dbk_desc = null;
}
