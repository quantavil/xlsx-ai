import { getCatalogSnapshot, resolveCatalogValue, normalizeStateKey } from './catalogs';
import type { IcegridCatalogSnapshot } from './catalogs/types';
import { ICEGRID_COLUMNS } from './columns';
import type { IcegridReport } from './schema';

export interface ValidationResult {
	valid: boolean;
	blockingErrors: string[];
	warnings: string[];
}

const CATALOG_HEADERS = ICEGRID_COLUMNS.filter((c) => c.catalog);

/**
 * Deterministic post-sanitization checks.
 *
 * Only structural problems block: a source-file mismatch or an empty report means
 * the run cannot be trusted at all. Everything else is a warning against an editable
 * table, because discarding a 40-row extraction over one blank cell serves nobody.
 *
 * Nothing here writes a value. The arithmetic checks in particular compare and
 * report; they never fill in ProductAmount or IGST_Amount.
 */
export function validateIcegridReport(
	report: IcegridReport,
	expectedSourceFiles?: readonly string[],
	catalogs: IcegridCatalogSnapshot = getCatalogSnapshot()
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
		const label = `Row ${rowNum}${row.InvoiceNo ? ` (${row.InvoiceNo})` : ''}`;

		// 1. Fields a usable shipping-bill line needs. Warnings, not blockers.
		const missing: string[] = [];
		if (!row.InvoiceNo || !row.InvoiceNo.trim()) missing.push('InvoiceNo');
		if (!row.Description || !row.Description.trim()) missing.push('Description');
		if (row.Quantity === null) missing.push('Quantity');
		if (!row.QuantityUnit) missing.push('QuantityUnit');
		if (row.UnitPrice === null) missing.push('UnitPrice');
		if (row.ProductAmount === null) missing.push('ProductAmount');
		if (missing.length > 0) warnings.push(`${label}: needs review - ${missing.join(', ')}.`);

		// 2. Negative numerics are always a data error, never a valid customs value.
		for (const col of ICEGRID_COLUMNS) {
			if (col.type !== 'number' && col.type !== 'currency') continue;
			const value = row[col.header as keyof typeof row];
			if (typeof value === 'number' && value < 0) {
				warnings.push(`${label}: ${col.header} is negative (${value}).`);
			}
		}

		// 3. Every catalog-backed value must still be a catalog value after sanitization.
		for (const col of CATALOG_HEADERS) {
			const value = row[col.header as keyof typeof row];
			if (typeof value !== 'string' || !value) continue;

			const parentValue =
				col.dependsOn !== undefined
					? (row[col.dependsOn as keyof typeof row] as string | null)
					: undefined;

			// A district with no built-in catalog can only be a user-entered value; the
			// state relationship is checked below rather than rejecting it outright.
			if (col.catalog === 'district' && catalogs.district.length === 0) continue;

			const resolution = resolveCatalogValue(value, catalogs[col.catalog!], {
				...(col.dependsOn !== undefined ? { parentValue } : {}),
				allowNumericPrefix: col.catalog === 'scheme'
			});

			if (resolution.status !== 'resolved') {
				warnings.push(
					resolution.reason === 'wrong_parent'
						? `${label}: ${col.header} "${value}" does not belong to StateOrigin "${parentValue ?? ''}".`
						: `${label}: ${col.header} "${value}" is not a known option (${resolution.reason}).`
				);
			}
		}

		// 4. A district without a state has nothing to validate against.
		if (row.DistrictOrigin && !normalizeStateKey(row.StateOrigin)) {
			warnings.push(`${label}: DistrictOrigin is set but StateOrigin is blank.`);
		}

		// 5. RITC is an 8-digit Indian Customs tariff code.
		if (row.RITCCode && row.RITCCode.trim()) {
			const digits = row.RITCCode.replace(/\D/g, '');
			if (digits.length !== 8) {
				warnings.push(
					`${label}: RITC code "${row.RITCCode}" is ${digits.length} digits (Indian Customs standard is 8).`
				);
			}
		}

		// 6. Arithmetic sanity. Reported, never applied.
		if (row.Quantity !== null && row.UnitPrice !== null && row.ProductAmount !== null) {
			const expected = row.Quantity * row.UnitPrice;
			const diff = Math.abs(row.ProductAmount - expected);
			if (diff > 0.05 && diff > Math.abs(row.ProductAmount) * 0.005) {
				warnings.push(
					`${label}: ProductAmount (${row.ProductAmount}) differs from Quantity * UnitPrice (${expected.toFixed(2)}). The source value was kept.`
				);
			}
		}

		if (row.Taxable_Value !== null && row.IGST_Rate !== null && row.IGST_Amount !== null) {
			const expected = (row.Taxable_Value * row.IGST_Rate) / 100;
			const diff = Math.abs(row.IGST_Amount - expected);
			if (diff > 0.5 && diff > Math.abs(row.IGST_Amount) * 0.01) {
				warnings.push(
					`${label}: IGST_Amount (${row.IGST_Amount}) differs from Taxable_Value * ${row.IGST_Rate}% (${expected.toFixed(2)}). The source value was kept.`
				);
			}
		}

		// 7. Accessories must have survived sanitization blank.
		if (row.Accessories !== null) {
			warnings.push(`${label}: Accessories was cleared; it is never populated on import.`);
		}
	}

	return { valid: blockingErrors.length === 0, blockingErrors, warnings };
}
