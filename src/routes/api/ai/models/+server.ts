import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { DEFAULT_AI_MODEL } from '$lib/constants';
import {
	isSupportedModelId,
	parseAiProvider,
	providerLabel,
	type AiProvider
} from '$lib/ai/providers';

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

const OpenRouterModelSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	description: z.string().optional(),
	context_length: z.number().optional(),
	supported_parameters: z.array(z.string()).optional(),
	architecture: z.object({ output_modalities: z.array(z.string()).optional() }).optional()
});

const OpenRouterModelsSchema = z.object({ data: z.array(OpenRouterModelSchema) });

function contextWindow(tokens?: number): string {
	if (!tokens) return 'Unknown';
	if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M tokens`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k tokens`;
	return `${tokens} tokens`;
}

async function providerFetch(url: string, headers: HeadersInit): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 10_000);
	try {
		return await fetch(url, { method: 'GET', headers, signal: controller.signal });
	} finally {
		clearTimeout(timeoutId);
	}
}

function upstreamError(provider: AiProvider, status: number): Response {
	const label = providerLabel(provider);
	if (status === 401 || status === 403) {
		return json({ error: `Invalid or unauthorized ${label} API key.` }, { status: 401 });
	}
	if (status === 429) {
		return json({ error: `${label} model listing rate limit exceeded.` }, { status: 429 });
	}
	return json({ error: `${label} API returned HTTP ${status}.` }, { status });
}

async function listGeminiModels(apiKey: string): Promise<Response> {
	const allRawModels: z.infer<typeof GoogleModelItemSchema>[] = [];
	let pageToken: string | undefined;
	const seenTokens = new Set<string>();
	let pageCount = 0;

	do {
		if (pageToken) {
			if (seenTokens.has(pageToken) || pageCount >= 5) break;
			seenTokens.add(pageToken);
		}
		pageCount++;
		const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
		url.searchParams.set('pageSize', '100');
		if (pageToken) url.searchParams.set('pageToken', pageToken);
		const response = await providerFetch(url.toString(), {
			'Content-Type': 'application/json',
			'x-goog-api-key': apiKey
		});
		if (!response.ok) return upstreamError('gemini', response.status);
		const parsed = GoogleModelsPageSchema.safeParse(await response.json());
		if (!parsed.success) {
			return json({ error: 'Unexpected response schema from Google Gemini.' }, { status: 502 });
		}
		allRawModels.push(...(parsed.data.models ?? []));
		pageToken = parsed.data.nextPageToken;
	} while (pageToken && allRawModels.length < 500);

	const models = allRawModels
		.filter((item) => {
			const id = item.name.replace(/^models\//, '');
			const methods = item.supportedGenerationMethods ?? [];
			return isSupportedModelId('gemini', id) && (methods.length === 0 || methods.includes('generateContent'));
		})
		.map((item) => {
			const id = item.name.replace(/^models\//, '');
			let speed: 'Ultra-Fast' | 'Fast' | 'Balanced' = 'Fast';
			if (id.includes('flash-lite') || id.includes('flash')) speed = 'Ultra-Fast';
			else if (id.includes('pro') || id.includes('thinking')) speed = 'Balanced';
			let badge: string | undefined;
			if (id === DEFAULT_AI_MODEL) badge = 'Default';
			else if (id.includes('pro')) badge = 'Pro';
			else if (id.includes('exp') || id.includes('preview')) badge = 'Preview';
			return {
				id,
				name: item.displayName || id,
				description: item.description || `Official Google Generative Model (${id}).`,
				badge,
				speed,
				contextWindow: contextWindow(item.inputTokenLimit)
			};
		});
	models.sort((a, b) => {
		if (a.id === DEFAULT_AI_MODEL) return -1;
		if (b.id === DEFAULT_AI_MODEL) return 1;
		return b.id.localeCompare(a.id, undefined, { numeric: true });
	});
	return json({ success: true, count: models.length, models });
}

async function listOpenRouterModels(apiKey: string): Promise<Response> {
	const response = await providerFetch('https://openrouter.ai/api/v1/models?output_modalities=text', {
		Authorization: `Bearer ${apiKey}`,
		'Content-Type': 'application/json'
	});
	if (!response.ok) return upstreamError('openrouter', response.status);
	const parsed = OpenRouterModelsSchema.safeParse(await response.json());
	if (!parsed.success) {
		return json({ error: 'Unexpected response schema from OpenRouter.' }, { status: 502 });
	}
	const models = parsed.data.data
		.filter(
			(item) =>
				isSupportedModelId('openrouter', item.id) &&
				(item.architecture?.output_modalities ?? []).includes('text') &&
				(item.supported_parameters ?? []).includes('structured_outputs')
		)
		.map((item) => ({
			id: item.id,
			name: item.name || item.id,
			description: item.description || `OpenRouter model (${item.id}).`,
			speed: 'Balanced' as const,
			contextWindow: contextWindow(item.context_length)
		}))
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
	return json({ success: true, count: models.length, models });
}

export const GET: RequestHandler = async ({ request }) => {
	const providerHeader = request.headers.get('x-ai-provider');
	const provider = providerHeader === null ? 'gemini' : parseAiProvider(providerHeader);
	if (!provider) return json({ error: 'Unsupported AI provider.' }, { status: 400 });
	const apiKey = request.headers.get('x-ai-api-key')?.trim();
	if (!apiKey || apiKey.length < 15) {
		const keyLabel = provider === 'gemini' ? 'Gemini' : providerLabel(provider);
		return json(
			{ error: `A valid ${keyLabel} API key is required to fetch available models.` },
			{ status: 401 }
		);
	}
	try {
		return provider === 'gemini' ? await listGeminiModels(apiKey) : await listOpenRouterModels(apiKey);
	} catch (error: unknown) {
		if (error instanceof Error && error.name === 'AbortError') {
			return json({ error: `Model request to ${providerLabel(provider)} timed out.` }, { status: 504 });
		}
		return json({ error: `Failed to connect to ${providerLabel(provider)} endpoint.` }, { status: 502 });
	}
};
