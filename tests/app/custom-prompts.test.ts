import { describe, it, expect } from 'bun:test';

const CUSTOM_PROMPTS_KEY = 'xlsx-ai:custom-prompts:v1';

interface CustomPrompt {
	id: string;
	shortcut: string;
	prompt: string;
	label: string;
}

const DEFAULT_CUSTOM_PROMPTS: CustomPrompt[] = [
	{
		id: 'default-summarize',
		shortcut: '/summarize',
		label: 'Summarize dataset',
		prompt: 'Summarize key patterns and anomalies in this dataset.'
	},
	{
		id: 'default-format',
		shortcut: '/format',
		label: 'Check formatting',
		prompt: 'Check data consistency, typos, and formatting across all columns.'
	}
];

// Mirrors PromptsSection.svelte / AiDrawer.svelte helpers.
function normalizeShortcut(value: string): string {
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) return '';
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function hydrateCustomPrompts(raw: string | null): CustomPrompt[] {
	try {
		if (!raw) return [...DEFAULT_CUSTOM_PROMPTS];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [...DEFAULT_CUSTOM_PROMPTS];
		const items = (parsed as Array<Record<string, unknown>>)
			.filter(
				(p) =>
					!!p &&
					typeof p === 'object' &&
					typeof p.id === 'string' &&
					typeof p.shortcut === 'string' &&
					typeof p.prompt === 'string'
			)
			.map((p) => ({
				id: p.id as string,
				shortcut: normalizeShortcut(p.shortcut as string),
				prompt: p.prompt as string,
				label:
					typeof p.label === 'string' && (p.label as string).trim()
						? (p.label as string)
						: (p.prompt as string).slice(0, 28)
			}))
			.filter((p) => p.shortcut && p.prompt.trim());
		return items.length > 0 ? items : [...DEFAULT_CUSTOM_PROMPTS];
	} catch {
		return [...DEFAULT_CUSTOM_PROMPTS];
	}
}

function expandShortcut(text: string, prompts: CustomPrompt[]): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith('/')) return text;
	const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
	const match = prompts.find((p) => p.shortcut.toLowerCase() === firstToken);
	if (!match) return text;
	const rest = trimmed.slice(firstToken.length);
	return `${match.prompt}${rest}`;
}

function filterSlashMatches(input: string, prompts: CustomPrompt[]): CustomPrompt[] {
	if (!input.startsWith('/')) return [];
	const token = input.split(' ')[0]?.toLowerCase() ?? '';
	if (!token) return [];
	return prompts.filter((p) => p.shortcut.toLowerCase().startsWith(token));
}

interface Usage {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
}

// Mirrors the msg-stats badge rendering in AiDrawer.svelte.
function formatStats(usage?: Usage, latencyMs?: number): string | null {
	if (!latencyMs && !usage?.totalTokens) return null;
	const parts: string[] = [];
	if (usage?.totalTokens) parts.push(`${usage.totalTokens.toLocaleString('en-US')} tokens`);
	if (latencyMs) parts.push(`${(latencyMs / 1000).toFixed(1)}s`);
	return parts.join(' • ');
}

describe('Custom prompt shortcut normalization', () => {
	it('auto-prefixes a bare word with /', () => {
		expect(normalizeShortcut('audit')).toBe('/audit');
		expect(normalizeShortcut('/audit')).toBe('/audit');
	});

	it('trims whitespace and lowercases', () => {
		expect(normalizeShortcut('  /Audit  ')).toBe('/audit');
	});

	it('returns empty for blank input', () => {
		expect(normalizeShortcut('')).toBe('');
		expect(normalizeShortcut('   ')).toBe('');
	});
});

