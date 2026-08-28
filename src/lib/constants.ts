import type { ColumnType, CellValue } from './types';
import type { IconName } from './components/Icons.svelte';
import { numericCellValue } from './table/cells';




export const DEFAULT_TABLE_TITLE = 'Untitled Table';
export const MAX_HISTORY = 30;
export const LS_KEY = 'table-ai:v1';
export const LS_THEME_KEY = 'table-ai:theme';
export const LS_API_KEY = 'table-ai:gemini-key';
export const LS_AI_MODEL = 'table-ai:gemini-model';

export const DEFAULT_AI_MODEL = 'gemini-3.5-flash-lite';

export interface AiModelConfig {
	id: string;
	name: string;
	description: string;
	badge?: string;
	speed: 'Fast' | 'Ultra-Fast' | 'Balanced';
	contextWindow: string;
}

export const AI_MODELS: AiModelConfig[] = [
	{
		id: 'gemini-3.5-flash-lite',
		name: 'Gemini 3.5 Flash Lite',
		description: 'Ultra-fast, cost-efficient model optimized for instant table analysis and transforms.',
		badge: 'Default',
		speed: 'Ultra-Fast',
		contextWindow: '1M tokens'
	},
	{
		id: 'gemini-3.7-flash',
		name: 'Gemini 3.7 Flash',
		description: 'Latest high-speed multimodal model for advanced tabular analytics and high-throughput transformations.',
		speed: 'Ultra-Fast',
		contextWindow: '1M tokens'
	},
	{
		id: 'gemini-3.1-pro',
		name: 'Gemini 3.1 Pro',
		description: 'Advanced reasoning model for complex multi-step table transformations and deep analysis.',
		badge: 'Pro',
		speed: 'Balanced',
		contextWindow: '2M tokens'
	}
];



const numberFormatter = new Intl.NumberFormat('en-US', {
	maximumFractionDigits: 2
});

const currencyFormatter = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 2
});

const percentFormatter = new Intl.NumberFormat('en-US', {
	style: 'percent',
	minimumFractionDigits: 1,
	maximumFractionDigits: 2
});

export function formatCellValue(type: ColumnType | string | undefined, value: CellValue | undefined): string {
	if (value === null || value === undefined || value === '') {
		return '';
	}

	if (typeof value === 'boolean') {
		return value ? 'Yes' : 'No';
	}

	const safeType = type || 'text';

	if (safeType === 'number') {
		const num = numericCellValue('number', value);
		return num === null ? String(value) : numberFormatter.format(num);
	}

	if (safeType === 'currency') {
		const num = numericCellValue('currency', value);
		return num === null ? String(value) : currencyFormatter.format(num);
	}

	if (safeType === 'percent') {
		const num = numericCellValue('percent', value);
		return num === null ? String(value) : percentFormatter.format(num);
	}

	if (safeType === 'date') {
		// Show exactly as stored — dates can have many user formats (MM/DD/YYYY, DD-MM-YYYY, ISO, etc.)
		// Don't reformat via Date parsing; preserve raw string so export/import stays lossless.
		return String(value);
	}

	return String(value);
}

export const COLUMN_TYPE_CONFIG: Record<
	ColumnType,
	{
		label: string;
		icon: IconName;
		formatter: (v: CellValue | undefined) => string;
		summarizable: boolean;
	}
> = {
	text: {
		label: 'Text',
		icon: 'type',
		formatter: (v: CellValue | undefined) => formatCellValue('text', v),
		summarizable: false
	},
	number: {
		label: 'Number',
		icon: 'hash',
		formatter: (v: CellValue | undefined) => formatCellValue('number', v),
		summarizable: true
	},
	currency: {
		label: 'Currency',
		icon: 'dollar-sign',
		formatter: (v: CellValue | undefined) => formatCellValue('currency', v),
		summarizable: true
	},
	percent: {
		label: 'Percent',
		icon: 'percent',
		formatter: (v: CellValue | undefined) => formatCellValue('percent', v),
		summarizable: true
	},
	dropdown: {
		label: 'Dropdown',
		icon: 'chevron-down',
		formatter: (v: CellValue | undefined) => formatCellValue('dropdown', v),
		summarizable: false
	},
	status: {
		label: 'Dropdown',
		icon: 'chevron-down',
		formatter: (v: CellValue | undefined) => formatCellValue('status', v),
		summarizable: false
	},
	date: {
		label: 'Date',
		icon: 'calendar',
		formatter: (v: CellValue | undefined) => formatCellValue('date', v),
		summarizable: false
	}
};

