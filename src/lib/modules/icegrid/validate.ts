import type { IcegridReport, IcegridRow } from './schema';

export interface ValidationResult {
	valid: boolean;
	blockingErrors: string[];
	warnings: string[];
}

export function validateIcegridReport(
	report: IcegridReport,
	expectedSourceFiles?: readonly string[]
): ValidationResult {
	const blockingErrors: string[] = [];
	const warnings: string[] = [];
	if (
		expectedSourceFiles &&
		(expectedSourceFiles.length !== report.sourceFiles.length ||
			expectedSourceFiles.some((filename, index) => report.sourceFiles[index] !== filename))
	) {
		blockingErrors.push('Report sourceFiles do not match the selected source files.');
	}

	if (!report.rows || report.rows.length === 0) {
		blockingErrors.push('Report contains no extracted data rows.');
		return { valid: false, blockingErrors, warnings };
	}

	for (let i = 0; i < report.rows.length; i++) {
		const row = report.rows[i];
		const rowNum = i + 1;

		// 1. Mandatory Fields Check
		if (!row.InvoiceNo || !row.InvoiceNo.trim()) {
			blockingErrors.push(`Row ${rowNum}: Missing mandatory InvoiceNo.`);
		}
		if (!row.Description || !row.Description.trim()) {
			blockingErrors.push(`Row ${rowNum}: Missing mandatory Description.`);
		}
		if (row.Quantity === null || row.Quantity === undefined || row.Quantity < 0) {
			blockingErrors.push(`Row ${rowNum}: Missing or negative Quantity.`);
		}
		if (!row.QuantityUnit || !row.QuantityUnit.trim()) {
			blockingErrors.push(`Row ${rowNum}: Missing mandatory QuantityUnit.`);
		}
		if (row.UnitPrice === null || row.UnitPrice === undefined || row.UnitPrice < 0) {
			blockingErrors.push(`Row ${rowNum}: Missing or negative UnitPrice.`);
		}
		if (row.ProductAmount === null || row.ProductAmount === undefined || row.ProductAmount < 0) {
			blockingErrors.push(`Row ${rowNum}: Missing or negative ProductAmount.`);
		}

		// 2. Arithmetic Sanity Verification (Warning Level)
		if (row.Quantity !== null && row.UnitPrice !== null && row.ProductAmount !== null) {
			const expectedProductAmount = row.Quantity * row.UnitPrice;
			const diff = Math.abs(row.ProductAmount - expectedProductAmount);
			// Allow up to 0.05 currency tolerance for rounding
			if (diff > 0.05 && diff > row.ProductAmount * 0.005) {
				warnings.push(
					`Row ${rowNum} (${row.InvoiceNo || 'Inv'}): ProductAmount (${row.ProductAmount}) differs from Quantity (${row.Quantity}) * UnitPrice (${row.UnitPrice}) = ${expectedProductAmount.toFixed(2)}.`
				);
			}
		}

		// 3. IGST Amount Arithmetic Verification (Warning Level)
		if (row.Taxable_Value !== null && row.IGST_Rate !== null && row.IGST_Amount !== null) {
			const expectedIgst = (row.Taxable_Value * row.IGST_Rate) / 100;
			const diff = Math.abs(row.IGST_Amount - expectedIgst);
			if (diff > 0.5 && diff > row.IGST_Amount * 0.01) {
				warnings.push(
					`Row ${rowNum}: IGST_Amount (${row.IGST_Amount}) differs from Taxable_Value * ${row.IGST_Rate}% (${expectedIgst.toFixed(2)}).`
				);
			}
		}

		// 4. RITC Code Format Verification (Warning Level)
		if (row.RITCCode && row.RITCCode.trim()) {
			const cleanRitc = row.RITCCode.replace(/\D/g, '');
			if (cleanRitc.length !== 8) {
				warnings.push(
					`Row ${rowNum}: RITC code "${row.RITCCode}" is ${cleanRitc.length} digits (Indian Customs standard is 8 digits).`
				);
			}
		}
	}

	return {
		valid: blockingErrors.length === 0,
		blockingErrors,
		warnings
	};
}
