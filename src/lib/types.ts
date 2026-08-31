export type ColumnType = 'text' | 'number' | 'currency' | 'percent' | 'dropdown' | 'date';

export type CellValue = string | number | boolean | null;

/**
 * What a coupled cell receives: a literal, or another column read from the same row.
 *
 * The reference exists because a rule can name a sibling rather than a constant -
 * a drawback serial the schedule gives no unit for is claimed in the unit the goods
 * were invoiced in, which is per row and so cannot be baked into a shared option.
 */
export type FillValue = CellValue | { from: string };

/** One selectable entry in a `dropdown` column's configured option list. */
export interface DropdownOption {
	/** The value stored in the cell and written to the exported workbook. */
	value: string;
	/** Descriptive text shown beside the value, e.g. `08 — RAJASTHAN`. Never stored. */
	label?: string;
	/** Dependency key: a district's state code, matched against `dependsOnColumnId`. */
	parentValue?: string;
	/**
	 * Sibling cells in the same row that this option's value determines, keyed by
	 * column id. Selecting the option writes them alongside it in one undo step, so
	 * a drawback serial cannot sit next to the rate of the serial it replaced.
	 */
	fills?: Record<string, FillValue>;
	/**
	 * The same, but written only where the target cell is still empty.
	 *
	 * For a value this option merely implies rather than determines: a unit of measure
	 * governs the drawback unit only when nothing better already stated it, so picking
	 * one must not overwrite a unit the document printed or the schedule prescribed.
	 * A blank target is the evidence that neither of those spoke.
	 */
	fillsIfBlank?: Record<string, FillValue>;
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

export type IconName =
	| 'table'
	| 'sparkles'
	| 'sparkle'
	| 'plus'
	| 'download'
	| 'upload'
	| 'undo'
	| 'redo'
	| 'search'
	| 'sun'
	| 'moon'
	| 'chevron-up'
	| 'chevron-down'
	| 'chevrons-up-down'
	| 'arrow-left'
	| 'file-spreadsheet'
	| 'file-text'
	| 'edit'
	| 'layers'
	| 'trash'
	| 'copy'
	| 'more-horizontal'
	| 'check'
	| 'x'
	| 'key'
	| 'eye'
	| 'eye-off'
	| 'send'
	| 'wand'
	| 'bar-chart'
	| 'rotate-ccw'
	| 'bot'
	| 'user'
	| 'info'
	| 'check-circle'
	| 'alert-triangle'
	| 'alert-circle'
	| 'type'
	| 'hash'
	| 'dollar-sign'
	| 'percent'
	| 'tag'
	| 'calendar'
	| 'settings'
	| 'keyboard'
	| 'align-left'
	| 'align-center'
	| 'align-right'
	| 'cursor-mode'
	| 'database'
	| 'save'
	| 'external-link'
	| 'star'
	| 'star-filled'
	| 'loader';


