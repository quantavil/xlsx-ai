import { describe, it, expect } from 'bun:test';

const BOOKMARKS_KEY = 'xlsx-ai:prompt-bookmarks:v1';

interface PromptBookmark {
	id: string;
	label: string;
	prompt: string;
}

interface Usage {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
}

// Mirrors AiDrawer.svelte bookmark helpers.
function createBookmark(prompt: string, id = 'bm-test'): PromptBookmark {
	const text = prompt.trim();
	return { id, label: text.slice(0, 28), prompt: text };
}

function serializeBookmarks(items: PromptBookmark[]): string {
	return JSON.stringify(items);
}

function hydrateBookmarks(raw: string | null): PromptBookmark[] {
	try {
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return (parsed as Array<Record<string, unknown>>)
			.filter((b) => !!b && typeof b === 'object' && typeof b.id === 'string' && typeof b.prompt === 'string')
			.map((b) => ({
				id: b.id as string,
				label:
					typeof b.label === 'string' && (b.label as string).trim()
						? (b.label as string)
						: (b.prompt as string).slice(0, 28),
				prompt: b.prompt as string
			}));
	} catch {
		return [];
	}
}

// Mirrors the msg-stats badge rendering in AiDrawer.svelte.
function formatStats(usage?: Usage, latencyMs?: number): string | null {
	if (!latencyMs && !usage?.totalTokens) return null;
	const parts: string[] = [];
	if (usage?.totalTokens) parts.push(`${usage.totalTokens.toLocaleString('en-US')} tokens`);
	if (latencyMs) parts.push(`${(latencyMs / 1000).toFixed(1)}s`);
	return parts.join(' • ');
}

describe('Prompt bookmark serialization', () => {
	it('round-trips bookmarks through JSON', () => {
		const items: PromptBookmark[] = [
			createBookmark('Summarize this dataset by region', 'bm-1'),
			createBookmark('List the top 5 rows by Revenue', 'bm-2')
		];
		const revived = hydrateBookmarks(serializeBookmarks(items));
		expect(revived).toEqual(items);
	});

	it('truncates the label to the first 28 chars of the prompt', () => {
		const bm = createBookmark('  List the top 5 rows by Revenue and explain what they share  ');
		expect(bm.prompt).toBe('List the top 5 rows by Revenue and explain what they share');
		expect(bm.label).toBe('List the top 5 rows by Reven');
		expect(bm.label.length).toBeLessThanOrEqual(28);
	});

	it('hydrates to [] for empty, corrupt, or misshapen storage', () => {
		expect(hydrateBookmarks(null)).toEqual([]);
		expect(hydrateBookmarks('')).toEqual([]);
		expect(hydrateBookmarks('not-json{{{')).toEqual([]);
		expect(hydrateBookmarks(JSON.stringify({ not: 'an array' }))).toEqual([]);
		expect(
			hydrateBookmarks(JSON.stringify([{ id: 'bm-1' }, { prompt: 'no id' }, 'junk', null]))
		).toEqual([]);
	});

	it('drops bookmarks missing id or prompt but keeps valid ones', () => {
		const fallbackPrompt = 'Label falls back to prompt slice';
		const raw = JSON.stringify([
			{ id: 'bm-1', label: 'Good', prompt: 'Good prompt' },
			{ id: 'bm-2', prompt: fallbackPrompt }
		]);
		const revived = hydrateBookmarks(raw);
		expect(revived).toEqual([
			{ id: 'bm-1', label: 'Good', prompt: 'Good prompt' },
			{ id: 'bm-2', label: fallbackPrompt.slice(0, 28), prompt: fallbackPrompt }
		]);
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

describe('AiDrawer.svelte bookmarks & stats wiring', () => {
	async function drawerSource(): Promise<string> {
		return await Bun.file('src/lib/components/AiDrawer.svelte').text();
	}

	async function apiSource(): Promise<string> {
		return await Bun.file('src/routes/api/ai/+server.ts').text();
	}

	it('persists bookmarks under the versioned localStorage key', async () => {
		const src = await drawerSource();
		expect(src).toContain(BOOKMARKS_KEY);
		expect(src).toContain('saveBookmarks');
		expect(src).toContain('localStorage');
		expect(src).toContain("onNotify('info', 'Prompt bookmarked')");
	});

	it('renders bookmark chips with star affordance and delete capability', async () => {
		const src = await drawerSource();
		expect(src).toContain('promptBookmarks');
		expect(src).toContain('Icon name="star"');
		expect(src).toContain('Icon name="x"');
		expect(src).toContain('e.stopPropagation()');
		expect(src).toContain('removeBookmark');
		expect(src).toContain('promptInput = bm.prompt');
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

	it('keeps message copy actions icon-only with accessible labels', async () => {
		const src = await drawerSource();
		expect(src).toContain('aria-label="Copy message text"');
		expect(src).toContain('title="Copy"');
		expect(src).toContain('aria-label="Copy SVG source"');
		expect(src).not.toContain('<span>Copy</span>');
		expect(src).not.toContain('<span>Copy SVG</span>');
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
