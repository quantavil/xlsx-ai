import { afterEach, describe, expect, it } from 'vitest';
import { createAiApi } from '../../src/lib/ai/client';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('shared AI client capability', () => {
	it('sends JSON requests through the existing AI endpoint with current credentials and signal', async () => {
		const controller = new AbortController();
		let capturedRequest: Request | undefined;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const requestInput =
				typeof input === 'string' ? new URL(input, 'http://localhost') : input;
			capturedRequest = new Request(requestInput, init);
			return Response.json({ success: true, data: { rows: 2 } });
		}) as typeof fetch;

		const ai = createAiApi({
			apiKey: 'AIzaSyValidTestKey123456789012345',
			modelId: 'gemini-2.5-flash',
			signal: controller.signal
		});
		const result = await ai.request<{ success: boolean; data: { rows: number } }>({
			operation: { kind: 'module', moduleId: 'icegrid', action: 'extract' },
			input: { content: 'invoice' }
		});

		expect(result.data.rows).toBe(2);
		expect(ai.apiKey).toBe('AIzaSyValidTestKey123456789012345');
		expect(ai.modelId).toBe('gemini-2.5-flash');
		expect(capturedRequest?.url).toBe('http://localhost/api/ai');
		expect(capturedRequest?.headers.get('x-ai-api-key')).toBe('AIzaSyValidTestKey123456789012345');
		expect(capturedRequest?.headers.get('x-ai-model-id')).toBe('gemini-2.5-flash');
		expect(capturedRequest?.signal).toBe(controller.signal);
		expect(await capturedRequest?.json()).toEqual({
			operation: { kind: 'module', moduleId: 'icegrid', action: 'extract' },
			input: { content: 'invoice' }
		});
	});

	it('returns an unconsumed response for streaming operations', async () => {
		globalThis.fetch = (async () => new Response('first chunk')) as unknown as typeof fetch;
		const ai = createAiApi({
			apiKey: 'AIzaSyValidTestKey123456789012345',
			modelId: 'gemini-2.5-flash'
		});

		const response = await ai.requestStream({ tableContext: { columns: [], rows: [] } });

		expect(await response.text()).toBe('first chunk');
	});

	it('surfaces the readable server error for failed requests', async () => {
		globalThis.fetch = (async () =>
			Response.json({ error: 'Gemini rate limit reached.' }, { status: 429 })) as unknown as typeof fetch;
		const ai = createAiApi({
			apiKey: 'AIzaSyValidTestKey123456789012345',
			modelId: 'gemini-2.5-flash'
		});

		await expect(ai.request({ operation: { kind: 'qa' } })).rejects.toThrow(
			'Gemini rate limit reached.'
		);
	});
});
