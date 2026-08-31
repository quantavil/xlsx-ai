import { normalizeRitcCode } from './duty-lookup';

/**
 * Finding a tariff code when the documents do not print one.
 *
 * The candidates never come from the model. DGFT publishes the ITC-HS master
 * behind a search that takes either a code prefix or plain description text and
 * answers with real codes and their official descriptions, so every code the user
 * is ever offered came out of the schedule itself. What the model contributes is
 * the *words to search with*: a tariff is written in its own vocabulary, and
 * "SIDE TABLE LARGE MANGO WOOD" matches nothing in it while "wooden furniture"
 * matches five entries. Translating one into the other is a language problem,
 * which is the part a model is actually good at.
 *
 * Classification stays a human decision either way - nothing here writes a code.
 */

/** One row of the ITC-HS master, as DGFT returns it. */
export interface TariffMatch {
	/** 2, 4, 6 or 8 digits. Only 8-digit rows are filable. */
	code: string;
	/** The schedule's own description, newline and dash markers cleaned up. */
	description: string;
}

/** A code offered for one item, with why it was offered. */
export interface TariffCandidate extends TariffMatch {
	/**
	 * `prefix` - a partial code the documents printed narrowed to this one.
	 * `search` - a description search found it.
	 * `broad`  - the recovery round found it, after every phrase for this item missed.
	 *
	 * A prefix candidate is anchored in the shipping documents; a search candidate is a
	 * suggestion; a broad one is a lead. The dialog says which is which, because a
	 * broad candidate came from one word of the description and is much likelier to be
	 * wrong - it exists so the item is not a dead end, not because it is probably right.
	 */
	basis: 'prefix' | 'search' | 'broad';
	/** The query that surfaced it, shown so a suggestion can be judged. */
	via: string;
}

/** One item that needs a code, as handed to the classifier. */
export interface TariffQuery {
	key: string;
	description: string;
	/** Digits of a partial code the documents printed, e.g. `9403`. */
	printed: string;
}

export interface TariffClassification {
	key: string;
	candidates: TariffCandidate[];
	/** The search phrases used, so a bad suggestion is explainable. */
	terms: string[];
	/**
	 * Set only when the ranker judged that none of the candidates fit the goods,
	 * with what to search instead. An empty string is the normal case, and saying
	 * nothing is better than a reassurance nobody should rely on.
	 */
	note?: string;
}

/**
 * DGFT descriptions carry the schedule's own indent markers: `'Parts:\\n- - Other'`.
 *
 * The dashes are dropped a token at a time rather than by a regex over the string.
 * A global pattern anchored on the whitespace before a dash consumes the space that
 * the NEXT dash needs to match, so `- - Other` loses one dash and keeps the other,
 * which is exactly what the first version of this did. Only tokens that are
 * nothing but dashes go, which leaves a real hyphen inside a word alone - the
 * tariff is full of them (`T-shirts`, `non-woven`).
 */
export function cleanTariffDescription(raw: unknown): string {
	return String(raw ?? '')
		.split(/\s+/)
		.filter((token) => token !== '' && !/^-+$/.test(token))
		.join(' ')
		.trim();
}

/** DGFT answers with its own row shape; only two fields matter. */
export function parseTariffMatches(body: unknown): TariffMatch[] {
	if (!Array.isArray(body)) return [];

	const seen = new Set<string>();
	const matches: TariffMatch[] = [];
	for (const raw of body) {
		const row = (raw ?? {}) as Record<string, unknown>;
		const code = normalizeRitcCode(row.itcCode);
		if (!code || seen.has(code)) continue;
		seen.add(code);
		matches.push({ code, description: cleanTariffDescription(row.itcDescription) });
	}
	return matches;
}

/**
 * How many candidates one item is offered.
 *
 * A shortlist is the point. `table` alone returns 253 rows from DGFT, and a list
 * that long is not a choice, it is a search result - the user would be doing the
 * classification unaided, which is what this exists to avoid.
 */
export const MAX_CANDIDATES_PER_ITEM = 6;

/** Outbound DGFT queries one classification run may make. */
export const MAX_TARIFF_QUERIES = 100;

/** Items one classification request may carry, trimmed client-side to fit. */
export const MAX_CLASSIFY_ITEMS = 60;

