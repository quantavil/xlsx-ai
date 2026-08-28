import type { TableData, CellValue } from '$lib/types';
import type { PatchProposal } from './patches';

export interface AiChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	patches?: PatchProposal[];
	formula?: string;
	insights?: string[];
	timestamp?: number;
}

export interface AiRequestPayload {
	prompt: string;
	model: string;
	tableContext: {
		title: string;
		columns: Array<{ id: string; name: string; type: string }>;
		rowCount: number;
		sampleRows: Array<Record<string, CellValue>>;
	};
	history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export function buildTableContextPayload(table: TableData, maxSampleRows = 50) {
	return {
		title: table.title || 'Table',
		columns: table.columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
		rowCount: table.rows.length,
		sampleRows: table.rows.slice(0, maxSampleRows).map((row) => {
			const record: Record<string, CellValue> = { id: row.id };
			for (const col of table.columns) {
				record[col.id] = row[col.id] ?? null;
			}
			return record;
		})
	};
}

export async function sendAiQuery(
	params: {
		prompt: string;
		apiKey: string;
		model: string;
		table: TableData;
		history?: Array<{ role: 'user' | 'assistant'; content: string }>;
		signal?: AbortSignal;
	}
): Promise<{
	message: string;
	patches?: PatchProposal[];
	formula?: string;
	insights?: string[];
}> {
	if (!params.apiKey.trim()) {
		throw new Error('Please configure your Google Gemini API key in Settings before using AI.');
	}

	const payload: AiRequestPayload = {
		prompt: params.prompt.trim(),
		model: params.model,
		tableContext: buildTableContextPayload(params.table, 50),
		history: (params.history || []).slice(-10) // Bounded conversation history
	};

	let response: Response;
	try {
		response = await fetch('/api/ai', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-ai-api-key': params.apiKey.trim()
			},
			body: JSON.stringify(payload),
			signal: params.signal
		});
	} catch (err: unknown) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw err;
		}
		throw new Error('Failed to connect to the AI service. Please check your network connection.');
	}

	if (!response.ok) {
		let errorDetails = '';
		try {
			const errJson = await response.json();
			errorDetails = errJson.message || errJson.error || '';
		} catch {
			errorDetails = await response.text().catch(() => '');
		}

		if (response.status === 401) {
			throw new Error('Invalid or expired Gemini API key. Please update your API key in Settings.');
		}
		if (response.status === 429) {
			throw new Error('Gemini API rate limit or quota exceeded. Please check your Google AI Studio quota or try again in a few moments.');
		}
		if (response.status === 413) {
			throw new Error('Table context is too large for the AI request payload.');
		}
		if (response.status === 504) {
			throw new Error('The AI model took too long to respond. Please try again with a shorter prompt.');
		}

		throw new Error(errorDetails || `AI request failed with status ${response.status}`);
	}

	const data = await response.json();
	return {
		message: data.text || data.message || data.response || 'Operation completed.',
		patches: Array.isArray(data.patches) ? data.patches : undefined,
		formula: typeof data.formula === 'string' ? data.formula : undefined,
		insights: Array.isArray(data.insights) ? data.insights : undefined
	};
}
