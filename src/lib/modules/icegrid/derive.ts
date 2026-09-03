import { ICEGRID_COLUMNS } from './columns';
import { resolveCatalogValue } from './catalogs';
import type { IcegridCatalogSnapshot } from './catalogs/types';
import { lookupDrawback, lookupRodtep, uqcToUnit } from './catalogs/generated/schedules';
import { SCHEDULES_PROVENANCE } from './catalogs/generated/provenance';
import { EMPTY_PROFILE, PROFILE_FIELD_HEADERS, type IcegridProfile } from './profile';
import type { IcegridRow } from './schema';
import {
	normalizeRitcCode,
	sameSerial,
	selectDrawbackSerial,
	type DutyLookupMap
} from './duty-lookup';
import {
	applySchemeRules,
	applyQuantityRules,
	applyTaxRules,
	applyGeographyRules,
	scanDocumentGeography,
	isDrawbackScheme,
	isFreeShippingBill,
	stateCodeFromGstin,
	findExchangeRate
} from './rules';

export { stateCodeFromGstin, findExchangeRate };

/**
 * How a populated cell came to be filled. Extracted values were already gated on a
 * verbatim source quote by `sanitize.ts`; everything added here records which of the
 * other two routes produced it so the user can tell an invoice figure from a
 * schedule lookup from a formula.
 */
export type Provenance = 'extracted' | 'schedule' | 'derived' | 'profile' | 'lookup';

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

export interface DeriveOptions {
	profile?: IcegridProfile;
	catalogs: IcegridCatalogSnapshot;
	/** Combined extracted text of the selected files, used for GSTIN and address scans. */
	sourceText?: string;
	/**
	 * INR per unit of the invoice currency, confirmed by the filer.
	 */
	exchangeRate?: number | null;
	/**
	 * Live duty-structure answers keyed by RITC.
	 */
	lookups?: DutyLookupMap;
}

/**
 * Fill everything the sources did not state but that follows from them.
 *
 * Orchestrates customs filing rules:
 * 1. Document-level geography extraction (GSTIN, seller address state/district, country hierarchy)
 * 2. RITC schedule lookups (RoDTEP, Drawback)
 * 3. Scheme & Incentive rules (Rule 0 Drawback scheme gating, Rule 3 Free Shipping Bill, Rule 2 RoDTEP)
 * 4. Quantity and Formula rules (Rule 1 SQCQTY =M2, Rule 4 dbk_qty =O2, RoDTEPQty =O2)
 * 5. Exporter profile defaults
 * 6. Tax arithmetic (LUT zeroing, IGST calculations)
 * 7. Catalog normalization
 */
