export type ColumnType = 'text' | 'number' | 'currency' | 'percent' | 'dropdown' | 'date';

export type CellValue = string | number | boolean | null;

export interface Column {
	id: string;
	name: string;
	type: ColumnType;
	width?: number;
}

export type Row = { id: string; [key: string]: CellValue };

export interface TableData {
	title: string;
	columns: Column[];
	rows: Row[];
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

export type AiOperationKind = 'fill_missing' | 'clean' | 'summarize' | 'qa';

export interface AiTransformOperation {
	kind: AiOperationKind;
	targetColumnId?: string;
	prompt?: string;
}

export interface HistoryEntry {
	title: string;
	columns: Column[];
	rows: Row[];
}

export interface ToastMessage {
	id: string;
	type: 'info' | 'success' | 'warning' | 'error';
	message: string;
	duration?: number;
}