/**
 * Spend the query budget a round at a time, not an item at a time.
 *
 * Flattening every item's phrases and taking the first N spends the whole budget
 * on the first handful of items and leaves the rest with nothing - and they get no
 * candidates and no explanation, which looks exactly like the schedule having no
 * answer for them. Round-robin gives every item its best phrase before any item
 * gets its second, so a budget that cannot cover everything degrades in depth
 * rather than abandoning the tail of the list.
 */
export function allocateQueries(
	termsByItem: ReadonlyMap<string, readonly string[]>,
	budget = MAX_TARIFF_QUERIES
): string[] {
	const lists = [...termsByItem.values()];
	const depth = Math.max(0, ...lists.map((l) => l.length));

	const queries: string[] = [];
	const seen = new Set<string>();
	for (let round = 0; round < depth && queries.length < budget; round++) {
		for (const terms of lists) {
			if (queries.length >= budget) break;
			const term = (terms[round] ?? '').trim();
			// A phrase two items share costs one query, not two.
			if (term.length < 2 || seen.has(term)) continue;
			seen.add(term);
			queries.push(term);
		}
	}
	return queries;
}

/**
 * How many candidates the ranking model is shown per item.
 *
 * Wider than what the user ends up seeing, on purpose: capping to the final six
 * before ranking means the local word-overlap score decides which codes the model
 * is even allowed to consider, and a heading like `9403` has sixteen children that
 * all deserve a look. Bounded so the prompt stays legible rather than for cost.
 */
export const RANKING_SHORTLIST = 25;

const STOP_WORDS = new Set([
	'of', 'the', 'and', 'or', 'for', 'with', 'other', 'others', 'in', 'a', 'an',
	'to', 'used', 'kind', 'parts', 'thereof', 'including', 'similar'
]);