const DROPDOWN_PALETTES = [
	{ bg: 'rgba(16, 185, 129, 0.12)', text: '#10b981', border: 'rgba(16, 185, 129, 0.25)' },
	{ bg: 'rgba(14, 165, 233, 0.12)', text: '#0ea5e9', border: 'rgba(14, 165, 233, 0.25)' },
	{ bg: 'rgba(139, 92, 246, 0.12)', text: '#8b5cf6', border: 'rgba(139, 92, 246, 0.25)' },
	{ bg: 'rgba(245, 158, 11, 0.12)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.25)' },
	{ bg: 'rgba(244, 63, 94, 0.12)', text: '#f43f5e', border: 'rgba(244, 63, 94, 0.25)' },
	{ bg: 'rgba(20, 184, 166, 0.12)', text: '#14b8a6', border: 'rgba(20, 184, 166, 0.25)' },
	{ bg: 'rgba(99, 102, 241, 0.12)', text: '#6366f1', border: 'rgba(99, 102, 241, 0.25)' },
	{ bg: 'rgba(249, 115, 22, 0.12)', text: '#f97316', border: 'rgba(249, 115, 22, 0.25)' },
	{ bg: 'rgba(100, 116, 139, 0.12)', text: '#94a3b8', border: 'rgba(100, 116, 139, 0.22)' }
];

// Semantic overrides — known statuses/products get intentional colors, everything else hashes.
const SEMANTIC_DROPDOWN_MAP: Record<string, { bg: string; text: string; border: string }> = {
	'closed won': { bg: 'rgba(16, 185, 129, 0.16)', text: '#10b981', border: 'rgba(16, 185, 129, 0.32)' },
	'closed lost': { bg: 'rgba(244, 63, 94, 0.14)', text: '#fb7185', border: 'rgba(244, 63, 94, 0.28)' },
	won: { bg: 'rgba(16, 185, 129, 0.14)', text: '#10b981', border: 'rgba(16, 185, 129, 0.25)' },
	lost: { bg: 'rgba(244, 63, 94, 0.14)', text: '#f43f5e', border: 'rgba(244, 63, 94, 0.25)' },
	negotiation: { bg: 'rgba(245, 158, 11, 0.14)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.28)' },
	proposal: { bg: 'rgba(14, 165, 233, 0.14)', text: '#0ea5e9', border: 'rgba(14, 165, 233, 0.25)' },
	discovery: { bg: 'rgba(139, 92, 246, 0.14)', text: '#a78bfa', border: 'rgba(139, 92, 246, 0.28)' },
	active: { bg: 'rgba(16, 185, 129, 0.14)', text: '#10b981', border: 'rgba(16, 185, 129, 0.25)' },
	trial: { bg: 'rgba(14, 165, 233, 0.14)', text: '#38bdf8', border: 'rgba(14, 165, 233, 0.25)' },
	pending: { bg: 'rgba(245, 158, 11, 0.14)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.25)' },
	churned: { bg: 'rgba(100, 116, 139, 0.16)', text: '#94a3b8', border: 'rgba(100, 116, 139, 0.28)' },
	'in stock': { bg: 'rgba(16, 185, 129, 0.14)', text: '#10b981', border: 'rgba(16, 185, 129, 0.25)' },
	'low stock': { bg: 'rgba(245, 158, 11, 0.14)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.28)' },
	'out of stock': { bg: 'rgba(244, 63, 94, 0.14)', text: '#f43f5e', border: 'rgba(244, 63, 94, 0.25)' }
};

export function getDropdownStyle(value: string): { bg: string; text: string; border: string } {
	const key = String(value || '').trim().toLowerCase();
	if (!key) return { bg: 'transparent', text: 'var(--text-3)', border: 'transparent' };
	if (SEMANTIC_DROPDOWN_MAP[key]) return SEMANTIC_DROPDOWN_MAP[key];

	let hash = 0;
	for (let i = 0; i < key.length; i++) {
		hash = (hash << 5) - hash + key.charCodeAt(i);
		hash |= 0;
	}
	const index = Math.abs(hash) % DROPDOWN_PALETTES.length;
	return DROPDOWN_PALETTES[index];
}

// single alias, no duplicate function
export const getStatusStyle = getDropdownStyle;
