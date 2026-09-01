export const AI_PROVIDERS = ['gemini', 'openrouter'] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface AiProviderProfile {
	keys: string[];
	activeKeyIndex: number;
	modelId: string;
	favoriteModels: string[];
}

export function parseAiProvider(value: string | null | undefined): AiProvider | null {
	return value === 'gemini' || value === 'openrouter' ? value : null;
}

export function providerLabel(provider: AiProvider): string {
	return provider === 'gemini' ? 'Google Gemini' : 'OpenRouter';
}

const GEMINI_SPECIALIZED =
	/(?:image|imagen|embedding|audio|speech|tts|live|robotics|aqa|transcribe|veo|lyria)/i;

export function isSupportedModelId(provider: AiProvider, modelId: string): boolean {
	if (provider === 'gemini') {
		return (
			/^gemini-[a-z0-9][a-z0-9._-]{2,80}$/i.test(modelId) &&
			!GEMINI_SPECIALIZED.test(modelId)
		);
	}

	return /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._:+-]{0,127}$/i.test(modelId);
}
