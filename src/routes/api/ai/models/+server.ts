import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { DEFAULT_AI_MODEL } from '$lib/constants';
import { isSupportedModelId } from '$lib/server/models';

const GoogleModelItemSchema = z.object({
	name: z.string(),
	displayName: z.string().optional(),
	description: z.string().optional(),
	supportedGenerationMethods: z.array(z.string()).optional(),
	inputTokenLimit: z.number().optional()
});

const GoogleModelsPageSchema = z.object({
	models: z.array(GoogleModelItemSchema).optional(),
	nextPageToken: z.string().optional()
});

export const GET: RequestHandler = async ({ request }) => {
	const apiKey = request.headers.get('x-ai-api-key')?.trim();

	if (!apiKey || apiKey.length < 15) {
		return json({ error: 'A valid Gemini API key is required to fetch available models.' }, { status: 401 });
	}

	try {
		const allRawModels: z.infer<typeof GoogleModelItemSchema>[] = [];
		let pageToken: string | undefined = undefined;
		const seenTokens = new Set<string>();
		let pageCount = 0;
		const MAX_PAGES = 5;

		do {
			if (pageToken) {
				if (seenTokens.has(pageToken) || pageCount >= MAX_PAGES) break;
				seenTokens.add(pageToken);
			}
			pageCount++;

			const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
			url.searchParams.set('pageSize', '100');
			if (pageToken) {
				url.searchParams.set('pageToken', pageToken);
			}

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 10_000);

			let res: Response;
			try {
				res = await fetch(url.toString(), {
					method: 'GET',
					headers: {
						'Content-Type': 'application/json',
						'x-goog-api-key': apiKey
					},
					signal: controller.signal
				});
			} finally {
				clearTimeout(timeoutId);
			}

			if (!res.ok) {
				if (res.status === 401 || res.status === 403) {
					return json({ error: 'Invalid or unauthorized Gemini API key.' }, { status: 401 });
				}
				if (res.status === 429) {
					return json({ error: 'Gemini model listing rate limit exceeded.' }, { status: 429 });
				}
				return json({ error: `Google AI API returned HTTP ${res.status}.` }, { status: res.status });
			}

			const jsonBody = await res.json();
			const parsed = GoogleModelsPageSchema.safeParse(jsonBody);
			if (!parsed.success) {
				return json({ error: 'Unexpected response schema from Google AI.' }, { status: 502 });
			}

			if (parsed.data.models) {
				allRawModels.push(...parsed.data.models);
			}

			pageToken = parsed.data.nextPageToken;
		} while (pageToken && allRawModels.length < 500);

		// Only list models the generation endpoint will actually accept.
		const eligibleModels = allRawModels.filter((m) => {
			const id = (m.name || '').replace(/^models\//, '');
			const methods: string[] = m.supportedGenerationMethods || [];
			if (!isSupportedModelId(id)) return false;
			return methods.length === 0 || methods.includes('generateContent');
		});

		const formattedModels = eligibleModels.map((m) => {
			const id = m.name.replace(/^models\//, '');
			const inputLimit = m.inputTokenLimit;
			let contextWindow = '1M tokens';
			if (inputLimit) {
				if (inputLimit >= 1_000_000) contextWindow = `${Math.round(inputLimit / 1_000_000)}M tokens`;
				else if (inputLimit >= 1_000) contextWindow = `${Math.round(inputLimit / 1_000)}k tokens`;
				else contextWindow = `${inputLimit} tokens`;
			}

			let speed: 'Ultra-Fast' | 'Fast' | 'Balanced' = 'Fast';
			if (id.includes('flash-lite')) speed = 'Ultra-Fast';
			else if (id.includes('pro') || id.includes('thinking')) speed = 'Balanced';
			else if (id.includes('flash')) speed = 'Ultra-Fast';

			let badge: string | undefined = undefined;
			if (id === DEFAULT_AI_MODEL) badge = 'Default';
			else if (id.includes('pro')) badge = 'Pro';
			else if (id.includes('exp') || id.includes('preview')) badge = 'Preview';

			return {
				id,
				name: m.displayName || id,
				description: m.description || `Official Google Generative Model (${id}).`,
				badge,
				speed,
				contextWindow
			};
		});

		// Default first, then newest-looking ids, then alphabetical.
		formattedModels.sort((a, b) => {
			if (a.id === DEFAULT_AI_MODEL) return -1;
			if (b.id === DEFAULT_AI_MODEL) return 1;
			return b.id.localeCompare(a.id, undefined, { numeric: true });
		});

		return json({
			success: true,
			count: formattedModels.length,
			models: formattedModels
		});
	} catch (err: unknown) {
		if (err instanceof Error && err.name === 'AbortError') {
			return json({ error: 'Model request to Google timed out.' }, { status: 504 });
		}
		return json({ error: 'Failed to connect to Google AI endpoint.' }, { status: 502 });
	}
};

