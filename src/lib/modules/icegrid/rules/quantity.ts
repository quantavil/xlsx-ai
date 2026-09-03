import type { IcegridRow } from '../schema';

const isBlank = (v: unknown) => v === null || v === undefined || v === '';

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

/**
 * Derives dbk_qty (Col V).
 *
 * Rule 4: IF Col X (dbk_unit) matches Col P (SQCUnit), use formula `=O${excelRowIndex}`.
 * Otherwise, keep default (Quantity).
 * Gated: If drawback is not eligible for this row, dbk_qty is null.
 */
export function deriveDbkQty(
	dbkUnit: string | null | undefined,
	sqcUnit: string | null | undefined,
	quantity: number | null | undefined,
	excelRowIndex: number,
	isDrawbackEligible: boolean
): number | string | null {
	if (!isDrawbackEligible) return null;

	if (
		!isBlank(dbkUnit) &&
		!isBlank(sqcUnit) &&
		dbkUnit!.trim().toUpperCase() === sqcUnit!.trim().toUpperCase()
	) {
		return `=O${excelRowIndex}`;
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

	// Rule 4: dbk_qty formula or default
	if (isDrawbackEligible) {
		if (isBlank(row.dbk_qty)) {
			const dbk = deriveDbkQty(row.dbk_unit, row.SQCUnit, row.Quantity, excelRowIndex, true);
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
