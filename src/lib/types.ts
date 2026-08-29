export type ColumnType = 'text' | 'number' | 'currency' | 'percent' | 'dropdown' | 'date';

export type CellValue = string | number | boolean | null;

/** One selectable entry in a `dropdown` column's configured option list. */
export interface DropdownOption {
	/** The value stored in the cell and written to the exported workbook. */
	value: string;
	/** Descriptive text shown beside the value, e.g. `08 — RAJASTHAN`. Never stored. */
	label?: string;
	/** Dependency key: a district's state code, matched against `dependsOnColumnId`. */
	parentValue?: string;
}

export interface DropdownConfig {
	options: DropdownOption[];
	/** When false, the editor offers no `+ Add` and refuses unknown typed values. */
	allowCustom: boolean;
	/** Show only options whose `parentValue` matches this column's value in the same row. */
	dependsOnColumnId?: string;
}

export interface Column {
	id: string;
	name: string;
	type: ColumnType;
	width?: number;
	/** Only meaningful when `type === 'dropdown'`; stripped from other columns. */
	dropdown?: DropdownConfig;
}

export type Row = { id: string; [key: string]: CellValue };

export type CellAlign = 'left' | 'center' | 'right';

/** Per-cell horizontal alignment overrides, keyed `rowId::columnId`. */
export type CellAlignMap = Record<string, CellAlign>;

export interface TableData {
	title: string;
	columns: Column[];
	rows: Row[];
	cellAlign?: CellAlignMap;
}

export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
	columnId: string;
	direction: SortDirection;
}

export interface ColumnSummary {
	count: number;
	countNonEmpty: number;
	sum?: number;
	avg?: number;
	min?: number;
	max?: number;
}

export interface HistoryEntry {
	title: string;
	columns: Column[];
	rows: Row[];
	cellAlign: CellAlignMap;
}

