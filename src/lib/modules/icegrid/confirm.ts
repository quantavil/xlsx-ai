import type { DropdownOption } from '$lib/types';
import type { IcegridCatalogSnapshot } from './catalogs/types';
import { buildDrawbackOptions, normalizeRitcCode, type DutyLookupMap } from './duty-lookup';
import type { ExchangeRate } from './exchange-rate';
import type { TariffCandidate, TariffClassification, TariffQuery } from './tariff';
import type { IcegridRow } from './schema';
import type { IcegridClassificationSession } from './session';
import { isBlank } from '$lib/table/cells';

/**
 * The values a human confirms before an import is written.
 *
 * Everything here is already answered by the pipeline - the extractor, the duty
 * lookup and the schedules between them - so the dialog is a confirmation, not a
 * questionnaire. What it exists for is that each of these is a declaration the
 * exporter signs and none of them can be verified against the documents: a
 * drawback serial is a classification, IGST status is a choice made before the
 * shipment, and an end use is a statement about the buyer.
 */
export interface IcegridRitcAnswer {
	drawback_schno: string | null;
	RODTEP: string | null;
	IGST_PaymentStatus: string | null;
	IGST_Rate: number | null;
}

/** The fields that are one value for the whole filing, not one per tariff code. */
export interface IcegridInvoiceAnswer {
	RewardItem: string | null;
	StateOrigin: string | null;
	DistrictOrigin: string | null;
	EndUse: string | null;
	ApplicableExpSchemes: string | null;
}

export interface IcegridAnswers {
	invoice: IcegridInvoiceAnswer;
	/** Keyed by the eight-digit RITC the documents already settled. */
	perRitc: Record<string, IcegridRitcAnswer>;
	/** Tariff codes chosen in the dialog for items that arrived without one. */
	assignedRitc: Record<string, string | null>;
	/** The same per-tariff answers, for items whose code was chosen here. */
	perItem: Record<string, IcegridRitcAnswer>;
	currency: string | null;
	exchangeRate: number | null;
}

/** One tariff code's rows, collapsed into the one set of answers they share. */
export interface IcegridRitcGroup {
	/** Normalized eight-digit code. */
	key: string;
	/** The code as the documents printed it, for display. */
	ritc: string;
	rowCount: number;
	/** First description under this code, so the user can tell the groups apart. */
	sample: string;
	drawbackOptions: DropdownOption[];
	values: IcegridRitcAnswer;
}

/**
 * An item whose tariff code the documents did not settle.
 *
 * Either nothing was printed, or what was printed is short of eight digits - a
 * heading like `9403` narrows the answer without being one. Both are the same
 * problem from here: the code has to be chosen, and only a human may choose it.
 */
export interface IcegridUnclassifiedItem {
	key: string;
	description: string;
	/** Digits of the partial code the documents printed, `''` when none. */
	printed: string;
	rowCount: number;
	candidates: TariffCandidate[];
	/** Search phrases the classifier used, so a poor suggestion is explainable. */
	terms: string[];
	/** Set only when the ranker judged none of the candidates fit. */
	note: string;
	/** Material breakdown from packing list/invoice, if available. */
	materials?: string | null;
	/** Net weight in kilograms, if available. */
	netWeight?: number | null;
	/** Currently assigned RITC code from prior selection, if any. */
	initialRitc?: string | null;
	/** Currently assigned duty answers from prior selection, if any. */
	initialValues?: IcegridRitcAnswer | null;
}

export interface IcegridConfirmInput {
	groups: IcegridRitcGroup[];
	unclassified: IcegridUnclassifiedItem[];
	invoice: IcegridInvoiceAnswer;
	catalogs: IcegridCatalogSnapshot;
	rates: readonly ExchangeRate[];
	currency: string | null;
	exchangeRate: number | null;
	/** A rate the invoice itself printed, shown when it disagrees with the board. */
	documentExchangeRate: number | null;
	/**
	 * Why there are no suggestions, when the classifier could not be reached.
	 *
	 * Shown in the dialog because that is where the user is looking. Without it an
	 * empty candidate list reads as "the schedule has no such code", which is a
	 * claim about the tariff rather than about our own request failing.
	 */
	classifyWarning: string;
	/** Set to true when reopening declarations for an active table. */
	isReopen?: boolean;
}

const RITC_FIELDS = [
	'drawback_schno',
	'RODTEP',
	'IGST_PaymentStatus',
	'IGST_Rate'
] as const;

const INVOICE_FIELDS = ['RewardItem', 'StateOrigin', 'DistrictOrigin', 'EndUse', 'ApplicableExpSchemes'] as const;

const blank = isBlank;

/**
 * Only an eight-digit code can be filed, so only an eight-digit code counts as
 * settled. A four- or six-digit heading is a narrowing, not an answer.
 */
