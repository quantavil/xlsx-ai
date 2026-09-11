import type { TableData } from '$lib/types';
import { getCatalogSnapshot } from './catalogs';
import { requestDutyLookups } from './duty-lookup.client';
import { buildDrawbackOptions, type DutyLookupEntry } from './duty-lookup';
import { requestExchangeRates, detectInvoiceCurrency } from './exchange-rate';
import {
	buildConfirmInput,
	applyIcegridAnswers,
	newlyAssignedRitcs,
	isFilableRitc,
	type IcegridConfirmInput
} from './confirm';
import { confirmIcegridChoices } from './confirm.client';
import { deriveRows } from './derive';
import { mapReportToTableData } from './to-table';
import { loadProfile } from './profile';
import { normalizeRitcCode } from './duty-lookup';
import type { IcegridRow } from './schema';

export interface ReopenIcegridResult {
	table: TableData;
	warnings: string[];
}

/**
 * Reopens the ICEGrid confirmation modal for an active table.
 * Reads current values, allows user review/updates, and re-derives dependent fields.
 * Returns null if cancelled.
 */
export async function reopenIcegridConfirmation(
	table: TableData,
	signal?: AbortSignal
): Promise<ReopenIcegridResult | null> {
	const catalogs = getCatalogSnapshot();

	// Convert table.rows into IcegridRow[]
	const icegridRows: IcegridRow[] = table.rows.map((r) => {
		const row: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(r)) {
			if (k === 'id') continue;
			row[k] = v;
		}
		return row as IcegridRow;
	});

	// Collect unique RITC codes from rows
	const ritcCodes = Array.from(
		new Set(
			icegridRows
				.map((r) => (typeof r.RITCCode === 'string' ? normalizeRitcCode(r.RITCCode) : null))
				.filter((c): c is string => Boolean(c) && isFilableRitc(c))
		)
	);

	// Live duty lookups for distinct tariff codes
	const { entries: lookupEntries, warnings: lookupWarnings } = await requestDutyLookups(ritcCodes);
	const lookups = new Map<string, DutyLookupEntry>();
	for (const entry of lookupEntries) {
		lookups.set(entry.ritc, entry);
	}

	// Read drawback options already stored on drawback_schno column
	const existingDrawbackCol = table.columns.find(
		(c) => c.name === 'drawback_schno' || c.id === 'drawbackSchNo'
	);
	const fallbackDrawbackOptions = existingDrawbackCol?.dropdown?.options ?? [];

	// Exchange rates
	const rateBatch = await requestExchangeRates();
	let detectedCurrency: string | null = null;
	if (table.sourceText) {
		detectedCurrency = detectInvoiceCurrency(table.sourceText, rateBatch.rates);
	}

	// Look for existing exchange rate or infer from ProductAmount and Taxable_Value
	let currentRate: number | null = null;
	const sampleWithTax = icegridRows.find(
		(r) =>
			typeof r.ProductAmount === 'number' &&
			r.ProductAmount > 0 &&
			typeof r.Taxable_Value === 'number' &&
			r.Taxable_Value > 0
	);
	if (sampleWithTax) {
		const rawRatio = Number(sampleWithTax.Taxable_Value) / Number(sampleWithTax.ProductAmount);
		if (Number.isFinite(rawRatio) && rawRatio > 0) {
			currentRate = Math.round(rawRatio * 100) / 100;
		}
	}

	// If currency was not detected from sourceText, try matching inferred rate with exchange rate list
	if (!detectedCurrency && currentRate !== null) {
		const match = rateBatch.rates.find((r) => Math.abs(r.exportRate - currentRate!) < 0.05);
		if (match) {
			detectedCurrency = match.code;
		}
	}

	const confirmInput: IcegridConfirmInput = buildConfirmInput(icegridRows, {
		lookups,
		catalogs,
		rates: rateBatch.rates,
		currency: detectedCurrency,
		exchangeRate: currentRate,
		documentExchangeRate: currentRate,
		isReopen: true,
		fallbackDrawbackOptions
	});

	const answers = await confirmIcegridChoices(confirmInput, signal);
	if (!answers) return null;

	// Lookup newly assigned tariff codes if any
	const assigned = newlyAssignedRitcs(answers).filter((code) => !lookups.has(code));
	let extraLookupWarnings: string[] = [];
	if (assigned.length > 0) {
		const extra = await requestDutyLookups(assigned);
		for (const entry of extra.entries) lookups.set(entry.ritc, entry);
		extraLookupWarnings = extra.warnings;
	}

	// Apply answers and re-derive
	const updatedRows = applyIcegridAnswers(icegridRows, answers);
	const derived = deriveRows(updatedRows, {
		catalogs,
		profile: loadProfile(),
		sourceText: table.sourceText,
		exchangeRate: answers.exchangeRate,
		lookups
	});

	const updatedTable = mapReportToTableData(
		{
			reportVersion: 1,
			sourceFiles: [],
			rows: derived.rows,
			warnings: []
		},
		catalogs,
		{
			drawback: buildDrawbackOptions(lookups)
		},
		table.sourceText
	);
	updatedTable.title = table.title;

	return {
		table: updatedTable,
		warnings: [
			...lookupWarnings,
			...rateBatch.warnings,
			...extraLookupWarnings,
			...derived.warnings
		]
	};
}
