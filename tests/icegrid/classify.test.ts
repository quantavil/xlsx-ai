import { describe, it, expect, afterEach } from 'bun:test';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { icegridClassifyAiHandler } from '../../src/lib/modules/icegrid/ai.server';
import { allocateQueries } from '../../src/lib/modules/icegrid/tariff';

/** A canned Gemini answer in the wire shape the provider expects. */
function geminiReply(payload: unknown): Response {
	return new Response(
		JSON.stringify({
			candidates: [
				{
					content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] },
					finishReason: 'STOP'
				}
			],
			usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}

/**
 * The two model calls in order, plus the prompts they were sent.
 *
 * The prompts are what the key-echo assertions read: the handler must not put a
 * real item key in front of the model, and must accept the short id back.
 */
function stubModel(replies: unknown[]) {
	const prompts: string[] = [];
	const fetchImpl = (async (_url: string, init: { body: string }) => {
		const body = JSON.parse(init.body);
		prompts.push(JSON.stringify(body.contents));
		return geminiReply(replies[prompts.length - 1] ?? { items: [] });
	}) as unknown as typeof fetch;

	const google = createGoogleGenerativeAI({ apiKey: 'x'.repeat(30), fetch: fetchImpl });
	return { model: google('gemini-3.7-flash-lite'), prompts };
}

/** DGFT, answering from a tiny fixed schedule. */
function stubDgft(byQuery: Record<string, { itcCode: string; itcDescription: string }[]>) {
	const asked: string[] = [];
	const real = globalThis.fetch;
	globalThis.fetch = (async (url: string | URL) => {
		const query = decodeURIComponent(String(url).split('itc-code=')[1] ?? '');
		asked.push(query);
		return new Response(JSON.stringify(byQuery[query] ?? []), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}) as unknown as typeof fetch;
	return { asked, restore: () => (globalThis.fetch = real) };
}

let restoreFetch: (() => void) | null = null;
afterEach(() => {
	restoreFetch?.();
	restoreFetch = null;
});

const context = (model: ReturnType<typeof stubModel>['model']) => ({
	apiKey: 'x'.repeat(30),
	modelId: 'gemini-test',
	model,
	signal: new AbortController().signal
});

describe('icegrid classify handler', () => {
	it('never shows the model a real item key, and accepts the short id back', async () => {
		// A real key is `printed|lowercased description`, full of pipes, quotes and
		// commas. Asking a model to echo one back verbatim is what left every item on
		// a 32-row invoice with no phrases and no explanation.
		const key = '|wall clock 24" face 61 cm,matt antq brass';

		const { model, prompts } = stubModel([
			{ items: [{ key: 'i0', terms: ['wall clocks'], note: '' }] },
			{ items: [{ key: 'r0', codes: ['91052900', '91052100'], note: '' }] }
		]);
		const dgft = stubDgft({
			'wall clocks': [
				{ itcCode: '91052100', itcDescription: 'Wall clocks :\n-- Electrically operated' },
				{ itcCode: '91052900', itcDescription: 'Wall clocks :\n-- Other' }
			]
		});
		restoreFetch = dgft.restore;

		const result = (await icegridClassifyAiHandler.execute(
			{ items: [{ key, description: 'WALL CLOCK 24" FACE 61 CM, MATT ANTQ BRASS', printed: '' }] },
			context(model)
		)) as { items: { key: string; terms: string[]; candidates: { code: string }[] }[] };

		expect(prompts[0]).toContain('i0');
		expect(prompts[0]).not.toContain(key);

		const [item] = result.items;
		expect(item.key).toBe(key);
		expect(item.terms).toEqual(['wall clocks']);
		// The ranking is applied, so the model's first choice leads.
		expect(item.candidates.map((c) => c.code)).toEqual(['91052900', '91052100']);
	});

	it('answers a printed heading from the schedule without asking the model for words', async () => {
		const { model, prompts } = stubModel([
			{ items: [{ key: 'r0', codes: ['94036000'], note: '' }] }
		]);
		const dgft = stubDgft({
			'9403': [
				{ itcCode: '94036000', itcDescription: 'Other wooden furniture' },
				{ itcCode: '94039900', itcDescription: 'Parts:\n- - Other' },
				{ itcCode: '940300', itcDescription: 'a heading, not filable' }
			]
		});
		restoreFetch = dgft.restore;

		const result = (await icegridClassifyAiHandler.execute(
			{ items: [{ key: '9403|corner shelf', description: 'CORNER SHELF MANGO WOOD', printed: '9403' }] },
			context(model)
		)) as { items: { candidates: { code: string; basis: string }[] }[] };

		// Only the ranking call happened: a printed code is evidence, not a guess.
		expect(prompts).toHaveLength(1);
		expect(dgft.asked).toEqual(['9403']);

		const codes = result.items[0].candidates;
		expect(codes.map((c) => c.code)).toEqual(['94036000', '94039900']);
		expect(codes.every((c) => c.basis === 'prefix')).toBe(true);
	});

	it('discards a ranked code the schedule never returned', async () => {
		const { model } = stubModel([
			{ items: [{ key: 'i0', terms: ['wall clocks'], note: '' }] },
			{ items: [{ key: 'r0', codes: ['99999999', '91052100'], note: '' }] }
		]);
		const dgft = stubDgft({
			'wall clocks': [
				{ itcCode: '91052100', itcDescription: 'Wall clocks : Electrically operated' },
				{ itcCode: '91052900', itcDescription: 'Wall clocks : Other' }
			]
		});
		restoreFetch = dgft.restore;

		const result = (await icegridClassifyAiHandler.execute(
			{ items: [{ key: '|wall clock', description: 'WALL CLOCK', printed: '' }] },
			context(model)
		)) as { items: { candidates: { code: string }[] }[] };

		expect(result.items[0].candidates.map((c) => c.code)).toEqual(['91052100', '91052900']);
	});

	it('still returns an item the model gave no phrases for', async () => {
		const { model } = stubModel([{ items: [] }, { items: [] }]);
		const dgft = stubDgft({});
		restoreFetch = dgft.restore;

		const result = (await icegridClassifyAiHandler.execute(
			{ items: [{ key: '|mystery goods', description: 'MYSTERY GOODS', printed: '' }] },
			context(model)
		)) as { items: { key: string; candidates: unknown[]; terms: string[] }[] };

		// An item with nothing found must still come back, or the dialog cannot tell
		// "asked and found nothing" from "never asked".
		expect(result.items).toHaveLength(1);
		expect(result.items[0].key).toBe('|mystery goods');
		expect(result.items[0].candidates).toEqual([]);
	});
});

describe('spending the search budget', () => {
	it('gives every item its best phrase before any item gets a second', () => {
		const terms = new Map([
			['a', ['alpha one', 'alpha two', 'alpha three']],
			['b', ['bravo one', 'bravo two']],
			['c', ['charlie one']]
		]);
		// Flattening and slicing spent the whole budget on item "a" and left "c" with
		// nothing, which the dialog then showed as the schedule having no answer.
		expect(allocateQueries(terms, 3)).toEqual(['alpha one', 'bravo one', 'charlie one']);
		expect(allocateQueries(terms, 5)).toEqual([
			'alpha one',
			'bravo one',
			'charlie one',
			'alpha two',
			'bravo two'
		]);
	});

	it('charges a phrase two items share only once', () => {
		const terms = new Map([
			['a', ['wall clocks']],
			['b', ['wall clocks']],
			['c', ['bed linen']]
		]);
		expect(allocateQueries(terms, 10)).toEqual(['wall clocks', 'bed linen']);
	});

	it('ignores empty and too-short phrases', () => {
		expect(allocateQueries(new Map([['a', ['', ' ', 'x', 'ok']]]), 10)).toEqual(['ok']);
	});
});
