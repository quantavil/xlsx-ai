import { ICEGRID_COLUMNS } from './columns';
import { resolveCatalogValue } from './catalogs';
import type { IcegridCatalogSnapshot } from './catalogs/types';
import { lookupDrawback, lookupRodtep, uqcToUnit } from './catalogs/generated/schedules';
import { SCHEDULES_PROVENANCE } from './catalogs/generated/provenance';
import { EMPTY_PROFILE, PROFILE_FIELD_HEADERS, type IcegridProfile } from './profile';
import type { IcegridRow } from './schema';

/**
 * How a populated cell came to be filled. Extracted values were already gated on a
 * verbatim source quote by `sanitize.ts`; everything added here records which of the
 * other two routes produced it so the user can tell an invoice figure from a
 * schedule lookup from a formula.
 */
export type Provenance = 'extracted' | 'schedule' | 'derived' | 'profile';

export type ProvenanceMap = Record<string, Record<string, Provenance>>;

export interface DerivationResult {
	rows: IcegridRow[];
	warnings: string[];
	provenance: ProvenanceMap;
	/** Counts per provenance, for the one-line run summary. */
	filled: Record<Provenance, number>;
}

const NUMERIC = new Set(
	ICEGRID_COLUMNS.filter((c) => c.type === 'number' || c.type === 'currency').map((c) => c.header)
);

const blank = (v: unknown) => v === null || v === undefined || v === '';

/** GSTIN's first two digits are the GST/ICEGATE state code: `09AALFG9236H1ZZ` -> `09`. */
export function stateCodeFromGstin(text: string): string | null {
	const match = text.match(/\b(\d{2})[A-Z]{5}\d{4}[A-Z][0-9A-Z]{3}\b/);
	return match ? match[1] : null;
}

export interface DeriveOptions {
	profile?: IcegridProfile;
	catalogs: IcegridCatalogSnapshot;
	/** Combined extracted text of the selected files, used only for the GSTIN scan. */
	sourceText?: string;
	/** Exchange rate read off the invoice, which takes precedence over the profile. */
	documentExchangeRate?: number | null;
}

/**
 * Fill everything the sources did not state but that follows from them.
 *
 * Three routes, applied in order and never overwriting a value the document already
 * supported: schedule lookups keyed by RITC, arithmetic and copy rules confirmed
 * against every row of the reference corpus, and the exporter's saved profile. Each
 * write is recorded in `provenance` so the UI can show why a cell is filled, and
 * anything uncertain adds a warning rather than being asserted silently.
 */
