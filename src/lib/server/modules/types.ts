import type { LanguageModel } from 'ai';
import type { z } from 'zod';
import type { AiProvider } from '$lib/ai/providers';

export interface ModuleAiServerContext {
	readonly provider: AiProvider;
	readonly apiKey: string;
	readonly modelId: string;
	readonly model: LanguageModel;
	readonly signal: AbortSignal;
}

export interface ModuleAiHandler {
	readonly moduleId: string;
	readonly action: string;
	readonly inputSchema: z.ZodType;
	execute(input: unknown, context: ModuleAiServerContext): Promise<unknown | Response>;
}
