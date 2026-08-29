import type { LanguageModel } from 'ai';
import type { z } from 'zod';

export interface ModuleAiServerContext {
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
