import type { ColumnType, CellValue } from './types';
import type { IconName } from './components/Icons.svelte';
import { numericCellValue } from './table/cells';




export const DEFAULT_TABLE_TITLE = 'Untitled Table';
export const MAX_HISTORY = 30;
export const LS_KEY = 'xlsx-ai:v1';
export const LS_THEME_KEY = 'xlsx-ai:theme';
export const LS_API_KEY = 'xlsx-ai:gemini-key';
export const LS_AI_MODEL = 'xlsx-ai:gemini-model';
/** `{ keys: string[]; active: number }`. Supersedes LS_API_KEY, which is migrated in. */
export const LS_API_KEYS = 'xlsx-ai:gemini-keys';
/** Model ids starred in Settings; the chat switcher offers these instead of the full list. */
export const LS_FAV_MODELS = 'xlsx-ai:gemini-favorites';

/** Last 4 characters, enough to tell two saved keys apart without showing either. */
export function maskApiKey(key: string): string {
	return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}

export const DEFAULT_AI_MODEL = 'gemini-3.5-flash-lite';

// Ids this app once shipped that Google never served. A workspace still holding one of
// these gets moved to the default rather than 404ing on its next request.
export const RETIRED_AI_MODELS = ['gemini-3.7-flash-lite'];

export interface AiModelConfig {
	id: string;
	name: string;
	description: string;
	badge?: string;
	speed: 'Fast' | 'Ultra-Fast' | 'Balanced';
	contextWindow: string;
}

// Offline fallback catalog shown before a key is saved. Every id here must be a real
// Generative Language API model — "Fetch Live Models" replaces this list once a key exists.
export const AI_MODELS: AiModelConfig[] = [
	{
		id: 'gemini-3.5-flash-lite',
		name: 'Gemini 3.5 Flash Lite',
		description: 'Cheapest ultra low-latency option for bulk document parsing and fast table transforms.',
		badge: 'Default',
		speed: 'Ultra-Fast',
		contextWindow: '1M tokens'
	},
	{
		id: 'gemini-3.6-flash',
		name: 'Gemini 3.6 Flash',
		description: 'Flash-class workhorse — stronger document extraction and tabular reasoning, still a few seconds a call.',
		speed: 'Fast',
		contextWindow: '1M tokens'
	},
	{
		id: 'gemini-3.1-pro-preview',
		name: 'Gemini 3.1 Pro',
		description: 'Deepest reasoning for messy multi-invoice documents and complex multi-step transformations.',
		badge: 'Pro',
		speed: 'Balanced',
		contextWindow: '1M tokens'
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
	date: {
		label: 'Date',
		icon: 'calendar',
		formatter: (v: CellValue | undefined) => formatCellValue('date', v),
		summarizable: false
	}
};

// No hardcoded palettes — deterministic hash → curated HSL, zero semantic map.
const _CURATED_HUES = [12, 25, 38, 145, 162, 199, 217, 262, 280, 330, 350, 190];
const _dropdownStyleCache = new Map<string, { bg: string; text: string; border: string }>();

export function getDropdownStyle(value: string): { bg: string; text: string; border: string } {
	const key = String(value || '').trim().toLowerCase();
	if (!key) return { bg: 'transparent', text: 'var(--text-3)', border: 'transparent' };
	const cached = _dropdownStyleCache.get(key);
	if (cached) return cached;
	let hash = 0;
	for (let i = 0; i < key.length; i++) {
		hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
	}
	const hue = _CURATED_HUES[hash % _CURATED_HUES.length];
	// The chip background is translucent and blends into whichever surface is behind it,
	// so it needs no theme of its own. The text does: one fixed lightness cannot clear
	// 4.5:1 against both a near-white and a near-black surface - the hues that read on
	// one are the ones that vanish on the other. `--chip-text-*` carries the theme's own
	// answer (see app.css); the literals here are the light-theme values, used only if
	// this ever renders outside the themed tree.
	const bg = `hsla(${hue} 80% 55% / 0.16)`;
	const text = `hsl(${hue} var(--chip-text-s, 72%) var(--chip-text-l, 26%))`;
	const border = `hsla(${hue} 80% 55% / 0.28)`;
	const style = { bg, text, border };
	_dropdownStyleCache.set(key, style);
	return style;
}