function tokens(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * `wood` and `wooden` are the same word for this purpose.
 *
 * An invoice writes the material and the tariff writes the adjective, so exact
 * token equality scores `SIDE TABLE MANGO WOOD` against `Other wooden furniture`
 * at zero. Prefix matching from four characters up is the cheapest fix that does
 * not need a stemmer, and four is short enough to keep `steel`/`steels` while
 * refusing to call `cot` and `cotton` a match.
 *
 * The stretch is capped at two characters because an unbounded prefix is not a stem:
 * it scored `CAKE STAND` against `Motor gasoline conforming to standard IS 2796` on
 * the strength of `stand`/`standard`, and put petroleum at the top of a list of
 * marble homeware. Two keeps every inflection this actually needs - `wood`/`wooden`,
 * `steel`/`steels`, `marble`/`marbled`, `glass`/`glasses`.
 */
const MAX_STEM_STRETCH = 2;

function related(a: string, b: string): boolean {
	if (a === b) return true;
	const [short, long] = a.length <= b.length ? [a, b] : [b, a];
	return (
		short.length >= 4 && long.length - short.length <= MAX_STEM_STRETCH && long.startsWith(short)
	);
}

/**
 * The tariff item's own wording, without the headings it hangs under.
 *
 * DGFT answers with the whole path: every one of `4421`'s twenty-three children comes
 * back as `Spools, cops, bobbins, sewing thread reels and the like of turned wood:
 * ---- <leaf>`, and only the leaf tells them apart. The shared parent is kept for
 * display - `Other` on its own means nothing to a filer - but anything judging what a
 * code *is* has to read the last segment.
 */
export function tariffLeaf(description: string): string {
	const segments = description.split(':');
	return (segments[segments.length - 1] ?? '').trim() || description.trim();
}

/**
 * A tariff line that says nothing but `Other` is the schedule's catch-all.
 *
 * It is a real answer and stays on the list, but it must never be the entry a
 * user's eye lands on first: taking the residual is the choice that most often
 * needs revisiting, which is why the drawback side of this module already warns
 * whenever it falls back to one.
 *
 * Judged on the leaf. Reading the whole path instead, every sibling under a named
 * heading looks specific - `... of turned wood: Other` carries eleven words of parent
 * - and the residual rule quietly stopped firing for exactly the deep headings that
 * produce the most look-alike candidates.
 */
function isResidual(description: string): boolean {
	return tokens(tariffLeaf(description)).length === 0;
}

/**
 * Rank candidates against the item they are offered for.
 *
 * Word overlap with the invoice description first, because a tariff line that
 * names the goods should outrank the residual under the same heading. Evidence
 * outranks overlap though: what the documents printed comes before what a phrase
 * found, which comes before what the recovery round scraped from a single word.
 * Only then length, and residual entries sink regardless - ordering those by length
 * would put `Other` at the top of every tie, which is precisely backwards.
 */
const BASIS_RANK: Record<TariffCandidate['basis'], number> = { prefix: 0, search: 1, broad: 2 };
export function rankTariffCandidates(
	candidates: readonly TariffCandidate[],
	itemDescription: string,
	limit = MAX_CANDIDATES_PER_ITEM
): TariffCandidate[] {
	const wanted = tokens(itemDescription);

	// Distinct words, not occurrences. A description that happens to say "wood" three
	// times is not three times the match, and under a heading whose own text repeats the
	// material that inflation is what decided the order - `Wood paving Blocks` outranked
	// `Parts of domestic decorative articles used as tableware` for a wooden bowl.
	const scored = candidates.map((candidate) => ({
		candidate,
		overlap: new Set(
			tokens(candidate.description).filter((t) => wanted.some((w) => related(t, w)))
		).size,
		residual: isResidual(candidate.description)
	}));

	scored.sort((a, b) => {
		const basis = BASIS_RANK[a.candidate.basis] - BASIS_RANK[b.candidate.basis];
		if (basis !== 0) return basis;
		if (b.overlap !== a.overlap) return b.overlap - a.overlap;
		if (a.residual !== b.residual) return a.residual ? 1 : -1;
		return a.candidate.description.length - b.candidate.description.length;
	});

	return scored.slice(0, limit).map((s) => s.candidate);
}

/**
 * Outbound queries a recovery round may make, on top of the first pass.
 *
 * Only items that came back with nothing spend any of it, which in a healthy run is
 * none of them. The first pass rarely gets near its own budget, so this is headroom
 * that already existed rather than a new cost.
 */
export const MAX_RECOVERY_QUERIES = 40;

/**
 * The headings a search returned, so their children can be fetched.
 *
 * A search answers at every level of the hierarchy, and `filableCandidates` throws the
 * 4- and 6-digit rows away because a heading cannot be filed. That is right, and it is
 * also where the answer often was: `tableware` returns the heading `4419 Tableware and
 * kitchenware, of wood` and not one of its children, so an acacia serving board scores
 * a real hit on the schedule and is still shown nothing. The heading is a pointer -
 * `searchTariffPrefix` turns it into the fifteen filable rows underneath it.
 *
 * Only worth spending queries on when the item has no filable candidates at all, so
 * the caller decides; this just names them, most specific first, since a 6-digit
 * subheading is a better guess than the 4-digit chapter it sits in.
 */
export function headingCodes(matches: readonly TariffMatch[], limit = 3): string[] {
	const headings = matches
		.map((m) => m.code)
		.filter((code) => code.length === 4 || code.length === 6);
	return [...new Set(headings)].sort((a, b) => b.length - a.length).slice(0, limit);
}

/**
 * Fall back from a phrase that found nothing to the words inside it.
 *
 * The schedule is matched literally, so a phrase is all-or-nothing: `acacia wood`
 * returns zero and `acacia` returns the one tariff line that names it. When every
 * phrase for an item misses, its own words are the only lead left, and a broad result
 * is strictly better than an empty dialog - the ranker still has to read them, and a
 * user looking at six wrong codes at least learns which heading to search.
 *
 * Longest word first: a longer word is a more particular one, and `stand` finds
 * fifty-six rows where `cake` finds a chapter of food. Two characters or fewer and
 * the schedule's own filler words are dropped, the same set the ranker ignores.
 */
export function broadenTerms(terms: readonly string[], limit = 3): string[] {
	const words = terms.flatMap((term) => tokens(term)).filter((word) => word.length >= 4);
	return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, limit);
}

/**
 * Only 8-digit rows can be filed.
 *
 * DGFT answers a search at every level of the hierarchy - `6302` and `630210` come
 * back beside `63023100` - and a 4- or 6-digit row is a heading, not a declarable
 * tariff item. They are dropped rather than shown, because an ICEGATE row carrying
 * one would be rejected at filing.
 */
export function filableCandidates(
	matches: readonly TariffMatch[],
	basis: TariffCandidate['basis'],
	via: string
): TariffCandidate[] {
	return matches
		.filter((m) => m.code.length === 8)
		.map((m) => ({ ...m, basis, via }));
}

