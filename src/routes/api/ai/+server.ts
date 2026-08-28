import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, generateObject } from 'ai';
import { DEFAULT_AI_MODEL } from '$lib/constants';

const MAX_REQUEST_BYTES = 1024 * 1024;
const _CellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export function _isSupportedModelId(modelId: string): boolean {
	if (!/^gemini-[a-z0-9][a-z0-9._-]{2,80}$/i.test(modelId)) return false;
	if (/(?:image|imagen|embedding|audio|speech|tts|live|robotics|aqa)/i.test(modelId)) return false;
	if (/(?:gemini-2\.0)/i.test(modelId)) return false;
	return true;
}


export const _RequestSchema = z.object({
	messages: z
		.array(
			z.object({
				role: z.enum(['user', 'assistant']),
				content: z.string().min(1).max(8_000)
			})
		)
		.max(50)
		.optional(),
	tableContext: z.object({
		title: z.string().max(200).optional(),
		columns: z.array(
			z.object({
				id: z.string().min(1).max(100),
				name: z.string().min(1).max(200),
				type: z.enum(['text', 'number', 'currency', 'percent', 'status', 'date']),
				width: z.number().optional()
			})
		).max(200),
		rows: z.array(z.record(z.string(), _CellSchema)).max(2_000)
	}),
	operation: z
		.object({
			kind: z.enum(['fill_missing', 'clean', 'summarize', 'qa']),
				targetColumnId: z.string().max(100).optional(),
				prompt: z.string().max(8_000).optional()
		})
		.optional()
});

export const _CleanFillSchema = z.object({
	explanation: z.string().describe('Brief explanation of what was filled or cleaned'),
	patches: z.array(
		z.object({
			rowId: z.string().describe('The id of the row to update'),
			columnId: z.string().describe('The id of the column to update'),
			oldValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
			newValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).describe('The new cleaned or imputed value')
		})
	)
});

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = request.headers.get('x-ai-api-key')?.trim();

	// 1. API Key Auth Validation
	if (!apiKey || apiKey.length < 20) {
		return json(
			{
				error: 'A valid Google Gemini API key is required. Please provide it in the x-ai-api-key header.'
			},
			{ status: 401 }
		);
	}

	// 2. Request Body Validation
	let body: unknown;
	try {
		const rawBody = await request.text();
		if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
			return json({ error: 'Request payload exceeds the 1 MiB limit.' }, { status: 413 });
		}
		body = JSON.parse(rawBody);
	} catch {
		return json({ error: 'Invalid JSON request body.' }, { status: 400 });
	}

	const parsed = _RequestSchema.safeParse(body);
	if (!parsed.success) {
		return json(
			{
				error: 'Malformed request payload.',
				details: parsed.error.format()
			},
			{ status: 400 }
		);
	}

	const { tableContext, operation, messages = [] } = parsed.data;

	// 3. Grounding Context Preparation (Truncated to 40 rows)
	const truncatedRows = tableContext.rows.slice(0, 40);
	const columnSchemas = tableContext.columns.map((c) => `${c.name} (id: "${c.id}", type: ${c.type})`).join(', ');

	const systemPrompt = `You are Table AI, an elite agency data engineering and analysis assistant.
You are operating directly on a live tabular dataset.

TABLE METADATA:
Title: "${tableContext.title || 'Data Table'}"
Total Rows in Dataset: ${tableContext.rows.length} (Showing sample of ${truncatedRows.length} rows)
Columns: ${columnSchemas}

DATA SAMPLE (JSON):
${JSON.stringify(truncatedRows, null, 2)}

INSTRUCTIONS:
- Give concise, highly specific, data-grounded answers.
- When performing calculations, verify math strictly.
- When suggesting edits or explanations, reference specific row IDs and column IDs.
- For open questions, provide structured markdown with bullet points and bold highlights.`;

	const targetModel = request.headers.get('x-ai-model-id')?.trim() || DEFAULT_AI_MODEL;
	if (!_isSupportedModelId(targetModel)) {
		return json({ error: 'Unsupported Gemini model id.' }, { status: 400 });
	}

	const google = createGoogleGenerativeAI({ apiKey });
	const model = google(targetModel);

	try {
		// 4. Structured Output for Clean & Fill Operations
		if (operation?.kind === 'fill_missing' || operation?.kind === 'clean') {
			const prompt =
				operation.kind === 'fill_missing'
					? `Analyze the table and fill in null, missing, or empty values with statistically and contextually accurate estimates based on patterns in the rest of the table. ${operation.prompt || ''} ${operation.targetColumnId ? `Focus on column: ${operation.targetColumnId}` : ''}`
					: `Analyze the table and clean inconsistent formats, typos, malformed dates, trailing spaces, or invalid values. ${operation.prompt || ''} ${operation.targetColumnId ? `Focus on column: ${operation.targetColumnId}` : ''}`;

			const result = await generateObject({
				model,
				system: systemPrompt,
				prompt,
				schema: _CleanFillSchema
			});

			return json({
				success: true,
				kind: operation.kind,
				data: result.object
			});
		}

		// 5. Streaming Output for Q&A and Summarization
		let chatMessages = messages;
		if (operation?.kind === 'summarize') {
			chatMessages = [
				...messages,
				{
					role: 'user',
					content:
						operation.prompt ||
						'Provide a high-level executive summary of this dataset, highlighting key metrics, top distributions, patterns, and anomalies.'
				}
			];
		} else if (chatMessages.length === 0) {
			chatMessages = [{ role: 'user', content: 'Summarize this dataset.' }];
		}

		const result = streamText({
			model,
			system: systemPrompt,
			messages: chatMessages.map((m) => ({
				role: m.role as 'user' | 'assistant',
				content: m.content
			}))
		});

		return result.toTextStreamResponse();
	} catch (err: unknown) {
		console.error('AI SDK Generation Error:', err);
		const providerStatus =
			typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
				? err.status
				: 500;
		if (providerStatus === 401 || providerStatus === 403) {
			return json({ error: 'Gemini rejected the API key or model access.' }, { status: 401 });
		}
		if (providerStatus === 429) {
			return json({ error: 'Gemini rate limit reached. Try again shortly.' }, { status: 429 });
		}
		return json({ error: 'Gemini could not complete the request.' }, { status: 502 });
	}
};