export function isFilableRitc(value: unknown): boolean {
	return normalizeRitcCode(value).length === 8;
}

/**
 * How rows needing a code are grouped: by what was printed and what it is.
 *
 * Two lines of the same goods under the same partial heading are one decision, and
 * making the user answer it twice is how a filing ends up internally inconsistent.
 * The key is recomputed rather than stored, so building the dialog and applying
 * its answers cannot drift apart.
 */
export function unclassifiedKey(row: IcegridRow): string {
	if (row._unclassifiedKey) return row._unclassifiedKey;
	const printed = normalizeRitcCode(row._printedRitc ?? row.RITCCode);
	return `${printed}|${String(row.Description ?? '').trim().toLowerCase()}`;
}

/** The first answer any row gives, since the pipeline fills a group uniformly. */
function firstAnswer(rows: readonly IcegridRow[], header: string): string | number | null {
	for (const row of rows) {
		const value = (row as Record<string, unknown>)[header];
		if (!blank(value)) return value as string | number;
	}
	return null;
}

const asText = (v: unknown): string | null => (blank(v) ? null : String(v));

const asNumber = (v: unknown): number | null => {
	if (blank(v)) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

function ritcAnswerFrom(rows: readonly IcegridRow[]): IcegridRitcAnswer {
	return {
		drawback_schno: asText(firstAnswer(rows, 'drawback_schno')),
		RODTEP: asText(firstAnswer(rows, 'RODTEP')),
		IGST_PaymentStatus: asText(firstAnswer(rows, 'IGST_PaymentStatus')),
		IGST_Rate: asNumber(firstAnswer(rows, 'IGST_Rate'))
	};
}

function groupBy(rows: readonly IcegridRow[], key: (row: IcegridRow) => string) {
	const buckets = new Map<string, IcegridRow[]>();
	for (const row of rows) {
		const k = key(row);
		const bucket = buckets.get(k);
		if (bucket) bucket.push(row);
		else buckets.set(k, [row]);
	}
	return buckets;
}

/**
 * Group the proposed rows by tariff code and read the pipeline's own answer out of
 * each group.
 *
 * The rows handed in are the *derived* ones, not the raw extraction: that is what
 * makes the dialog show the schedule's drawback serial and the lookup's RoDTEP
 * verdict rather than a screen of blanks. The answers then go back onto the raw
 * rows and the derivation runs again, so a changed serial pulls its own rate,
 * description and unit with it exactly as an imported one does.
 */
export function buildConfirmInput(
	rows: readonly IcegridRow[],
	options: {
		lookups?: DutyLookupMap;
		catalogs: IcegridCatalogSnapshot;
		rates?: readonly ExchangeRate[];
		currency?: string | null;
		exchangeRate?: number | null;
		documentExchangeRate?: number | null;
		classifications?: ReadonlyMap<string, TariffClassification>;
		classifyWarning?: string;
		isReopen?: boolean;
		fallbackDrawbackOptions?: readonly DropdownOption[];
		unclassifiedSession?: IcegridClassificationSession | null;
	}
): IcegridConfirmInput {
	const lookupOptions = options.lookups ? buildDrawbackOptions(options.lookups) : [];
	const rawDrawbackOptions = options.fallbackDrawbackOptions
		? [...lookupOptions, ...options.fallbackDrawbackOptions]
		: lookupOptions;
	const seenDrawback = new Set<string>();
	const drawbackOptions: DropdownOption[] = [];
	for (const opt of rawDrawbackOptions) {
		const k = `${opt.parentValue ?? ''}::${opt.value.trim().toUpperCase()}`;
		if (!seenDrawback.has(k)) {
			seenDrawback.add(k);
			drawbackOptions.push(opt);
		}
	}

	const sessionKeys = new Set(options.unclassifiedSession?.items.map((it) => it.key) ?? []);

	function isUnclassifiedRow(row: IcegridRow): boolean {
		if (row._unclassifiedKey && sessionKeys.has(row._unclassifiedKey)) return true;
		if (row._unclassifiedKey && !isFilableRitc(row._printedRitc)) return true;
		if (!isFilableRitc(row.RITCCode)) return true;
		if (options.unclassifiedSession) {
			const desc = String(row.Description ?? '').trim().toLowerCase();
			const code = normalizeRitcCode(row.RITCCode);
			return options.unclassifiedSession.items.some(
				(it) =>
					it.description.trim().toLowerCase() === desc &&
					(normalizeRitcCode(it.assignedRitc) === code || normalizeRitcCode(it.printed) === code)
			);
		}
		return false;
	}

	const settled = rows.filter((row) => !isUnclassifiedRow(row));
	const unsettled = rows.filter(isUnclassifiedRow);

	const groups: IcegridRitcGroup[] = [
		...groupBy(settled, (row) => normalizeRitcCode(row.RITCCode))
	].map(([key, groupRows]) => ({
		key,
		ritc: asText(groupRows[0].RITCCode) ?? '',
		rowCount: groupRows.length,
		sample: asText(firstAnswer(groupRows, 'Description')) ?? '',
		// A serial the documents printed is offered even when the board never listed
		// it, or the user would be forced off their own value to confirm the dialog.
		drawbackOptions: withCurrentValue(
			drawbackOptions.filter((opt) => opt.parentValue === key),
			asText(firstAnswer(groupRows, 'drawback_schno'))
		),
		values: ritcAnswerFrom(groupRows)
	}));

	const unclassified: IcegridUnclassifiedItem[] = [
		...groupBy(unsettled, unclassifiedKey)
	].map(([key, itemRows]) => {
		const classification = options.classifications?.get(key);
		const sessionItem = options.unclassifiedSession?.items.find((it) => it.key === key);
		const rawMaterials = asText(firstAnswer(itemRows, 'MaterialComposition')) ?? sessionItem?.materials;
		const rawWeight = asNumber(firstAnswer(itemRows, 'NetWeight')) ?? sessionItem?.netWeight;

		// Use classification candidates if provided, else fallback to sessionItem candidates
		const candidates = [
			...((classification?.candidates && classification.candidates.length > 0)
				? classification.candidates
				: (sessionItem?.candidates ?? []))
		];

		const terms =
			classification?.terms && classification.terms.length > 0
				? classification.terms
				: (sessionItem?.terms ?? []);

		const note = classification?.note || sessionItem?.note || '';

		const printed =
			sessionItem?.printed ??
			normalizeRitcCode(itemRows[0]._printedRitc ?? itemRows[0].RITCCode);

		// Current assigned RITC code (if any)
		const currentAssigned =
			sessionItem?.assignedRitc ??
			(isFilableRitc(itemRows[0].RITCCode) ? normalizeRitcCode(itemRows[0].RITCCode) : null);

		// If a code was assigned and is not in candidates list, add it as a candidate so radio option appears
		if (
			currentAssigned &&
			!candidates.some((c) => normalizeRitcCode(c.code) === currentAssigned)
		) {
			candidates.push({
				code: currentAssigned,
				description: `Selected tariff code (${currentAssigned})`,
				basis: 'search',
				via: 'prior selection'
			});
		}

		const currentValues = sessionItem?.values ?? ritcAnswerFrom(itemRows);

		return {
			key,
			description:
				asText(firstAnswer(itemRows, 'Description')) ??
				sessionItem?.description ??
				'(no description)',
			printed,
			rowCount: itemRows.length,
			candidates,
			terms,
			note,
			...(rawMaterials ? { materials: rawMaterials } : {}),
			...(rawWeight !== null && rawWeight !== undefined ? { netWeight: rawWeight } : {}),
			initialRitc: currentAssigned,
			initialValues: currentValues
		};
	});

	return {
		groups,
		unclassified,
		invoice: {
			RewardItem: asText(firstAnswer(rows, 'RewardItem')),
			StateOrigin: asText(firstAnswer(rows, 'StateOrigin')),
			DistrictOrigin: asText(firstAnswer(rows, 'DistrictOrigin')),
			EndUse: asText(firstAnswer(rows, 'EndUse')),
			ApplicableExpSchemes: asText(firstAnswer(rows, 'ApplicableExpSchemes'))
		},
		catalogs: options.catalogs,
		rates: options.rates ?? [],
		currency: options.currency ?? null,
		exchangeRate: options.exchangeRate ?? null,
		documentExchangeRate: options.documentExchangeRate ?? null,
		classifyWarning: options.classifyWarning ?? '',
		isReopen: options.isReopen
	};
}

/** The items whose code has to be chosen, in the shape the classifier wants. */
export function tariffQueriesFor(rows: readonly IcegridRow[]): TariffQuery[] {
	return [...groupBy(rows.filter((row) => !isFilableRitc(row.RITCCode)), unclassifiedKey)].map(
		([key, itemRows]) => {
			const query: TariffQuery = {
				key,
				description: String(itemRows[0].Description ?? '').trim() || '(no description)',
				printed: normalizeRitcCode(itemRows[0].RITCCode)
			};
			const materials = asText(firstAnswer(itemRows, 'MaterialComposition'));
			if (materials) {
				query.materials = materials;
			}
			const netWeight = asNumber(firstAnswer(itemRows, 'NetWeight'));
			if (netWeight !== null) {
				query.netWeight = netWeight;
			}
			return query;
		}
	);
}

function withCurrentValue(
	options: readonly DropdownOption[],
	current: string | null
): DropdownOption[] {
	const seen = new Set<string>();
	const result: DropdownOption[] = [];
	if (current && current.trim()) {
		const curVal = current.trim().toUpperCase();
		seen.add(curVal);
		const existing = options.find((o) => o.value.trim().toUpperCase() === curVal);
		result.push(existing ?? { value: current.trim() });
	}
	for (const opt of options) {
		const val = opt.value.trim().toUpperCase();
		if (!seen.has(val)) {
			seen.add(val);
			result.push(opt);
		}
	}
	return result;
}

const EMPTY_RITC_ANSWER: IcegridRitcAnswer = {
	drawback_schno: null,
	RODTEP: null,
	IGST_PaymentStatus: null,
	IGST_Rate: null
};

/** The dialog's own starting state, and what a headless run confirms unchanged. */
export function defaultAnswers(input: IcegridConfirmInput): IcegridAnswers {
	return {
		invoice: { ...input.invoice },
		perRitc: Object.fromEntries(input.groups.map((g) => [g.key, { ...g.values }])),
		// Preserves initialRitc if present (e.g. from reopen or session); otherwise null.
		assignedRitc: Object.fromEntries(
			input.unclassified.map((item) => [item.key, item.initialRitc ?? null])
		),
		perItem: Object.fromEntries(
			input.unclassified.map((item) => [
				item.key,
				item.initialValues ? { ...item.initialValues } : { ...EMPTY_RITC_ANSWER }
			])
		),
		currency: input.currency,
		exchangeRate: input.exchangeRate
	};
}

function applyRitcFields(target: IcegridRow, answer: IcegridRitcAnswer | undefined): void {
	if (!answer) return;
	if (!blank(answer.drawback_schno) && answer.drawback_schno !== target.drawback_schno) {
		target.drawback_schno = answer.drawback_schno;
		target.dbk_rate = null;
		target.dbk_desc = null;
		target.dbk_unit = null;
		target.ROSLRate = null;
		target.ROSLCapValue = null;
	}
	for (const field of RITC_FIELDS) {
		if (field === 'drawback_schno') continue;
		if (!blank(answer[field])) (target as Record<string, unknown>)[field] = answer[field];
	}
}

/**
 * Write the confirmed answers back onto the raw extracted rows.
 *
 * Blank answers are skipped rather than written: a field the user left unset is one
 * nothing proposed, and clearing it here would erase a value the schedules are
 * about to supply. Everything else overwrites, because a confirmed answer outranks
 * an extracted one - that is the whole point of asking.
 */
export function applyIcegridAnswers(
	rows: readonly IcegridRow[],
	answers: IcegridAnswers,
	unclassifiedKeys?: ReadonlySet<string>
): IcegridRow[] {
	const unclassifiedSet = unclassifiedKeys ?? new Set(Object.keys(answers.assignedRitc));

	return rows.map((row) => {
		const next: IcegridRow = { ...row };
		const key = unclassifiedKey(row);
		const isUnclassified = unclassifiedSet.has(key) || Boolean(row._unclassifiedKey);

		if (isUnclassified) {
			next._unclassifiedKey = key;
			if (!next._printedRitc) {
				next._printedRitc = normalizeRitcCode(row._printedRitc ?? row.RITCCode);
			}
			const assigned = answers.assignedRitc[key];
			if (!blank(assigned)) {
				next.RITCCode = assigned;
				applyRitcFields(next, answers.perItem[key]);
			} else {
				next.RITCCode = next._printedRitc || null;
				applyRitcFields(next, answers.perItem[key]);
			}
		} else if (isFilableRitc(row.RITCCode)) {
			applyRitcFields(next, answers.perRitc[normalizeRitcCode(row.RITCCode)]);
		}

		for (const field of INVOICE_FIELDS) {
			if (!blank(answers.invoice[field])) {
				(next as Record<string, unknown>)[field] = answers.invoice[field];
			}
		}
		return next;
	});
}

/**
 * What an item's per-tariff answers keep when its tariff code changes.
 *
 * The drawback serial and the RoDTEP verdict are consequences of the code, so they
 * cannot outlive it - keeping them files one code's goods against another code's
 * drawback claim, which is the exact silent misclassification this dialog exists to
 * prevent. IGST payment status and rate are decisions about the shipment, not about
 * the classification, and do survive a reclassification.
 */
export function clearCodeDerived(answer: IcegridRitcAnswer): IcegridRitcAnswer {
	return { ...answer, drawback_schno: null, RODTEP: null };
}

/** Codes the dialog assigned that no duty lookup has been made for yet. */
export function newlyAssignedRitcs(answers: IcegridAnswers): string[] {
	const codes = new Set<string>();
	for (const value of Object.values(answers.assignedRitc)) {
		const code = normalizeRitcCode(value);
		if (code.length === 8) codes.add(code);
	}
	return [...codes];
}