describe('Custom prompt hydration', () => {
	it('falls back to defaults when storage is empty or corrupt', () => {
		expect(hydrateCustomPrompts(null)).toEqual(DEFAULT_CUSTOM_PROMPTS);
		expect(hydrateCustomPrompts('')).toEqual(DEFAULT_CUSTOM_PROMPTS);
		expect(hydrateCustomPrompts('not-json{{{')).toEqual(DEFAULT_CUSTOM_PROMPTS);
		expect(hydrateCustomPrompts(JSON.stringify({ not: 'an array' }))).toEqual(
			DEFAULT_CUSTOM_PROMPTS
		);
	});

	it('falls back to defaults when every entry is invalid', () => {
		expect(
			hydrateCustomPrompts(JSON.stringify([{ id: 'x' }, { prompt: 'no id' }, 'junk', null]))
		).toEqual(DEFAULT_CUSTOM_PROMPTS);
	});

	it('round-trips valid prompts and normalizes shortcuts', () => {
		const raw = JSON.stringify([
			{ id: 'cp-1', shortcut: 'audit', label: 'Audit', prompt: 'Audit this dataset.' }
		]);
		expect(hydrateCustomPrompts(raw)).toEqual([
			{ id: 'cp-1', shortcut: '/audit', label: 'Audit', prompt: 'Audit this dataset.' }
		]);
	});

	it('falls back the label to the first 28 chars of the prompt', () => {
		const prompt = 'Label falls back to prompt slice text here';
		const raw = JSON.stringify([{ id: 'cp-2', shortcut: '/x', prompt }]);
		expect(hydrateCustomPrompts(raw)).toEqual([
			{ id: 'cp-2', shortcut: '/x', label: prompt.slice(0, 28), prompt }
		]);
	});
});

describe('Slash shortcut expansion', () => {
	const prompts: CustomPrompt[] = [
		{ id: 'cp-1', shortcut: '/audit', label: 'Audit', prompt: 'Audit this dataset.' },
		{ id: 'cp-2', shortcut: '/format', label: 'Format', prompt: 'Check formatting.' }
	];

	it('expands a bare shortcut to the full prompt', () => {
		expect(expandShortcut('/audit', prompts)).toBe('Audit this dataset.');
	});

	it('keeps trailing text after the shortcut', () => {
		expect(expandShortcut('/audit focus on taxes', prompts)).toBe('Audit this dataset. focus on taxes');
	});

	it('matches case-insensitively', () => {
		expect(expandShortcut('/AUDIT', prompts)).toBe('Audit this dataset.');
	});

	it('leaves plain text and unknown shortcuts untouched', () => {
		expect(expandShortcut('hello world', prompts)).toBe('hello world');
		expect(expandShortcut('/unknown thing', prompts)).toBe('/unknown thing');
	});

	it('filters autocomplete matches by typed prefix', () => {
		expect(filterSlashMatches('/', prompts).length).toBe(2);
		expect(filterSlashMatches('/a', prompts).map((p) => p.shortcut)).toEqual(['/audit']);
		expect(filterSlashMatches('/f', prompts).map((p) => p.shortcut)).toEqual(['/format']);
		expect(filterSlashMatches('/z', prompts)).toEqual([]);
		expect(filterSlashMatches('hello', prompts)).toEqual([]);
	});
});

describe('Token & latency stats formatting', () => {
	it('formats tokens with thousands separators', () => {
		expect(formatStats({ totalTokens: 1240 }, undefined)).toBe('1,240 tokens');
	});

	it('formats latency in seconds with one decimal', () => {
		expect(formatStats(undefined, 1800)).toBe('1.8s');
	});

	it('joins tokens and latency with a bullet', () => {
		expect(formatStats({ totalTokens: 1240 }, 1800)).toBe('1,240 tokens • 1.8s');
	});

	it('returns null when there is nothing to show', () => {
		expect(formatStats(undefined, undefined)).toBeNull();
		expect(formatStats({}, 0)).toBeNull();
	});
});