/**
 * Reorder a shortlist by a ranking, without trusting the ranking.
 *
 * Codes the ranker returned that are not on the shortlist are dropped: it is
 * ordering a list it was handed, so anything else is either a misread or an
 * invented code, and neither belongs in front of a filer. Candidates it left out
 * are kept and appended in their existing order rather than discarded - the model
 * gets to say what is *most* likely, never to remove an option the schedule
 * actually offers.
 */
export function applyRanking(
	candidates: readonly TariffCandidate[],
	rankedCodes: readonly string[],
	limit = MAX_CANDIDATES_PER_ITEM
): TariffCandidate[] {
	const byCode = new Map(candidates.map((c) => [c.code, c]));

	const ordered: TariffCandidate[] = [];
	const taken = new Set<string>();
	for (const raw of rankedCodes) {
		const code = normalizeRitcCode(raw);
		const candidate = byCode.get(code);
		if (candidate && !taken.has(code)) {
			taken.add(code);
			ordered.push(candidate);
		}
	}
	for (const candidate of candidates) {
		if (!taken.has(candidate.code)) ordered.push(candidate);
	}

	return ordered.slice(0, limit);
}

/** Merge candidate lists for one item, first mention of a code winning. */
export function mergeCandidates(...lists: readonly TariffCandidate[][]): TariffCandidate[] {
	const byCode = new Map<string, TariffCandidate>();
	for (const list of lists) {
		for (const candidate of list) {
			if (!byCode.has(candidate.code)) byCode.set(candidate.code, candidate);
		}
	}
	return [...byCode.values()];
}

/** Ask our own server to search the ITC-HS master; DGFT sends no CORS headers. */
export async function requestTariffSearch(query: string): Promise<TariffMatch[]> {
	const trimmed = query.trim();
	if (trimmed.length < 2) return [];

	try {
		const response = await fetch('/api/icegrid/tariff-search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query: trimmed })
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const body = (await response.json()) as { matches?: TariffMatch[] };
		return body.matches ?? [];
	} catch {
		// A failed search is an empty result list; the box stays usable and the user
		// can still type a code by hand.
		return [];
	}
}

/**
 * Ask the server to classify every item that needs a code.
 *
 * One request for the whole shipment, not one per item: the model sees all the
 * descriptions together and the schedule searches are deduplicated across them,
 * which matters because a shipment usually repeats the same few kinds of goods.
 * A failure costs the suggestions, never the import - each item still gets its
 * search box and can still be typed in by hand.
 */
export interface TariffClassificationBatch {
	classifications: Map<string, TariffClassification>;
	/** Why there are no suggestions, when there are none. Empty on success. */
	warnings: string[];
}

export async function requestTariffClassification(
	items: readonly TariffQuery[],
	ai: { request<T>(payload: unknown, options?: { signal?: AbortSignal }): Promise<T> },
	signal?: AbortSignal
): Promise<TariffClassificationBatch> {
	if (items.length === 0) return { classifications: new Map(), warnings: [] };

	// Trim rather than let the route reject the batch: one item over the cap would
	// otherwise cost every suggestion in the run, the same way the duty lookup trims.
	const asked = items.slice(0, MAX_CLASSIFY_ITEMS);
	const warnings =
		items.length > asked.length
			? [
					`This import has ${items.length} items needing a tariff code; suggestions were fetched for the first ${MAX_CLASSIFY_ITEMS}. The rest can be searched by hand in the dialog.`
				]
			: [];

	try {
		const response = await ai.request<{
			success?: boolean;
			data?: { items?: TariffClassification[] };
		}>(
			{
				operation: { kind: 'module', moduleId: 'icegrid', action: 'classify' },
				input: { items: asked.map(({ key, description, printed }) => ({ key, description, printed })) }
			},
			signal ? { signal } : {}
		);
		return {
			classifications: new Map((response.data?.items ?? []).map((entry) => [entry.key, entry])),
			warnings
		};
	} catch (error) {
		// Never swallowed. A silent failure here renders as an item the schedule had
		// no answer for, which is a different and much worse thing to tell a filer -
		// it reads as "no such code exists" when it means "we never asked".
		return {
			classifications: new Map(),
			warnings: [
				...warnings,
				`Tariff code suggestions could not be fetched (${
					error instanceof Error ? error.message : 'unknown error'
				}). Search for each item by hand in the dialog.`
			]
		};
	}
}
