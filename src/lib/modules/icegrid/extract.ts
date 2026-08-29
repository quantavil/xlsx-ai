import type { ModuleContext } from '../types';
import type { CombinedExtractionResult } from './readers';
import { IcegridAiReportSchema, type IcegridAiReport } from './schema';

/**
 * One request for all selected files. Returns the raw candidate rows *with* their
 * evidence still attached; verification happens client-side in `sanitize.ts`.
 */
export async function requestIcegridExtraction(
	extraction: CombinedExtractionResult,
	context: ModuleContext
): Promise<IcegridAiReport> {
	if (!context.ai.apiKey || context.ai.apiKey.trim().length < 20) {
		throw new Error('Google Gemini API key is missing or invalid. Please configure it in Settings.');
	}

	context.onProgress(
		`Sending ${extraction.sourceFiles.length} document(s) to Gemini AI (${context.ai.modelId})...`
	);

	const payload = {
		operation: {
			kind: 'module',
			moduleId: 'icegrid',
			action: 'extract'
		},
		input: {
			sourceFiles: extraction.sourceFiles,
			content: extraction.content
		}
	};

	let result: unknown;
	try {
		result = await context.ai.request(payload);
	} catch (err: unknown) {
		if (context.signal.aborted) {
			throw err;
		}
		const msg = err instanceof Error ? err.message : 'AI extraction request failed.';
		throw new Error(msg);
	}

	if (
		typeof result !== 'object' ||
		result === null ||
		!('success' in result) ||
		result.success !== true ||
		!('data' in result)
	) {
		throw new Error('Malformed or empty extraction response from Gemini.');
	}

	const parsed = IcegridAiReportSchema.safeParse(result.data);
	if (!parsed.success) {
		throw new Error('Gemini output did not conform to the ICEGrid report schema.');
	}

	return parsed.data;
}
