export interface AiRequestOptions {
	signal?: AbortSignal;
}

export interface AiApi {
	readonly provider: AiProvider;
	readonly apiKey: string;
	readonly modelId: string;
	request<TResponse>(payload: unknown, options?: AiRequestOptions): Promise<TResponse>;
	requestStream(payload: unknown, options?: AiRequestOptions): Promise<Response>;
}

export interface CreateAiApiOptions {
	provider?: AiProvider;
	apiKey: string;
	modelId: string;
	signal?: AbortSignal;
}

async function readAiError(response: Response): Promise<string> {
	try {
		const body: unknown = await response.json();
		if (
			typeof body === 'object' &&
			body !== null &&
			'error' in body &&
			typeof body.error === 'string'
		) {
			return body.error;
		}
	} catch {
		// Use the HTTP fallback when the response is not JSON.
	}

	return `AI request failed with HTTP ${response.status}.`;
}

export function createAiApi(options: CreateAiApiOptions): AiApi {
	const provider = options.provider ?? 'gemini';
	const apiKey = options.apiKey.trim();
	const modelId = options.modelId.trim();

	async function requestStream(
		payload: unknown,
		requestOptions: AiRequestOptions = {}
	): Promise<Response> {
		const response = await fetch('/api/ai', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-ai-provider': provider,
				'x-ai-api-key': apiKey,
				'x-ai-model-id': modelId
			},
			body: JSON.stringify(payload),
			signal: requestOptions.signal ?? options.signal
		});

		if (!response.ok) {
			throw new Error(await readAiError(response));
		}

		return response;
	}

	return {
		provider,
		apiKey,
		modelId,
		async request<TResponse>(
			payload: unknown,
			requestOptions: AiRequestOptions = {}
		): Promise<TResponse> {
			const response = await requestStream(payload, requestOptions);
			return (await response.json()) as TResponse;
		},
		requestStream
	};
}
import type { AiProvider } from './providers';
