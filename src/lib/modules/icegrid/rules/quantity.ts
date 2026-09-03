import type { IcegridRow } from '../schema';
import { isBlank } from '$lib/table/cells';

/**
 * Derives SQCQTY (Col O).
 *
 * Rule 1: IF Col P (SQCUnit) has 'NOS' or matches Col N (QuantityUnit), use formula `=M${excelRowIndex}`.
 * Otherwise, keep default:
 * - If SQCUnit is 'KGS', default is NetWeight.
 * - For other stated units, default is Quantity.
 * - If SQCUnit is blank, SQCQTY is null.
 */
export function deriveSqcQty(
	sqcUnit: string | null | undefined,
	quantityUnit: string | null | undefined,
	quantity: number | null | undefined,
	netWeight: number | null | undefined,
	excelRowIndex: number
): number | string | null {
	if (isBlank(sqcUnit)) return null;

	const sqcUpper = sqcUnit!.trim().toUpperCase();
	const qtyUpper = quantityUnit ? quantityUnit.trim().toUpperCase() : null;

	if (sqcUpper === 'NOS' || (qtyUpper !== null && sqcUpper === qtyUpper)) {
		return `=M${excelRowIndex}`;
	}

	if (sqcUpper === 'KGS') {
		return netWeight ?? null;
	}

	return quantity ?? null;
}

function matchesUnit(a: string | null | undefined, b: string | null | undefined): boolean {
	if (isBlank(a) || isBlank(b)) return false;
	return a!.trim().toUpperCase() === b!.trim().toUpperCase();
}

/**
 * Derives dbk_qty (Col V).
 *
 * IF Col X (dbk_unit) matches Col P (SQCUnit), use formula `=O${excelRowIndex}`.
 * ELSE IF Col X (dbk_unit) matches Col N (QuantityUnit), use formula `=M${excelRowIndex}`.
 * Otherwise, keep default (Quantity).
 * Gated: If drawback is not eligible for this row, dbk_qty is null.
 */
export function deriveDbkQty(
	dbkUnit: string | null | undefined,
	sqcUnit: string | null | undefined,
	quantityUnit: string | null | undefined,
	quantity: number | null | undefined,
	excelRowIndex: number,
	isDrawbackEligible: boolean
): number | string | null {
	if (!isDrawbackEligible) return null;

	if (matchesUnit(dbkUnit, sqcUnit)) {
		return `=O${excelRowIndex}`;
	}

	if (matchesUnit(dbkUnit, quantityUnit)) {
		return `=M${excelRowIndex}`;
	}

	return quantity ?? null;
}

/**
 * Derives RoDTEPQty (Col AK).
 *
 * RoDTEP quantity tracks SQCQTY (=O${excelRowIndex}) when RoDTEP eligibility is 'Yes'.
 */
export function deriveRodtepQty(
	rodtep: string | null | undefined,
	excelRowIndex: number
): string | null {
	if (rodtep === 'Yes') {
		return `=O${excelRowIndex}`;
	}
	return null;
}

/**
 * Applies quantity and formula derivation rules to an ICEGrid row.
 */
export function applyQuantityRules(
	row: IcegridRow,
	excelRowIndex: number,
	isDrawbackEligible: boolean
): void {
	// Rule 1: SQCQTY formula or default (only if not already stated on document)
	if (isBlank(row.SQCQTY)) {
		const sqc = deriveSqcQty(row.SQCUnit, row.QuantityUnit, row.Quantity, row.NetWeight, excelRowIndex);
		if (!isBlank(sqc)) {
			row.SQCQTY = sqc;
		}
	}

	// Rule 4: dbk_unit and dbk_qty formulas or defaults
	if (isDrawbackEligible) {
		// If DBK Details Unit is empty, Col X (dbk_unit) should be same as Col N (QuantityUnit)
		if (isBlank(row.dbk_unit) && !isBlank(row.QuantityUnit)) {
			row.dbk_unit = row.QuantityUnit;
		}

		if (isBlank(row.dbk_qty)) {
			const dbk = deriveDbkQty(
				row.dbk_unit,
				row.SQCUnit,
				row.QuantityUnit,
				row.Quantity,
				excelRowIndex,
				true
			);
			if (!isBlank(dbk)) {
				row.dbk_qty = dbk;
			}
		}
	} else {
		row.dbk_qty = null;
	}

	// RoDTEPQty formula
	if (isBlank(row.RoDTEPQty)) {
		row.RoDTEPQty = deriveRodtepQty(row.RODTEP, excelRowIndex);
	}
}
