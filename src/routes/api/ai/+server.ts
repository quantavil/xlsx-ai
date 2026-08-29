import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { DEFAULT_AI_MODEL } from '$lib/constants';
import { getModuleAiHandler } from '$lib/server/modules/registry';
import { isSupportedModelId } from '$lib/server/models';

// A module payload is capped at MAX_COMBINED_BYTES (750 KB) of *extracted text*; JSON
// escaping of tab/newline-dense TSV plus multi-byte glyphs can roughly double that on the
// wire, so the transport ceiling has to sit well above the content ceiling.
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

// Without a deadline a slow or over-subscribed model just leaves the drawer spinning
// with no way to tell "thinking" from "never coming back". Measured on the live API:
// a flash-lite table answer lands in ~1.5s, so a minute is not a real ceiling for a
// working model - it is the point past which something is wrong and should say so.
const TABLE_OP_TIMEOUT_MS = 60_000;
// Document extraction reads several files and writes a row per invoice line, so it
// earns a longer budget than a chat turn.
const MODULE_OP_TIMEOUT_MS = 180_000;

/** The caller's own cancellation, plus a deadline of our own. */
function deadline(signal: AbortSignal, ms: number): AbortSignal {
	return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}
const _CellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export { isSupportedModelId as _isSupportedModelId };

export const _ModuleOperationRequestSchema = z.object({
	operation: z.object({
		kind: z.literal('module'),
		moduleId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
		action: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
	}),
	input: z.unknown()
});

export const _TableOperationRequestSchema = z.object({
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
				type: z.enum(['text', 'number', 'currency', 'percent', 'dropdown', 'date']),
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

export const _RequestSchema = z.union([_ModuleOperationRequestSchema, _TableOperationRequestSchema]);

const _PatchSchema = z.object({
	rowId: z.string().describe('The id of the row to update'),
	columnId: z.string().describe('The id of the column to update'),
	oldValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
	newValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).describe('The new cleaned or imputed value')
});

/**
 * Chat answers and chat edits share one response.
 *
 * Chat used to be a text stream, so a request like "change every AU to AE" could only
 * ever come back as prose offering to do it - there was no channel to say it in. The
 * model now emits the cells alongside the reply and the drawer's existing diff card
 * gates them, so an edit request produces a reviewable edit instead of a promise.
 */
export const _ChatSchema = z.object({
	reply: z.string().describe('The markdown answer shown in the chat transcript'),
	patches: z
		.array(_PatchSchema)
		.describe('Cell edits the request calls for, or an empty array for a read-only question')
});

export const _CleanFillSchema = z.object({
	explanation: z.string().describe('Brief explanation of what was filled or cleaned'),
	patches: z.array(_PatchSchema)
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
			return json({ error: 'Request payload exceeds the 4 MiB limit.' }, { status: 413 });
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
				details: z.treeifyError(parsed.error)
			},
			{ status: 400 }
		);
	}

	const targetModel = request.headers.get('x-ai-model-id')?.trim() || DEFAULT_AI_MODEL;
	if (!isSupportedModelId(targetModel)) {
		return json({ error: 'Unsupported Gemini model id.' }, { status: 400 });
	}

	let moduleHandler: ReturnType<typeof getModuleAiHandler>;
	let moduleInput: unknown;
	if ('input' in parsed.data && parsed.data.operation.kind === 'module') {
		moduleHandler = getModuleAiHandler(
			parsed.data.operation.moduleId,
			parsed.data.operation.action
		);
		if (!moduleHandler) {
			return json({ error: 'Unknown module AI action.' }, { status: 404 });
		}

		const validatedInput = moduleHandler.inputSchema.safeParse(parsed.data.input);
		if (!validatedInput.success) {
			return json(
				{ error: 'Malformed module input.', details: z.treeifyError(validatedInput.error) },
				{ status: 400 }
			);
		}
		moduleInput = validatedInput.data;
	}

	const google = createGoogleGenerativeAI({ apiKey });
	const model = google(targetModel);

	try {
		// 3. Trusted workspace module AI operations
		if (moduleHandler) {
			const result = await moduleHandler.execute(moduleInput, {
				apiKey,
				modelId: targetModel,
				model,
				signal: deadline(request.signal, MODULE_OP_TIMEOUT_MS)
			});
			if (result instanceof Response) return result;

			return json({
				success: true,
				kind: 'module',
				moduleId: moduleHandler.moduleId,
				action: moduleHandler.action,
				data: result
			});
		}

		// 4. Standard Table Operations Branch
		if (!('tableContext' in parsed.data)) {
			return json({ error: 'Malformed table request payload.' }, { status: 400 });
		}

		const { tableContext, operation, messages = [] } = parsed.data;
		const columnSchemas = tableContext.columns.map((c) => `${c.name} (id: "${c.id}", type: ${c.type})`).join(', ');

		const systemPrompt = `You are xlsx-ai, an elite agency data engineering and analysis assistant.
You are operating directly on a live tabular dataset.

TABLE METADATA:
Title: "${tableContext.title || 'Data Table'}"
Total Rows in Dataset: ${tableContext.rows.length}
Columns: ${columnSchemas}

DATA (tab-separated, first column is the row id, NULL means the cell is empty):
${_renderTsv(tableContext.columns, tableContext.rows)}

INSTRUCTIONS:
- Give concise, highly specific, data-grounded answers.
- When performing calculations, verify math strictly.
- When suggesting edits or explanations, reference specific row IDs and column IDs.
- Every row above is in scope. An instruction that names no subset applies to all ${tableContext.rows.length} rows.
- For open questions, provide structured markdown with bullet points and bold highlights.`;

		// 4. Structured Output for Clean & Fill Operations
		if (operation?.kind === 'fill_missing' || operation?.kind === 'clean') {
			const prompt =
				operation.kind === 'fill_missing'
					? `Analyze the table and fill in null, missing, or empty values with statistically and contextually accurate estimates based on patterns in the rest of the table. ${operation.prompt || ''} ${operation.targetColumnId ? `Focus on column: ${operation.targetColumnId}` : ''}`
					: `Analyze the table and clean inconsistent formats, typos, malformed dates, trailing spaces, or invalid values. ${operation.prompt || ''} ${operation.targetColumnId ? `Focus on column: ${operation.targetColumnId}` : ''}`;

			const result = await generateObject({
				model,
				instructions: systemPrompt,
				prompt,
				schema: _CleanFillSchema,
				abortSignal: deadline(request.signal, TABLE_OP_TIMEOUT_MS)
			});

			return json({
				success: true,
				kind: operation.kind,
				data: result.object
			});
		}

		// 5. Structured Q&A: one reply plus any cell edits the request calls for.
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

		const chat = await generateObject({
			model,
			instructions: `${systemPrompt}

EDIT REQUESTS:
- When the user asks you to change, fill, fix, replace or clear cell values, put every affected cell in \`patches\` and describe what you did in \`reply\`.
- Never answer an edit request with an offer to make the edit. The user reviews and approves your patches in the app before anything is written, so proposing them IS asking.
- Emit one patch per affected cell, covering every row the request touches - not a sample.
- \`reply\` is a short summary in that case, not a table of the changes.
- For a question that changes nothing, leave \`patches\` empty.`,
			messages: chatMessages.map((m) => ({
				role: m.role as 'user' | 'assistant',
				content: m.content
			})),
			schema: _ChatSchema,
			abortSignal: deadline(request.signal, TABLE_OP_TIMEOUT_MS)
		});

		return json({ success: true, kind: 'chat', data: chat.object });
	} catch (err: unknown) {
		console.error('AI SDK Generation Error:', err);
		const e = (err ?? {}) as Record<string, unknown>;

		// The caller went away - nothing to report to.
		if (request.signal.aborted) return json({ error: 'Request cancelled.' }, { status: 499 });
		if (isTimeout(err)) {
			return json(
				{
					error: `"${targetModel}" did not respond in time. Some Gemini models are far slower than others - try a Flash model, or pick another in Settings.`
				},
				{ status: 504 }
			);
		}
		// The AI SDK reports the provider's HTTP status as `statusCode`, not `status`.
		const providerStatus =
			typeof e.statusCode === 'number' ? e.statusCode : typeof e.status === 'number' ? e.status : 500;

		if (providerStatus === 401 || providerStatus === 403) {
			return json({ error: 'Gemini rejected the API key or model access.' }, { status: 401 });
		}
		if (providerStatus === 429) {
			return json({ error: 'Gemini rate limit reached. Try again shortly.' }, { status: 429 });
		}
		if (providerStatus === 404) {
			return json(
				{ error: `Gemini has no model "${targetModel}". Pick another in Settings → AI & Models.` },
				{ status: 404 }
			);
		}
		// Anything else is a bug in our request (bad schema, oversized prompt) or a provider
		// fault. Swallowing the detail here is what made import failures undebuggable.
		return json({ error: `Gemini request failed: ${describeProviderError(err)}` }, { status: 502 });
	}
};

