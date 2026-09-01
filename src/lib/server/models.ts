import { isSupportedModelId as isProviderSupportedModelId } from '$lib/ai/providers';

/** Backward-compatible Gemini validator for existing server callers. */
export function isSupportedModelId(modelId: string): boolean {
	return isProviderSupportedModelId('gemini', modelId);
}

export { isProviderSupportedModelId };