export function deriveRows(rows: readonly IcegridRow[], options: DeriveOptions): DerivationResult {
	const { catalogs, profile = EMPTY_PROFILE, sourceText = '', documentExchangeRate = null } = options;

	const warnings: string[] = [];
	const provenance: ProvenanceMap = {};
	const filled: Record<Provenance, number> = { extracted: 0, schedule: 0, derived: 0, profile: 0 };

	const gstinState = sourceText ? stateCodeFromGstin(sourceText) : null;
	const exchangeRate = documentExchangeRate ?? profile.exchangeRate ?? null;
	let residualDrawbackRows = 0;
	let sampleAlternatives: string[] = [];

	const out = rows.map((source, index) => {
		const row: IcegridRow = { ...source };
		const rowId = `r${index + 1}`;
		const marks: Record<string, Provenance> = {};
		const rowNo = index + 1;
		const label = `Row ${rowNo}${row.InvoiceNo ? ` (${row.InvoiceNo})` : ''}`;

		const set = (header: keyof IcegridRow, value: unknown, how: Provenance) => {
			if (!blank(row[header]) || blank(value)) return;
			(row as Record<string, unknown>)[header] = value;
			marks[header as string] = how;
			filled[how]++;
		};

		for (const header of Object.keys(source)) {
			if (!blank((source as Record<string, unknown>)[header])) {
				marks[header] = 'extracted';
				filled.extracted++;
			}
		}

		// ---- 1. Schedule lookups, keyed by the tariff code ------------------------
		const ritc = String(row.RITCCode ?? '').replace(/\D/g, '');
		if (ritc.length === 8) {
			const rodtep = lookupRodtep(ritc);
			if (rodtep) {
				set('RODTEP', 'Yes', 'schedule');
				const unit = uqcToUnit(rodtep.uqc);
				if (unit) set('SQCUnit', unit, 'schedule');
			} else {
				set('RODTEP', 'No', 'schedule');
			}

			const drawback = lookupDrawback(ritc);
			if (drawback) {
				set('drawback_schno', drawback.schno, 'schedule');
				set('dbk_rate', drawback.rate, 'schedule');
				if (drawback.residual && drawback.alternatives.length > 0) {
					residualDrawbackRows++;
					if (sampleAlternatives.length === 0) sampleAlternatives = drawback.alternatives;
				}
			}
		} else if (!blank(row.RITCCode)) {
			warnings.push(`${label}: RITC "${row.RITCCode}" is not 8 digits, so no schedule lookup was possible.`);
		}

		// ---- 2. Deterministic derivations ----------------------------------------
		// Each of these held on every row of the 17-shipment reference corpus.
		set('PerUnit', row.QuantityUnit, 'derived');
		set('dbk_unit', row.QuantityUnit, 'derived');
		set('dbk_qty', row.Quantity, 'derived');

		// The SQC quantity equals the invoiced quantity only when both are counted in
		// the same unit; when the tariff counts in KGS it is the packing-list weight,
		// which cannot be computed and stays blank.
		if (blank(row.SQCQTY) && !blank(row.SQCUnit) && row.SQCUnit === row.QuantityUnit) {
			set('SQCQTY', row.Quantity, 'derived');
		}
		// RoDTEP quantity tracks the SQC quantity, not the invoiced quantity.
		set('RoDTEPQty', row.SQCQTY, 'derived');

		if (gstinState) set('StateOrigin', gstinState, 'derived');

		// ---- 3. Exporter profile --------------------------------------------------
		for (const [field, header] of Object.entries(PROFILE_FIELD_HEADERS)) {
			const value = profile[field as keyof IcegridProfile];
			if (typeof value === 'string' && value.trim()) set(header as keyof IcegridRow, value.trim(), 'profile');
		}

		// ---- 4. Tax arithmetic ----------------------------------------------------
		// Under LUT no IGST is paid, so the assessable value and tax are zero. When
		// IGST is paid the taxable value is the invoice amount at the customs rate.
		if (row.IGST_PaymentStatus === 'LUT') {
			set('IGST_Rate', 0, 'derived');
			set('Taxable_Value', 0, 'derived');
			set('IGST_Amount', 0, 'derived');
		} else if (!blank(row.ProductAmount) && exchangeRate) {
			set('Taxable_Value', round2(Number(row.ProductAmount) * exchangeRate), 'derived');
		}

		if (blank(row.IGST_Amount) && !blank(row.Taxable_Value) && !blank(row.IGST_Rate)) {
			set('IGST_Amount', round2((Number(row.Taxable_Value) * Number(row.IGST_Rate)) / 100), 'derived');
		}

		// ---- 5. Catalog normalization of anything just written --------------------
		for (const col of ICEGRID_COLUMNS) {
			if (!col.catalog) continue;
			const value = row[col.header as keyof IcegridRow];
			if (typeof value !== 'string' || !value) continue;
			if (marks[col.header] === 'extracted') continue;
			if (col.catalog === 'district' && catalogs.district.length === 0) continue;

			const resolution = resolveCatalogValue(value, catalogs[col.catalog], {
				...(col.dependsOn ? { parentValue: row[col.dependsOn as keyof IcegridRow] as string | null } : {}),
				allowNumericPrefix: col.catalog === 'scheme'
			});
			if (resolution.status === 'resolved') {
				(row as Record<string, unknown>)[col.header] = resolution.value;
			} else {
				(row as Record<string, unknown>)[col.header] = null;
				delete marks[col.header];
				warnings.push(`${label}: ${col.header} "${value}" is not a known option and was cleared.`);
			}
		}

		for (const header of NUMERIC) {
			const value = row[header as keyof IcegridRow];
			if (typeof value === 'string' && value.trim() !== '') {
				const n = Number(value.replace(/[^0-9.-]/g, ''));
				(row as Record<string, unknown>)[header] = Number.isFinite(n) ? n : null;
			}
		}

		provenance[rowId] = marks;
		return row;
	});

	if (residualDrawbackRows > 0) {
		warnings.push(
			`Drawback serial taken from the residual "Others" entry for ${residualDrawbackRows} row(s). ` +
				`If the goods match a specific schedule line, change it${sampleAlternatives.length ? ` (also under this heading: ${sampleAlternatives.slice(0, 4).join(', ')})` : ''}.`
		);
	}
	if (filled.schedule > 0) {
		warnings.push(
			`Schedule values are from ${SCHEDULES_PROVENANCE.drawback.notification} and RoDTEP ${SCHEDULES_PROVENANCE.rodtep.notification}. Verify against the current notification before filing.`
		);
	}
	if (!exchangeRate && out.some((r) => blank(r.Taxable_Value) && r.IGST_PaymentStatus !== 'LUT')) {
		warnings.push(
			'Taxable_Value was left blank: no exchange rate was found on the documents or set in the ICEGrid profile.'
		);
	}

	return { rows: out, warnings, provenance, filled };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `EXCHANGE RATE : 93.60` and similar, taken only from the extracted document text. */
export function findExchangeRate(sourceText: string): number | null {
	const match = sourceText.match(
		/(?:exchange|conversion)\s*rate\s*(?:@|:|-)?\s*(?:INR|Rs\.?|USD)?\s*[:\s]\s*(\d{1,4}(?:\.\d{1,4})?)/i
	);
	if (!match) return null;
	const value = Number(match[1]);
	// Plausible INR-per-unit band; anything outside it is a mis-read of the layout.
	return Number.isFinite(value) && value > 20 && value < 500 ? value : null;
}
