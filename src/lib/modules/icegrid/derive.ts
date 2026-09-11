import { ICEGRID_COLUMNS, isIcegridTable } from './columns';
import { isBlank } from '$lib/table/cells';
import type { Row, Column, CellValue, DropdownOption } from '$lib/types';
import type { CellPatch } from '$lib/table/commands';
import { resolveCatalogValue } from './catalogs';
import type { IcegridCatalogSnapshot } from './catalogs/types';
import { lookupDrawback, lookupRodtep, uqcToUnit, type DrawbackEntry } from './catalogs/generated/schedules';
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
	stateCodeFromGstin,
	findExchangeRate,
	deriveSqcQty,
	deriveDbkQty,
	deriveRodtepQty
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

const blank = isBlank;

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
						if (chosen.unit && chosen.unit.trim()) {
							set('dbk_unit', chosen.unit.trim(), 'lookup');
						}
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

export function ensureDrawbackDropdownOptions(
	options: DropdownOption[],
	ritc: string,
	entry: DrawbackEntry
): void {
	const normRitc = normalizeRitcCode(ritc);
	const seen = new Set(options.map((o) => `${o.parentValue ?? ''}::${o.value.trim().toUpperCase()}`));
	const candidates = [entry.schno, ...(entry.alternatives ?? [])];
	for (const serial of candidates) {
		const key = `${normRitc}::${serial.trim().toUpperCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const rate = lookupDrawback(serial)?.rate ?? entry.rate;
		options.push({
			value: serial,
			parentValue: normRitc,
			fills: {
				dbk_rate: rate,
				dbk_unit: { from: 'QuantityUnit' }
			}
		});
	}
}

/**
 * Expands cell patches for ICEGrid tables so that modifying or copy-pasting RITCCode
 * automatically fills dependent customs columns:
 * - SQCUnit & SQCQTY
 * - drawback_schno, dbk_rate, dbk_unit, dbk_qty
 * - RODTEP, RoDTEPQty
 * - PerUnit
 *
 * Generated patches are placed before explicit patches, ensuring explicit edits in
 * the same batch override derived defaults.
 */
export function expandIcegridPatches(
	patches: CellPatch[],
	rows: Row[],
	columns: Column[]
): CellPatch[] {
	if (!isIcegridTable(columns) || patches.length === 0) return patches;

	const hasRitcPatch = patches.some((p) => p.columnId === 'RITCCode');
	const hasSchemePatch = patches.some((p) => p.columnId === 'ApplicableExpSchemes');
	const hasUnitPatch = patches.some((p) => p.columnId === 'QuantityUnit');

	if (!hasRitcPatch && !hasSchemePatch && !hasUnitPatch) return patches;

	const rowMap = new Map<string, Row>();
	const rowIndexMap = new Map<string, number>();
	rows.forEach((r, idx) => {
		rowMap.set(r.id, r);
		rowIndexMap.set(r.id, idx);
	});

	// Map incoming batch values per rowId
	const incomingRowPatches = new Map<string, Record<string, CellValue>>();
	for (const p of patches) {
		let rp = incomingRowPatches.get(p.rowId);
		if (!rp) {
			rp = {};
			incomingRowPatches.set(p.rowId, rp);
		}
		rp[p.columnId] = p.newValue;
	}

	const derivedPatches: CellPatch[] = [];
	const drawbackCol = columns.find((c) => c.id === 'drawback_schno' || c.name === 'drawback_schno');

	for (const [rowId, patchValues] of incomingRowPatches.entries()) {
		const row = rowMap.get(rowId);
		if (!row) continue;

		const rowIndex = rowIndexMap.get(rowId) ?? 0;
		const excelRowIndex = rowIndex + 2;
		const effectiveRow: Row = { ...row, ...patchValues };

		const ritcPatched = 'RITCCode' in patchValues;
		const schemePatched = 'ApplicableExpSchemes' in patchValues;
		const unitPatched = 'QuantityUnit' in patchValues;

		if (ritcPatched) {
			const rawRitc = patchValues['RITCCode'];
			const code = normalizeRitcCode(rawRitc);

			if (code.length === 8) {
				// 1. SQCUnit & SQCQTY
				const rodtep = lookupRodtep(code);
				const sqcUnit = rodtep ? uqcToUnit(rodtep.uqc) : null;
				if (sqcUnit) {
					derivedPatches.push({ rowId, columnId: 'SQCUnit', newValue: sqcUnit });
					effectiveRow.SQCUnit = sqcUnit;
				}

				const qtyUnit = typeof effectiveRow.QuantityUnit === 'string' ? effectiveRow.QuantityUnit : null;
				const qty = typeof effectiveRow.Quantity === 'number' ? effectiveRow.Quantity : null;
				const netWeight = typeof effectiveRow.NetWeight === 'number' ? effectiveRow.NetWeight : null;
				const sqcQty = deriveSqcQty(sqcUnit, qtyUnit, qty, netWeight, excelRowIndex);
				if (sqcQty !== null) {
					derivedPatches.push({ rowId, columnId: 'SQCQTY', newValue: sqcQty });
					effectiveRow.SQCQTY = sqcQty;
				}

				// 2. Drawback
				const scheme = effectiveRow.ApplicableExpSchemes;
				const isDbk = !scheme || isDrawbackScheme(scheme);

				if (isDbk) {
					const matchedOptions = drawbackCol?.dropdown?.options?.filter((o) => o.parentValue === code) ?? [];
					let chosenSerial: string | null = null;
					let chosenRate: number | null = null;
					let chosenDesc: string | null = null;

					if (matchedOptions.length > 0) {
						const firstOpt = matchedOptions[0];
						chosenSerial = firstOpt.value;
						chosenRate = typeof firstOpt.fills?.dbk_rate === 'number' ? firstOpt.fills.dbk_rate : null;
						chosenDesc = typeof firstOpt.fills?.dbk_desc === 'string' ? firstOpt.fills.dbk_desc : null;
					} else {
						const dbk = lookupDrawback(code);
						if (dbk) {
							chosenSerial = dbk.schno;
							chosenRate = dbk.rate;
							if (drawbackCol?.dropdown?.options) {
								ensureDrawbackDropdownOptions(drawbackCol.dropdown.options, code, dbk);
							}
						}
					}

					if (chosenSerial) {
						derivedPatches.push({ rowId, columnId: 'drawback_schno', newValue: chosenSerial });
						effectiveRow.drawback_schno = chosenSerial;
					}
					if (chosenRate !== null) {
						derivedPatches.push({ rowId, columnId: 'dbk_rate', newValue: chosenRate });
						effectiveRow.dbk_rate = chosenRate;
					}
					if (chosenDesc) {
						derivedPatches.push({ rowId, columnId: 'dbk_desc', newValue: chosenDesc });
						effectiveRow.dbk_desc = chosenDesc;
					}

					const dbkUnit = effectiveRow.dbk_unit || effectiveRow.QuantityUnit || null;
					if (dbkUnit && isBlank(effectiveRow.dbk_unit)) {
						derivedPatches.push({ rowId, columnId: 'dbk_unit', newValue: dbkUnit });
						effectiveRow.dbk_unit = dbkUnit;
					}

					const dbkQty = deriveDbkQty(effectiveRow.dbk_unit as string, sqcUnit, qtyUnit, qty, excelRowIndex, true);
					if (dbkQty !== null) {
						derivedPatches.push({ rowId, columnId: 'dbk_qty', newValue: dbkQty });
						effectiveRow.dbk_qty = dbkQty;
					}
				} else {
					derivedPatches.push(
						{ rowId, columnId: 'drawback_schno', newValue: null },
						{ rowId, columnId: 'dbk_rate', newValue: null },
						{ rowId, columnId: 'dbk_unit', newValue: null },
						{ rowId, columnId: 'dbk_qty', newValue: null },
						{ rowId, columnId: 'dbk_desc', newValue: null }
					);
				}

				// 3. RoDTEP
				const rodtepVal = rodtep ? 'Yes' : 'N/A';
				derivedPatches.push({ rowId, columnId: 'RODTEP', newValue: rodtepVal });
				effectiveRow.RODTEP = rodtepVal;

				const rodtepQty = deriveRodtepQty(rodtepVal, excelRowIndex);
				if (rodtepQty !== null) {
					derivedPatches.push({ rowId, columnId: 'RoDTEPQty', newValue: rodtepQty });
					effectiveRow.RoDTEPQty = rodtepQty;
				}

				// 4. PerUnit
				if (isBlank(effectiveRow.PerUnit) && !isBlank(effectiveRow.QuantityUnit)) {
					derivedPatches.push({ rowId, columnId: 'PerUnit', newValue: effectiveRow.QuantityUnit });
				}
			} else if (isBlank(rawRitc)) {
				// Blanked RITC -> clear dependent fields
				derivedPatches.push(
					{ rowId, columnId: 'drawback_schno', newValue: null },
					{ rowId, columnId: 'dbk_rate', newValue: null },
					{ rowId, columnId: 'dbk_unit', newValue: null },
					{ rowId, columnId: 'dbk_qty', newValue: null },
					{ rowId, columnId: 'dbk_desc', newValue: null },
					{ rowId, columnId: 'SQCUnit', newValue: null },
					{ rowId, columnId: 'SQCQTY', newValue: null },
					{ rowId, columnId: 'RODTEP', newValue: null },
					{ rowId, columnId: 'RoDTEPQty', newValue: null }
				);
			}
		} else if (schemePatched) {
			const scheme = patchValues['ApplicableExpSchemes'];
			const isDbk = !scheme || isDrawbackScheme(scheme);
			if (!isDbk) {
				derivedPatches.push(
					{ rowId, columnId: 'drawback_schno', newValue: null },
					{ rowId, columnId: 'dbk_rate', newValue: null },
					{ rowId, columnId: 'dbk_unit', newValue: null },
					{ rowId, columnId: 'dbk_qty', newValue: null },
					{ rowId, columnId: 'dbk_desc', newValue: null }
				);
			} else {
				const code = normalizeRitcCode(effectiveRow.RITCCode);
				if (code.length === 8) {
					const dbk = lookupDrawback(code);
					if (dbk) {
						derivedPatches.push(
							{ rowId, columnId: 'drawback_schno', newValue: dbk.schno },
							{ rowId, columnId: 'dbk_rate', newValue: dbk.rate }
						);
						const dbkUnit = effectiveRow.dbk_unit || effectiveRow.QuantityUnit || null;
						if (dbkUnit && isBlank(effectiveRow.dbk_unit)) {
							derivedPatches.push({ rowId, columnId: 'dbk_unit', newValue: dbkUnit });
						}
						const qtyUnit = typeof effectiveRow.QuantityUnit === 'string' ? effectiveRow.QuantityUnit : null;
						const qty = typeof effectiveRow.Quantity === 'number' ? effectiveRow.Quantity : null;
						const rodtep = lookupRodtep(code);
						const sqcUnit = rodtep ? uqcToUnit(rodtep.uqc) : (typeof effectiveRow.SQCUnit === 'string' ? effectiveRow.SQCUnit : null);
						const dbkQty = deriveDbkQty(dbkUnit as string, sqcUnit, qtyUnit, qty, excelRowIndex, true);
						if (dbkQty !== null) {
							derivedPatches.push({ rowId, columnId: 'dbk_qty', newValue: dbkQty });
						}
					}
				}
			}
		} else if (unitPatched) {
			const newUnit = patchValues['QuantityUnit'];
			if (typeof newUnit === 'string' && newUnit.trim()) {
				if (isBlank(effectiveRow.PerUnit) || effectiveRow.PerUnit === row.QuantityUnit) {
					derivedPatches.push({ rowId, columnId: 'PerUnit', newValue: newUnit });
				}
				if (isBlank(effectiveRow.dbk_unit) || effectiveRow.dbk_unit === row.QuantityUnit) {
					derivedPatches.push({ rowId, columnId: 'dbk_unit', newValue: newUnit });
					effectiveRow.dbk_unit = newUnit;
				}
				const code = normalizeRitcCode(effectiveRow.RITCCode);
				const rodtep = code.length === 8 ? lookupRodtep(code) : null;
				const sqcUnit = rodtep ? uqcToUnit(rodtep.uqc) : (typeof effectiveRow.SQCUnit === 'string' ? effectiveRow.SQCUnit : null);
				const qty = typeof effectiveRow.Quantity === 'number' ? effectiveRow.Quantity : null;
				const netWeight = typeof effectiveRow.NetWeight === 'number' ? effectiveRow.NetWeight : null;
				const sqcQty = deriveSqcQty(sqcUnit, newUnit, qty, netWeight, excelRowIndex);
				if (sqcQty !== null) {
					derivedPatches.push({ rowId, columnId: 'SQCQTY', newValue: sqcQty });
				}
				const scheme = effectiveRow.ApplicableExpSchemes;
				const isDbk = !scheme || isDrawbackScheme(scheme);
				if (isDbk) {
					const dbkQty = deriveDbkQty(effectiveRow.dbk_unit as string, sqcUnit, newUnit, qty, excelRowIndex, true);
					if (dbkQty !== null) {
						derivedPatches.push({ rowId, columnId: 'dbk_qty', newValue: dbkQty });
					}
				}
			}
		}
	}

	return [...derivedPatches, ...patches];
}
