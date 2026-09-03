import type { IcegridRow } from '../schema';

const isBlank = (v: unknown) => v === null || v === undefined || v === '';
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

export interface TaxRulesResult {
	warnings: string[];
}

/**
 * Applies tax arithmetic and LUT status rules.
 *
 * Under LUT, no IGST is paid, so taxable value, rate and amount are zeroed.
 * When IGST is paid (P), Taxable_Value is ProductAmount * exchangeRate,
 * and IGST_Amount is Taxable_Value * IGST_Rate / 100.
 */
export function applyTaxRules(
	row: IcegridRow,
	exchangeRate: number | null,
	rowLabel: string
): TaxRulesResult {
	const warnings: string[] = [];

	if (row.IGST_PaymentStatus === 'LUT') {
		const overridden: string[] = [];
		if (!isBlank(row.IGST_Rate) && Number(row.IGST_Rate) !== 0) overridden.push(`IGST_Rate: ${row.IGST_Rate}`);
		if (!isBlank(row.Taxable_Value) && Number(row.Taxable_Value) !== 0) overridden.push(`Taxable_Value: ${row.Taxable_Value}`);
		if (!isBlank(row.IGST_Amount) && Number(row.IGST_Amount) !== 0) overridden.push(`IGST_Amount: ${row.IGST_Amount}`);

		row.IGST_Rate = 0;
		row.Taxable_Value = 0;
		row.IGST_Amount = 0;

		if (overridden.length > 0) {
			warnings.push(
				`${rowLabel}: IGST payment status is LUT. Overrode non-zero tax values (${overridden.join(', ')}) with 0.`
			);
		}
	} else if (!isBlank(row.ProductAmount) && exchangeRate) {
		if (isBlank(row.Taxable_Value)) {
			row.Taxable_Value = round2(Number(row.ProductAmount) * exchangeRate);
		}
	}

	if (isBlank(row.IGST_Amount) && !isBlank(row.Taxable_Value) && !isBlank(row.IGST_Rate)) {
		row.IGST_Amount = round2((Number(row.Taxable_Value) * Number(row.IGST_Rate)) / 100);
	}

	return { warnings };
}
