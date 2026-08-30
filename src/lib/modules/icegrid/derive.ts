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
	/**
	 * INR per unit of the invoice currency, confirmed by the filer.
	 *
	 * There is no fallback behind it any more: the rate comes from the customs board
	 * or the invoice, and either way the confirmation dialog is what settles it.
	 * Absent, `Taxable_Value` stays blank rather than being computed at a guess.
	 */
	exchangeRate?: number | null;
	/**
	 * Live duty-structure answers keyed by RITC. Absent or missing a code simply means
	 * the bundled schedule decides, which is what happened before this existed.
	 */
	lookups?: DutyLookupMap;
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

	const gstinState = sourceText ? stateCodeFromGstin(sourceText) : null;
	let residualDrawbackRows = 0;
	let missingNetWeightRows = 0;
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
		const ritc = normalizeRitcCode(row.RITCCode);
		const live = lookups?.get(ritc);

		if (ritc.length === 8) {
			// RoDTEP is per tariff item, so the live answer and the bundled schedule are
			// asking the same question. Three states, not two: the schedule can say a code
			// is eligible or that it never mentions the code, and an exporter can decline
			// a claim on a code that is eligible. Only the invoice knows the third, which
			// is why an extracted "No" is never overwritten - `set` is fill-only.
			const rodtep = live ? live.rodtep : lookupRodtep(ritc);
			if (rodtep) {
				set('RODTEP', 'Yes', live ? 'lookup' : 'schedule');
				const unit = uqcToUnit(rodtep.uqc);
				if (unit) set('SQCUnit', unit, live ? 'lookup' : 'schedule');
			} else {
				// Absent from Appendix 4R means the question does not apply to this tariff
				// item. Writing "No" here would claim it was considered and refused.
				set('RODTEP', 'N/A', live ? 'lookup' : 'schedule');
			}

			// Drawback is keyed on the four-digit heading, so a tariff item is routinely
			// offered several serials. That is a classification the exporter makes: pick a
			// starting point, record that it was a guess, and let the dropdown carry the rest.
			if (live && live.drawback.length > 0) {
				const choice = selectDrawbackSerial(live.drawback, row.drawback_schno);
				if (choice.serial) set('drawback_schno', choice.serial, 'lookup');
				if (choice.basis === 'suggested') {
					residualDrawbackRows++;
					if (sampleAlternatives.length === 0) {
						sampleAlternatives = live.drawback.map((c) => c.serial);
					}
				}

				// Rate, description, cap and unit are consequences of whichever serial ends
				// up in the cell - including one the documents printed that the service does
				// not list, in which case there is nothing to copy and the fields stay blank.
				const chosen = live.drawback.find((c) => sameSerial(c.serial, row.drawback_schno));
				if (chosen) {
					set('dbk_rate', chosen.rate, 'lookup');
					set('dbk_desc', chosen.description, 'lookup');
					set('ROSLRate', chosen.roslRate, 'lookup');
					set('ROSLCapValue', chosen.roslCap, 'lookup');
					// The schedule's own unit governs the cap when it prescribes one; otherwise
					// the drawback is claimed in the unit the goods were invoiced in.
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
		} else if (!blank(row.RITCCode)) {
			warnings.push(`${label}: RITC "${row.RITCCode}" is not 8 digits, so no schedule lookup was possible.`);
		}

		// ---- 2. Deterministic derivations ----------------------------------------
		// Each of these held on every row of the 17-shipment reference corpus.
		set('PerUnit', row.QuantityUnit, 'derived');
		set('dbk_unit', row.QuantityUnit, 'derived');
		set('dbk_qty', row.Quantity, 'derived');

		// The SQC quantity is counted in the tariff's own unit, so which figure it takes
		// depends on that unit and never on the invoiced one. A KGS tariff wants the
		// line's net weight, which only the packing list states - absent, the cell stays
		// blank rather than borrowing a count. Any other stated unit takes the invoiced
		// quantity. A blank SQCUnit means the tariff item was not found in the schedule,
		// so there is no unit to declare a quantity in and nothing is written.
		if (row.SQCUnit === 'KGS') {
			set('SQCQTY', row.NetWeight, 'derived');
			if (blank(row.NetWeight) && blank(row.SQCQTY)) missingNetWeightRows++;
		} else if (!blank(row.SQCUnit)) {
			set('SQCQTY', row.Quantity, 'derived');
		}
		// RoDTEP quantity tracks the SQC quantity, not the invoiced quantity - and only
		// where a RoDTEP claim exists at all. A tariff item absent from the schedule has
		// no quantity to declare against it.
		if (row.RODTEP !== 'N/A') set('RoDTEPQty', row.SQCQTY, 'derived');

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