export function deriveRows(rows: readonly IcegridRow[], options: DeriveOptions): DerivationResult {
	const {
		catalogs,
		profile = EMPTY_PROFILE,
		sourceText = '',
		exchangeRate = null,
		lookups
	} = options;

	const warnings: string[] = [];
	const provenance: ProvenanceMap = {};
	const filled: Record<Provenance, number> = {
		extracted: 0,
		schedule: 0,
		derived: 0,
		profile: 0,
		lookup: 0
	};

	// 1. Scan document-level geography once from sourceText (Rules 5 & 6)
	const geo = scanDocumentGeography(sourceText, catalogs);

	let residualDrawbackRows = 0;
	let missingNetWeightRows = 0;
	let sampleAlternatives: string[] = [];

	const out = rows.map((source, index) => {
		const row: IcegridRow = { ...source };
		const rowId = `r${index + 1}`;
		const marks: Record<string, Provenance> = {};
		const rowNo = index + 1;
		const excelRowIndex = index + 2; // Data rows start at Excel row 2
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

		// Scheme eligibility: if scheme code is provided, strictly gate; if unspecified, allow tentatively
		const isDbk = !row.ApplicableExpSchemes || isDrawbackScheme(row.ApplicableExpSchemes);

		// ---- 1. Schedule lookups, keyed by the tariff code ------------------------
		const ritc = normalizeRitcCode(row.RITCCode);
		const live = lookups?.get(ritc);
		let hasRodtepSchedule = false;

		if (ritc.length === 8) {
			const rodtep = live ? live.rodtep : lookupRodtep(ritc);
			hasRodtepSchedule = !!rodtep;
			if (rodtep) {
				const unit = uqcToUnit(rodtep.uqc);
				if (unit) set('SQCUnit', unit, live ? 'lookup' : 'schedule');
			}

			// Drawback is only populated if the export scheme is a Drawback scheme (Rule 0)
			if (isDbk) {
				if (live && live.drawback.length > 0) {
					const choice = selectDrawbackSerial(live.drawback, row.drawback_schno);
					if (choice.serial) set('drawback_schno', choice.serial, 'lookup');
					if (choice.basis === 'suggested') {
						residualDrawbackRows++;
						if (sampleAlternatives.length === 0) {
							sampleAlternatives = live.drawback.map((c) => c.serial);
						}
					}

					const chosen = live.drawback.find((c) => sameSerial(c.serial, row.drawback_schno));
					if (chosen) {
						set('dbk_rate', chosen.rate, 'lookup');
						set('dbk_desc', chosen.description, 'lookup');
						set('ROSLRate', chosen.roslRate, 'lookup');
						set('ROSLCapValue', chosen.roslCap, 'lookup');
						if (chosen.unit) set('dbk_unit', chosen.unit, 'lookup');
					} else if (!blank(row.drawback_schno)) {
						warnings.push(
							`${label}: drawback serial "${row.drawback_schno}" is not one the duty lookup lists for RITC ${ritc}, so its rate, description and unit were left blank.`
						);
					}
				} else {
					const drawback = lookupDrawback(ritc);
					if (drawback) {
						set('drawback_schno', drawback.schno, 'schedule');
						set('dbk_rate', drawback.rate, 'schedule');
						if (drawback.residual && drawback.alternatives.length > 0) {
							residualDrawbackRows++;
							if (sampleAlternatives.length === 0) sampleAlternatives = drawback.alternatives;
						}
					}
				}
			}
		} else if (!blank(row.RITCCode)) {
			warnings.push(`${label}: RITC "${row.RITCCode}" is not 8 digits, so no schedule lookup was possible.`);
		}

		// ---- 2. Apply scheme & incentive rules (Rules 0, 2, 3) ---------------------
		applySchemeRules(row, hasRodtepSchedule, isDbk);
		if (row.RewardItem && !marks.RewardItem) {
			marks.RewardItem = 'derived';
			filled.derived++;
		}
		if (row.RODTEP && !marks.RODTEP) {
			marks.RODTEP = 'derived';
			filled.derived++;
		}

		// ---- 3. Deterministic derivations & formulas (Rules 1 & 4) ----------------
		set('PerUnit', row.QuantityUnit, 'derived');
		if (isDbk) {
			set('dbk_unit', row.QuantityUnit, 'derived');
		}

		applyQuantityRules(row, excelRowIndex, isDbk);
		if (!blank(row.SQCQTY) && !marks.SQCQTY) {
			marks.SQCQTY = 'derived';
			filled.derived++;
		}
		if (!blank(row.dbk_qty) && !marks.dbk_qty) {
			marks.dbk_qty = 'derived';
			filled.derived++;
		}
		if (!blank(row.RoDTEPQty) && !marks.RoDTEPQty) {
			marks.RoDTEPQty = 'derived';
			filled.derived++;
		}

		if (row.SQCUnit === 'KGS' && blank(row.NetWeight) && blank(row.SQCQTY)) {
			missingNetWeightRows++;
		}

		// ---- 4. Geography rules (Rules 5 & 6) --------------------------------------
		applyGeographyRules(row, geo);
		if (row.StateOrigin && !marks.StateOrigin) {
			marks.StateOrigin = 'derived';
			filled.derived++;
		}
		if (row.DistrictOrigin && !marks.DistrictOrigin) {
			marks.DistrictOrigin = 'derived';
			filled.derived++;
		}
		if (row.CountryDestination && !marks.CountryDestination) {
			marks.CountryDestination = 'derived';
			filled.derived++;
		}

		// ---- 5. Exporter profile --------------------------------------------------
		for (const [field, header] of Object.entries(PROFILE_FIELD_HEADERS)) {
			const value = profile[field as keyof IcegridProfile];
			if (typeof value === 'string' && value.trim()) set(header as keyof IcegridRow, value.trim(), 'profile');
		}

		// ---- 6. Tax arithmetic rules ----------------------------------------------
		const taxResult = applyTaxRules(row, exchangeRate, label);
		warnings.push(...taxResult.warnings);
		if (!blank(row.Taxable_Value) && !marks.Taxable_Value) {
			marks.Taxable_Value = 'derived';
			filled.derived++;
		}
		if (!blank(row.IGST_Amount) && !marks.IGST_Amount) {
			marks.IGST_Amount = 'derived';
			filled.derived++;
		}
		if (row.IGST_Rate !== null && row.IGST_Rate !== undefined && !marks.IGST_Rate) {
			marks.IGST_Rate = 'derived';
			filled.derived++;
		}

		// ---- 7. Catalog normalization of anything just written --------------------
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

		// Numeric sanitization, preserving formula strings starting with '='
		for (const header of NUMERIC) {
			const value = row[header as keyof IcegridRow];
			if (typeof value === 'string' && value.startsWith('=')) {
				continue;
			}
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
	if (missingNetWeightRows > 0) {
		warnings.push(
			`SQCQTY was left blank on ${missingNetWeightRows} row(s): the tariff counts them in KGS and no per-line net weight was found on the documents.`
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
