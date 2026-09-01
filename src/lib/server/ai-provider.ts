import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import type { AiProvider } from '$lib/ai/providers';

export interface CreateAiLanguageModelOptions {
	provider: AiProvider;
	apiKey: string;
	modelId: string;
	appUrl?: string;
}

export function createAiLanguageModel(options: CreateAiLanguageModelOptions): LanguageModel {
	if (options.provider === 'gemini') {
		return createGoogleGenerativeAI({ apiKey: options.apiKey })(options.modelId);
	}

	const openrouter = createOpenRouter({
		apiKey: options.apiKey,
		appName: 'xlsx-ai',
		...(options.appUrl ? { appUrl: options.appUrl } : {})
	});
	return openrouter.chat(options.modelId);
}
