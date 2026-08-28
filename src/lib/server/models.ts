// Single source of truth for "can this workspace talk to that Gemini model id".
// Used by both the model listing endpoint and the generation endpoint so the picker can
// never offer a model the generation route would then reject.

const SPECIALIZED = /(?:image|imagen|embedding|audio|speech|tts|live|robotics|aqa|transcribe|veo|lyria)/i;

export function isSupportedModelId(modelId: string): boolean {
	if (!/^gemini-[a-z0-9][a-z0-9._-]{2,80}$/i.test(modelId)) return false;
	if (SPECIALIZED.test(modelId)) return false;
	// Gemini 2.0 is retired; keep it out of the picker and out of requests.
	if (/gemini-2\.0/i.test(modelId)) return false;
	return true;
}