describe('AiDrawer.svelte custom prompts & stats wiring', () => {
	async function drawerSource(): Promise<string> {
		return await Bun.file('src/lib/components/AiDrawer.svelte').text();
	}

	async function apiSource(): Promise<string> {
		return await Bun.file('src/routes/api/ai/+server.ts').text();
	}

	it('reads custom prompts from the versioned localStorage key', async () => {
		const src = await drawerSource();
		expect(src).toContain(CUSTOM_PROMPTS_KEY);
		expect(src).toContain('customPrompts');
		expect(src).toContain('localStorage');
	});

	it('renders a slash autocomplete menu above the input', async () => {
		const src = await drawerSource();
		expect(src).toContain('slashMatches');
		expect(src).toContain('showSlashMenu');
		expect(src).toContain('slash-menu');
		expect(src).toContain('applySlashMatch');
	});

	it('expands shortcuts before sending', async () => {
		const src = await drawerSource();
		expect(src).toContain('expandShortcut');
	});

	it('has no bookmark chips or star affordance left', async () => {
		const src = await drawerSource();
		expect(src).not.toContain('promptBookmarks');
		expect(src).not.toContain('BOOKMARKS_KEY');
		expect(src).not.toContain('saveBookmarks');
		expect(src).not.toContain('addBookmark');
		expect(src).not.toContain('removeBookmark');
		expect(src).not.toContain('Icon name="star"');
		expect(src).not.toContain('bookmark-chip');
	});

	it('has no Top 5 example prompt left', async () => {
		const src = await drawerSource();
		expect(src).not.toContain('Top 5 by');
		expect(src).toContain('Summarize dataset');
		expect(src).toContain('Break down by');
	});

	it('uses a minimal ghost copy button beside the token stats', async () => {
		const src = await drawerSource();
		expect(src).toContain('ghost-copy-btn');
		expect(src).toContain('msg-footer');
		expect(src).toContain('aria-label="Copy message text"');
		expect(src).toContain('title="Copy"');
		expect(src).toContain('aria-label="Copy SVG source"');
		expect(src).not.toContain('<span>Copy</span>');
		expect(src).not.toContain('<span>Copy SVG</span>');
		expect(src).not.toContain('msg-action-btn');
	});

	it('tracks usage and latency on assistant messages and renders the badge', async () => {
		const src = await drawerSource();
		expect(src).toContain('reqStart');
		expect(src).toContain('performance.now()');
		expect(src).toContain('usage');
		expect(src).toContain('latencyMs');
		expect(src).toContain('msg-stats');
		expect(src).toContain('tokens');
		expect(src).toContain('usage?.totalTokens');
		expect(src).toContain('latencyMs ?? Math.round(performance.now() - reqStart)');
	});

	it('captures token usage and latency in the AI endpoint', async () => {
		const src = await apiSource();
		expect(src).toContain('const startTime = performance.now()');
		expect(src).toContain('chat.usage');
		expect(src).toContain('promptTokens');
		expect(src).toContain('completionTokens');
		expect(src).toContain('totalTokens');
		expect(src).toContain('latencyMs');
		expect(src).toContain('Math.round(performance.now() - startTime)');
	});
});

describe('Settings Custom Prompts section wiring', () => {
	async function settingsSource(): Promise<string> {
		return await Bun.file('src/routes/settings/+page.svelte').text();
	}

	async function promptsSource(): Promise<string> {
		return await Bun.file('src/lib/components/settings/PromptsSection.svelte').text();
	}

	it('adds a Custom Prompts tab to settings', async () => {
		const src = await settingsSource();
		expect(src).toContain("'prompts'");
		expect(src).toContain('Custom Prompts');
		expect(src).toContain('PromptsSection');
		expect(src).toContain('/shortcut');
	});

	it('persists prompts under the versioned localStorage key with shortcut/prompt/label', async () => {
		const src = await promptsSource();
		expect(src).toContain(CUSTOM_PROMPTS_KEY);
		expect(src).toContain('shortcut');
		expect(src).toContain('Save Prompt');
		expect(src).toContain('/summarize');
		expect(src).toContain('/format');
	});
});
