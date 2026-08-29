declare module 'xlsx-calc' {
	/** Recalculates every `.f` cell of a SheetJS-shaped workbook in place, filling in `.v`. */
	export default function XLSX_CALC(workbook: {
		SheetNames: string[];
		Sheets: Record<string, Record<string, unknown>>;
	}): void;
}