function describeProviderError(err: unknown): string {
	const e = (err ?? {}) as Record<string, unknown>;
	const body = typeof e.responseBody === 'string' ? e.responseBody : '';
	if (body) {
		try {
			const parsed = JSON.parse(body) as { error?: { message?: string } };
			if (parsed.error?.message) return parsed.error.message.slice(0, 400);
		} catch {
			return body.slice(0, 400);
		}
	}
	if (err instanceof Error && err.message) return err.message.slice(0, 400);
	return 'unknown provider error';
}

/**
 * The table as TSV rather than pretty-printed JSON.
 *
 * JSON.stringify(rows, null, 2) spends roughly five tokens of braces, quotes and
 * repeated key names for every one token of data, which is why the whole table used
 * to be sliced to 40 rows to fit. TSV names each column once, so the full table goes
 * in and edits stop silently missing row 41 onward.
 */
export function _renderTsv(
	columns: Array<{ id: string; name: string }>,
	rows: Array<Record<string, unknown>>
): string {
	// An empty cell is written NULL rather than left blank. Two adjacent tabs read as one
	// separator often enough that a populated neighbour goes missing: on the live API,
	// bare TSV answered a "sum this column" question correctly 0 times out of 3 and the
	// NULL-marked form 3 out of 3, for eight extra characters.
	const cell = (v: unknown) =>
		v === null || v === undefined || v === '' ? 'NULL' : String(v).replace(/[\t\r\n]+/g, ' ');
	const lines = [['rowId', ...columns.map((c) => c.id)].join('\t')];
	for (const row of rows) {
		lines.push([String(row.id), ...columns.map((c) => cell(row[c.id]))].join('\t'));
	}
	return lines.join('\n');
}

/** A deadline surfaces as a TimeoutError, possibly wrapped by the SDK's retry layer. */
function isTimeout(err: unknown): boolean {
	for (let e: unknown = err, hops = 0; e && hops < 5; hops++) {
		const node = e as { name?: unknown; cause?: unknown };
		if (node.name === 'TimeoutError') return true;
		e = node.cause;
	}
	return false;
}
