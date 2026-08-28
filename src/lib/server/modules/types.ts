import type { LanguageModelV1 } from 'ai';
import type { z } from 'zod';

export interface ModuleAiServerContext {
	readonly apiKey: string;
	readonly modelId: string;
	readonly model: LanguageModelV1;
	readonly signal: AbortSignal;
}

export interface ModuleAiHandler {
	readonly moduleId: string;
	readonly action: string;
	readonly inputSchema: z.ZodTypeAny;
	execute(input: unknown, context: ModuleAiServerContext): Promise<unknown | Response>;
}
