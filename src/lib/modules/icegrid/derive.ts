import { ICEGRID_COLUMNS } from './columns';
import { resolveCatalogValue } from './catalogs';
import type { IcegridCatalogSnapshot } from './catalogs/types';
import { lookupDrawback, lookupRodtep, uqcToUnit } from './catalogs/generated/schedules';
import { SCHEDULES_PROVENANCE } from './catalogs/generated/provenance';
import { EMPTY_PROFILE, PROFILE_FIELD_HEADERS, type IcegridProfile } from './profile';
import type { IcegridDescriptionStyle, IcegridRow } from './schema';
import {
	normalizeRitcCode,
	sameSerial,
	selectDrawbackSerial,
	type DutyLookupMap
} from './duty-lookup';
import { quoteSupportsValue } from './evidence';

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

export interface MaterialWeight {
	name: string;
	/** Kilograms per piece, or null where the line names a material but prints no weight. */
	kg: number | null;
}

/**
 * `"Iron 0.800; Marble 1.700 Kgs"` -> those two, in printed order.
 *
 * Deliberately lenient about what separates two materials. The model is asked for
 * semicolons, but what it most often does with a line whose packing list prints
 * `(Alu-9.600/Glass-0.150/Agate-0.050)` is hand that back verbatim - so a parser that
 * only knew semicolons silently dropped every multi-material row, which is most of the
 * rows worth composing. Accepting the separators the documents themselves use costs a
 * character class; the strictness that matters is on the way out, where a name that
 * still carries a number is refused rather than filed.
 */
export function parseMaterials(raw: string | null | undefined): MaterialWeight[] {
	if (typeof raw !== 'string') return [];
	const numbers = /\d+(?:\.\d+)?/g;
	return raw
		.replace(/^\s*net\s*w(?:eigh)?t\.?\s*[:-]?\s*/i, '')
		.split(/[;,\n]/)
		// A slash separates two materials only where the segment holds more than one
		// weight; `M/Wood 0.210` is one material whose own name contains a slash.
		.flatMap((part) => ((part.match(numbers) ?? []).length > 1 ? part.split('/') : [part]))
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const match = part.match(/^(.*?)[\s:=-]*(\d+(?:\.\d+)?)\s*(?:kgs?\.?)?$/i);
			const name = (match ? match[1] : part).replace(/[\s:=-]+$/, '').trim();
			// A name still carrying a number is not a material, it is an entry that failed to
			// separate - `Alumi 0.570 Stone` out of `Alumi 0.570; Stone 0.300`. Dropping it
			// loses one material; keeping it files a substance that does not exist.
			if (name.length < 2 || /\d/.test(name)) return null;
			return { name, kg: match ? Number(match[2]) : null };
		})
		.filter((m): m is MaterialWeight => m !== null);
}

/**
 * The exporter's goods-class phrase, with this line's materials ranked by weight.
 *
 * Two ordering rules, both load-bearing and both confirmed against every handicraft
 * shipment in the reference corpus: heaviest material first, and a material the line
 * names without printing a weight for goes last. Printed order breaks a tie, which is
 * what `Array.sort`'s stability gives for free. The corpus proves the sort is not
 * cosmetic - one shipment files `(Alu-1.000 / Marble-0.850)` as MARBLE / ALUMINUM the
 * moment the marble outweighs the aluminium on the next line.
 *
 * Returns null when nothing survives to fill a template that needs materials; the
 * caller keeps the extracted item name rather than filing a phrase with a hole in it.
 */
