import type { IcegridCatalogSnapshot } from '../catalogs/types';
import type { IcegridRow } from '../schema';

const isBlank = (v: unknown) => v === null || v === undefined || v === '';

/** GSTIN's first two digits are the GST/ICEGATE state code: `09AALFG9236H1ZZ` -> `09`. */
export function stateCodeFromGstin(text: string): string | null {
	const match = text.match(/\b(\d{2})[A-Z]{5}\d{4}[A-Z][0-9A-Z]{3}\b/);
	return match ? match[1] : null;
}

export interface DocumentGeoResolution {
	stateCode: string | null;
	districtCode: string | null;
	countryCode: string | null;
}

/** Common acronyms / aliases mapped to ISO 3166-1 alpha-2 codes. */
const COMMON_COUNTRY_ALIASES: Record<string, string> = {
	USA: 'US',
	'U.S.A.': 'US',
	'UNITED STATES OF AMERICA': 'US',
	UK: 'GB',
	'U.K.': 'GB',
	ENGLAND: 'GB',
	UAE: 'AE',
	'U.A.E.': 'AE',
	DUBAI: 'AE',
	RUSSIA: 'RU',
	HOLLAND: 'NL',
	NETHERLANDS: 'NL',
	GERMANY: 'DE',
	DEUTSCHLAND: 'DE'
};

/**
 * Normalizes and matches raw country text to an ISO 3166-1 alpha-2 code from the catalog.
 */
export function resolveCountryCode(
	raw: string | null | undefined,
	catalogs: IcegridCatalogSnapshot
): string | null {
	if (!raw) return null;
	const clean = raw.trim().toUpperCase().replace(/[^A-Z\s.]/g, '').trim();
	if (!clean) return null;

	if (COMMON_COUNTRY_ALIASES[clean]) {
		return COMMON_COUNTRY_ALIASES[clean];
	}

	// Check if any known alias exists as a distinct token (e.g. "JEBEL ALI UAE")
	for (const [alias, code] of Object.entries(COMMON_COUNTRY_ALIASES)) {
		const escaped = alias.replace(/\./g, '\\.');
		if (new RegExp(`\\b${escaped}\\b`, 'i').test(clean)) {
			return code;
		}
	}

	// Direct match against 2-letter value
	const direct = catalogs.country.find((c) => c.value === clean);
	if (direct) return direct.value;

	// Exact match against country label
	const byLabel = catalogs.country.find((c) => c.label?.toUpperCase() === clean);
	if (byLabel) return byLabel.value;

	// Substring / word boundary match in label
	const partial = catalogs.country.find(
		(c) => c.label && new RegExp(`\\b${c.label.toUpperCase()}\\b`, 'i').test(clean)
	);
	if (partial) return partial.value;

	// If comma-separated, check last segment (e.g. "JEBEL ALI, UAE" -> "UAE")
	if (raw.includes(',')) {
		const parts = raw.split(',');
		const last = parts[parts.length - 1].trim();
		if (last && last !== raw) {
			const fromLast = resolveCountryCode(last, catalogs);
			if (fromLast) return fromLast;
		}
	}

	return null;
}

/**
 * Rule 5: Scans Exporter / Seller Address for State code and District code.
 *
 * 1. Checks GSTIN for 2-digit state code.
 * 2. If absent, searches seller/exporter address block against STATE_OPTIONS.
 * 3. Once state is known, searches DISTRICT_OPTIONS scoped strictly to parentValue === stateCode.
 */
export function scanSellerOrigin(
	sourceText: string,
	catalogs: IcegridCatalogSnapshot
): { stateCode: string | null; districtCode: string | null } {
	let stateCode = stateCodeFromGstin(sourceText);

	// If no GSTIN, search for state names in seller/exporter block or whole source
	if (!stateCode && sourceText) {
		const upper = sourceText.toUpperCase();
		for (const state of catalogs.state) {
			if (!state.label) continue;
			const pattern = new RegExp(`\\b${state.label.toUpperCase()}\\b`);
			if (pattern.test(upper)) {
				stateCode = state.value;
				break;
			}
		}
	}

	let districtCode: string | null = null;
	if (stateCode && catalogs.district && catalogs.district.length > 0) {
		const upper = sourceText.toUpperCase();
		// Strictly scope districts to this state
		const scoped = catalogs.district.filter((d) => d.parentValue === stateCode);
		// Sort longer names first to avoid prefix collisions
		const sorted = [...scoped].sort((a, b) => (b.label?.length ?? 0) - (a.label?.length ?? 0));

		for (const dist of sorted) {
			if (!dist.label || dist.label.length < 3) continue;
			const pattern = new RegExp(`\\b${dist.label.toUpperCase()}\\b`);
			if (pattern.test(upper)) {
				districtCode = dist.value;
				break;
			}
		}
	}

	return { stateCode, districtCode };
}

/**
 * Rule 6: Resolves CountryDestination via 3-tier hierarchy:
 *
 * 1. Invoice Final Destination / Country of Final Destination
 * 2. Port of Discharge country
 * 3. Consignee / Buyer country
 */
export function scanCountryDestination(
	sourceText: string,
	catalogs: IcegridCatalogSnapshot
): string | null {
	if (!sourceText) return null;

	// 1. Final Destination
	const finalMatch = sourceText.match(
		/(?:final\s+destination|country\s+of\s+final\s+destination|place\s+of\s+delivery)\s*[:=-]?\s*([^\n\r;]+)/i
	);
	if (finalMatch && finalMatch[1]) {
		const code = resolveCountryCode(finalMatch[1], catalogs);
		if (code) return code;
	}

	// 2. Port of Discharge
	const podMatch = sourceText.match(/(?:port\s+of\s+discharge)\s*[:=-]?\s*([^\n\r;]+)/i);
	if (podMatch && podMatch[1]) {
		const code = resolveCountryCode(podMatch[1], catalogs);
		if (code) return code;
	}

	// 3. Consignee / Buyer
	const consigneeMatch = sourceText.match(
		/(?:consignee|buyer)\b[\s\S]{1,400}?(?:country\s*[:=-]?\s*([A-Za-z\s]+)|,\s*([A-Za-z\s]{2,30})\s*(?:\n|$))/i
	);
	if (consigneeMatch) {
		const candidate = consigneeMatch[1] || consigneeMatch[2];
		if (candidate) {
			const code = resolveCountryCode(candidate, catalogs);
			if (code) return code;
		}
	}

	return null;
}

/**
 * Scans document text for all geographic constants (State, District, Country).
 */
export function scanDocumentGeography(
	sourceText: string,
	catalogs: IcegridCatalogSnapshot
): DocumentGeoResolution {
	const { stateCode, districtCode } = scanSellerOrigin(sourceText, catalogs);
	const countryCode = scanCountryDestination(sourceText, catalogs);

	return { stateCode, districtCode, countryCode };
}

/**
 * Applies resolved geographic defaults to an individual row if not already populated.
 */
export function applyGeographyRules(
	row: IcegridRow,
	geo: DocumentGeoResolution
): void {
	if (isBlank(row.StateOrigin) && geo.stateCode) {
		row.StateOrigin = geo.stateCode;
	}
	if (isBlank(row.DistrictOrigin) && geo.districtCode) {
		row.DistrictOrigin = geo.districtCode;
	}
	if (isBlank(row.CountryDestination) && geo.countryCode) {
		row.CountryDestination = geo.countryCode;
	}
}