export function composeDescription(
	name: string,
	materials: readonly MaterialWeight[],
	style: IcegridDescriptionStyle
): string | null {
	const drop = new Set((style.nonMaterials ?? []).map((n) => n.trim().toLowerCase()));
	const spell = new Map(
		(style.spellings ?? []).map((s) => [s.printed.trim().toLowerCase(), s.filed.trim()])
	);

	const seen = new Set<string>();
	const ranked = materials
		.filter((m) => m.kg !== 0 && !drop.has(m.name.trim().toLowerCase()))
		.slice()
		.sort((a, b) => (b.kg ?? -1) - (a.kg ?? -1))
		.map((m) => spell.get(m.name.trim().toLowerCase()) ?? m.name.trim())
		.filter((filed) => {
			const key = filed.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

	// Repeated from deriveRows on purpose: this is an exported function, and its contract
	// cannot depend on a caller having screened the style first.
	if (describeStyleProblem(style)) return null;
	if (ranked.length === 0 && style.template.includes('{MATERIALS}')) return null;

	// Already composed. Nothing re-derives a composed row today, but a second pass would
	// take the whole phrase as the article name and nest it inside a new one, and that
	// corruption reads as plausible customs wording.
	const prefix = style.template.split('{')[0].trim().toUpperCase();
	const filedName = name.trim().toUpperCase();
	if (prefix && filedName.startsWith(prefix)) return null;

	// Function replacements, not string ones: `$&` and `$'` in an article name are
	// substitution patterns to String.replace, and an invoice is free to print a `$`.
	const composed = style.template
		.replace('{MATERIALS}', () => ranked.join(style.separator ?? ' / '))
		.replace('{NAME}', () => name)
		.toUpperCase();

	// Post-conditions on the value itself, not just on the template that made it. Every
	// way this has gone wrong so far ended with the article's own name missing from what
	// would be filed, so that is checked on the finished string - a template that passes
	// inspection and still eats the name does not get past here.
	if (!composed.includes(filedName)) return null;
	if (/\{[^}]*\}/.test(composed)) return null;
	return composed;
}

/**
 * Why a model-supplied goods-class style cannot be used, or null if it can.
 *
 * `descriptionStyle` is the one piece of model output that rewrites an already
 * evidence-backed cell, so it gets the gate every other route through this module
 * already has: extracted values need a verbatim quote, catalog values must resolve or
 * be cleared, a tariff code needs a human. Checked once per shipment rather than per
 * row, because a bad template is a shipment-wide fact and reporting it 25 times as a
 * row problem is how the real cause stayed hidden.
 */
export function describeStyleProblem(
	style: IcegridDescriptionStyle | null | undefined,
	sourceText?: string
): string | null {
	const template = style?.template?.trim() ?? '';
	if (!template) return 'it carries no template';
	if (!template.includes('{NAME}')) {
		return 'its template has no {NAME} placeholder, so every row of the shipment would be filed under one phrase with the article names discarded';
	}
	const unknown = template.replace('{NAME}', '').replace('{MATERIALS}', '').match(/\{[^}]*\}/);
	if (unknown) return `its template carries an unknown placeholder ${unknown[0]}`;
	if (template.length > 200) return 'its template is far too long to be a goods-class phrase';

	if (sourceText) {
		const pieces = template
			.split(/\{[^}]+\}/)
			.map((p) => p.trim())
			.filter((p) => p.length > 1);

		for (const piece of pieces) {
			if (!quoteSupportsValue(sourceText, piece)) {
				return `its template literal text "${piece}" is not found in the source documents`;
			}
		}

		if (style?.spellings) {
			for (const s of style.spellings) {
				const filed = s.filed?.trim();
				if (filed && !quoteSupportsValue(sourceText, filed)) {
					return `its material spelling "${filed}" is not found in the source documents`;
				}
			}
		}
	}

	return null;
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
	/**
	 * The shipment's goods-class phrase, read off the documents' own banner.
	 *
	 * Null - the usual case outside handicrafts - leaves Description exactly as the
	 * invoice printed it. Composing one from general knowledge would be inventing
	 * customs wording, which is the one thing this column must never do.
	 */
	descriptionStyle?: IcegridDescriptionStyle | null;
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
		lookups,
		descriptionStyle = null
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

	const styleProblem = descriptionStyle ? describeStyleProblem(descriptionStyle, sourceText) : null;
	const usableStyle = styleProblem ? null : descriptionStyle;
	if (styleProblem) {
		warnings.push(
			`Description kept the printed item name on every row: the goods-class phrase read from the documents was rejected because ${styleProblem}.`
		);
	}

	const gstinState = sourceText ? stateCodeFromGstin(sourceText) : null;
	let residualDrawbackRows = 0;
	let missingNetWeightRows = 0;
	let unphrasedRows = 0;
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
		if (row.RODTEP === 'Yes') set('RoDTEPQty', row.SQCQTY, 'derived');

		// The invoice prints the article's own name; a shipping bill files it under the
		// exporter's goods-class phrase with this line's materials ranked by weight. The
		// model supplies both halves it is qualified to supply - the weights as printed
		// and the banner's wording - and the ranking happens here, because the corpus
		// settles it exactly and a model asked to order five materials is right most of
		// the time with no way to tell which rows it was not.
		// ponytail: one template per shipment. Two corpus shipments switch the class word
		// per line by tariff chapter - GodGift files its 9105 clocks as ARTWARE and its
		// 9403 tables as FURNITURE - which affects 4 of 277 rows and is a cell edit in the
		// grid. Key the suffix on RITCCode's first two digits if that stops being true.
		if (usableStyle && !blank(row.Description)) {
			const composed = composeDescription(
				String(row.Description),
				parseMaterials(row.Materials),
				usableStyle
			);
			if (composed) {
				row.Description = composed;
				if (marks.Description === 'extracted') filled.extracted--;
				marks.Description = 'derived';
				filled.derived++;
			} else {
				unphrasedRows++;
			}
		}

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
			const overridden: string[] = [];
			if (!blank(row.IGST_Rate) && Number(row.IGST_Rate) !== 0) overridden.push(`IGST_Rate: ${row.IGST_Rate}`);
			if (!blank(row.Taxable_Value) && Number(row.Taxable_Value) !== 0) overridden.push(`Taxable_Value: ${row.Taxable_Value}`);
			if (!blank(row.IGST_Amount) && Number(row.IGST_Amount) !== 0) overridden.push(`IGST_Amount: ${row.IGST_Amount}`);

			if (row.IGST_Rate !== 0) {
				if (blank(row.IGST_Rate)) filled.derived++;
				row.IGST_Rate = 0;
				marks.IGST_Rate = 'derived';
			}
			if (row.Taxable_Value !== 0) {
				if (blank(row.Taxable_Value)) filled.derived++;
				row.Taxable_Value = 0;
				marks.Taxable_Value = 'derived';
			}
			if (row.IGST_Amount !== 0) {
				if (blank(row.IGST_Amount)) filled.derived++;
				row.IGST_Amount = 0;
				marks.IGST_Amount = 'derived';
			}

			if (overridden.length > 0) {
				warnings.push(
					`${label}: IGST payment status is LUT. Overrode non-zero tax values (${overridden.join(', ')}) with 0.`
				);
			}
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
	if (unphrasedRows > 0) {
		warnings.push(
			`Description kept the printed item name on ${unphrasedRows} row(s): the goods-class phrase needs this line's material weights and the packing list prints none against it.`
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
